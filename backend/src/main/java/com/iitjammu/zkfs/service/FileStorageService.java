package com.iitjammu.zkfs.service;

import com.iitjammu.zkfs.config.properties.MinioProperties;
import com.iitjammu.zkfs.domain.FileChunk;
import com.iitjammu.zkfs.domain.FileMetadata;
import com.iitjammu.zkfs.domain.Folder;
import com.iitjammu.zkfs.domain.FileMetadata.UploadStatus;
import com.iitjammu.zkfs.domain.User;
import com.iitjammu.zkfs.dto.ChunkUploadResponse;
import com.iitjammu.zkfs.dto.FileMetadataDto;
import com.iitjammu.zkfs.dto.InitiateUploadRequest;
import com.iitjammu.zkfs.dto.InitiateUploadResponse;
import com.iitjammu.zkfs.exception.FileNotFoundException;
import com.iitjammu.zkfs.exception.UploadIncompleteException;
import com.iitjammu.zkfs.repository.FileChunkRepository;
import com.iitjammu.zkfs.repository.FileMetadataRepository;
import com.iitjammu.zkfs.repository.UserRepository;
import io.minio.*;
import io.minio.errors.MinioException;
import io.minio.http.Method;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * File Storage Service — Chunked Upload / Download Pipeline
 * ══════════════════════════════════════════════════════════
 *
 * <h3>Upload Protocol:</h3>
 * <pre>
 *   1. initiateUpload()   — creates FileMetadata record (status=UPLOADING)
 *   2. storeChunk() × N   — streams each chunk directly to MinIO, records FileChunk
 *   3. completeUpload()   — verifies chunk count, sets status=COMPLETE
 * </pre>
 *
 * <h3>MinIO Object Key Convention:</h3>
 * <pre>
 *   files/{fileId}/chunk_{chunkIndex}.enc
 * </pre>
 *
 * <h3>Design Decisions:</h3>
 * <ul>
 *   <li><strong>Zero-copy streaming:</strong> chunk bytes are piped directly from
 *       the HTTP request InputStream to MinIO — no intermediate buffering.</li>
 *   <li><strong>Ownership isolation:</strong> all queries include user_id in the
 *       WHERE clause, so users can never access each other's files.</li>
 *   <li><strong>Idempotent chunk upload:</strong> re-uploading the same chunk index
 *       overwrites both the MinIO object and the database record.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class FileStorageService {

    private final FileMetadataRepository fileMetadataRepository;
    private final FileChunkRepository    fileChunkRepository;
    private final com.iitjammu.zkfs.repository.FolderRepository       folderRepository;
    private final UserRepository         userRepository;
    private final MinioClient            minioClient;
    private final MinioProperties        minioProperties;

    // ── Object Key Builder ────────────────────────────────────────────────────

    /**
     * Builds the MinIO object key for a specific chunk.
     * Format: {@code files/{fileId}/chunk_{chunkIndex}.enc}
     */
    static String buildObjectKey(UUID fileId, int chunkIndex) {
        return "files/%s/chunk_%d.enc".formatted(fileId, chunkIndex);
    }

    // ── Step 1: Initiate Upload ───────────────────────────────────────────────

    /**
     * Creates a FileMetadata record and returns the server-assigned fileId.
     *
     * <p>The file's status is set to {@code UPLOADING} immediately — this
     * allows the server to detect stale/abandoned uploads.
     *
     * @param request  Client-provided metadata (all sensitive fields are ciphertext)
     * @param email    Email of the authenticated user
     * @return         InitiateUploadResponse with fileId and creation timestamp
     */
    @Transactional
    public InitiateUploadResponse initiateUpload(InitiateUploadRequest request, String email) {
        User user = resolveUser(email);
        Folder folder = null;
        if (request.folderId() != null) {
            folder = folderRepository.findByIdAndUserIdAndDeletedAtIsNull(request.folderId(), user.getId())
                    .orElseThrow(() -> new IllegalArgumentException("Folder not found"));
        }

        FileMetadata file = FileMetadata.builder()
                .user(user)
                .folder(folder)
                .filenameEncrypted(request.filenameEncrypted())
                .mimeType(request.mimeType())
                .thumbnailEncrypted(request.thumbnailEncrypted())
                .totalChunks(request.totalChunks())
                .totalSize(request.totalSize())
                .wrappedDek(request.wrappedDek())
                .ivWrappedDek(request.ivWrappedDek())
                .uploadStatus(UploadStatus.UPLOADING)
                .build();

        file = fileMetadataRepository.save(file);

        log.info("Upload initiated: fileId={} user={} chunks={} size={}",
                file.getId(), email, request.totalChunks(), request.totalSize());

        return new InitiateUploadResponse(
                file.getId(),
                file.getUploadStatus().name(),
                file.getTotalChunks(),
                file.getCreatedAt()
        );
    }

    // ── Step 2: Store Chunk ───────────────────────────────────────────────────

    /**
     * Streams an encrypted chunk directly from the HTTP request to MinIO,
     * then persists the chunk metadata to PostgreSQL.
     *
     * <h4>Zero-copy streaming path:</h4>
     * <pre>
     *   HTTP request body
     *     → MultipartFile.getInputStream()
     *       → MinioClient.putObject(PutObjectArgs with InputStream)
     *         → MinIO S3 socket write
     *   (no byte[] allocation, no temporary files)
     * </pre>
     *
     * <p>If the same chunkIndex is re-uploaded, the MinIO object is overwritten
     * and the FileChunk record is updated (idempotent behaviour).
     *
     * @param fileId        Server-assigned file UUID
     * @param chunkIndex    Zero-based index of this chunk
     * @param chunkFile     Multipart binary upload (the encrypted wire frame)
     * @param sha256Hex     Hex SHA-256 of the encrypted wire frame (for integrity storage)
     * @param ivChunkB64    Base64 12-byte AES-GCM IV for this chunk
     * @param email         Authenticated user's email (ownership verification)
     * @return              ChunkUploadResponse with storage confirmation
     */
    @Transactional
    public ChunkUploadResponse storeChunk(
            UUID          fileId,
            int           chunkIndex,
            MultipartFile chunkFile,
            String        sha256Hex,
            String        ivChunkB64,
            String        email
    ) {
        // ── 1. Ownership check ────────────────────────────────────────────────
        FileMetadata fileMetadata = fileMetadataRepository
                .findByIdAndUserIdAndDeletedAtIsNull(fileId, resolveUser(email).getId())
                .orElseThrow(() -> new FileNotFoundException(fileId));

        validateChunkIndex(chunkIndex, fileMetadata.getTotalChunks());

        long chunkSize = chunkFile.getSize();
        if (chunkSize == 0) {
            throw new IllegalArgumentException("Chunk %d is empty".formatted(chunkIndex));
        }

        // ── 2. Build MinIO object key ─────────────────────────────────────────
        String objectKey = buildObjectKey(fileId, chunkIndex);

        // ── 3. Stream directly to MinIO (zero-copy) ───────────────────────────
        try (InputStream inputStream = chunkFile.getInputStream()) {
            minioClient.putObject(
                PutObjectArgs.builder()
                    .bucket(minioProperties.bucket().chunks())
                    .object(objectKey)
                    .stream(inputStream, chunkSize, -1)
                    // Content type identifies binary encrypted data
                    .contentType("application/octet-stream")
                    // User metadata for quick inspection without DB query
                    .userMetadata(java.util.Map.of(
                        "file-id",     fileId.toString(),
                        "chunk-index", String.valueOf(chunkIndex),
                        "sha256",      sha256Hex
                    ))
                    .build()
            );
        } catch (Exception ex) {
            log.error("MinIO write failed: fileId={} chunk={} key={}",
                    fileId, chunkIndex, objectKey, ex);
            throw new RuntimeException(
                    "Failed to store chunk %d to object storage".formatted(chunkIndex), ex
            );
        }

        log.debug("Chunk stored in MinIO: key={} size={}", objectKey, chunkSize);

        // ── 4. Upsert FileChunk record ────────────────────────────────────────
        //   Re-upload of the same chunk index overwrites — idempotent.
        FileChunk chunkEntity = fileChunkRepository
                .findByFileMetadataIdAndChunkIndex(fileId, chunkIndex)
                .orElse(FileChunk.builder()
                        .fileMetadata(fileMetadata)
                        .chunkIndex(chunkIndex)
                        .build());

        chunkEntity.setChunkSize(chunkSize);
        chunkEntity.setS3ObjectKey(objectKey);
        chunkEntity.setSha256Checksum(sha256Hex);
        chunkEntity.setIvChunk(ivChunkB64);

        FileChunk saved = fileChunkRepository.save(chunkEntity);

        log.info("Chunk persisted: fileId={} index={} size={}", fileId, chunkIndex, chunkSize);

        return new ChunkUploadResponse(
                saved.getId(),
                fileId,
                chunkIndex,
                chunkSize,
                objectKey
        );
    }

    // ── Step 3: Complete Upload ───────────────────────────────────────────────

    /**
     * Marks an upload as complete after verifying all expected chunks exist.
     *
     * <p>Validates:
     * <ul>
     *   <li>Ownership (user must own the file)</li>
     *   <li>Chunk count (DB count must equal {@code totalChunks})</li>
     * </ul>
     *
     * @param fileId  Server-assigned file UUID
     * @param email   Authenticated user's email
     * @return        Updated FileMetadataDto with status=COMPLETE
     * @throws UploadIncompleteException if chunk count mismatches
     */
    @Transactional
    public FileMetadataDto completeUpload(UUID fileId, String email) {
        FileMetadata file = fileMetadataRepository
                .findByIdAndUserIdAndDeletedAtIsNull(fileId, resolveUser(email).getId())
                .orElseThrow(() -> new FileNotFoundException(fileId));

        // ── Verify chunk count ────────────────────────────────────────────────
        long uploadedChunks = fileChunkRepository.countByFileMetadataId(fileId);

        if (uploadedChunks != file.getTotalChunks()) {
            log.warn("Complete rejected: fileId={} expected={} uploaded={}",
                    fileId, file.getTotalChunks(), uploadedChunks);
            throw new UploadIncompleteException(file.getTotalChunks(), uploadedChunks);
        }

        // ── Update status ─────────────────────────────────────────────────────
        file.setUploadStatus(UploadStatus.COMPLETE);
        file = fileMetadataRepository.save(file);

        log.info("Upload complete: fileId={} chunks={} user={}", fileId, uploadedChunks, email);

        return FileMetadataDto.from(file);
    }

    // ── List Files ────────────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public Page<FileMetadataDto> listFiles(String email, UUID folderId, boolean deleted, Pageable pageable) {
        UUID userId = resolveUser(email).getId();
        if (deleted) {
            return fileMetadataRepository
                    .findByUserIdAndDeletedAtIsNotNullOrderByDeletedAtDesc(userId, pageable)
                    .map(FileMetadataDto::from);
        }
        
        if (folderId == null) {
            return fileMetadataRepository
                    .findByUserIdAndFolderIsNullAndDeletedAtIsNullOrderByCreatedAtDesc(userId, pageable)
                    .map(FileMetadataDto::from);
        } else {
            return fileMetadataRepository
                    .findByUserIdAndFolder_IdAndDeletedAtIsNullOrderByCreatedAtDesc(userId, folderId, pageable)
                    .map(FileMetadataDto::from);
        }
    }

    // ── Get Single File ───────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    public FileMetadataDto getFile(UUID fileId, String email) {
        UUID userId = resolveUser(email).getId();
        return fileMetadataRepository
                .findByIdAndUserIdAndDeletedAtIsNull(fileId, userId)
                .map(FileMetadataDto::from)
                .orElseThrow(() -> new FileNotFoundException(fileId));
    }

    // ── Get Chunk Metadata (for download) ────────────────────────────────────

    @Transactional(readOnly = true)
    public List<FileChunk> getChunkMetadata(UUID fileId, String email) {
        // Ownership check — verifies file belongs to this user
        getFile(fileId, email);
        return fileChunkRepository.findByFileMetadataIdOrderByChunkIndexAsc(fileId);
    }

    // ── Download Chunk (Presigned URL) ────────────────────────────────────────

    /**
     * Generates a short-lived presigned URL for direct chunk download from MinIO.
     * The client downloads the encrypted wire frame and decrypts it locally.
     *
     * @param fileId      File UUID
     * @param chunkIndex  Zero-based chunk index
     * @param email       Authenticated user email
     * @return            Presigned URL valid for {@code minioProperties.presignedUrlExpiry()} seconds
     */
    @Transactional(readOnly = true)
    public String generateChunkDownloadUrl(UUID fileId, int chunkIndex, String email) {
        // Ownership check
        getFile(fileId, email);

        FileChunk chunk = fileChunkRepository
                .findByFileMetadataIdAndChunkIndex(fileId, chunkIndex)
                .orElseThrow(() -> new FileNotFoundException(
                        "Chunk %d not found for file %s".formatted(chunkIndex, fileId)
                ));

        try {
            return minioClient.getPresignedObjectUrl(
                GetPresignedObjectUrlArgs.builder()
                    .bucket(minioProperties.bucket().chunks())
                    .object(chunk.getS3ObjectKey())
                    .method(Method.GET)
                    .expiry((int) minioProperties.presignedUrlExpiry(), TimeUnit.SECONDS)
                    .build()
            );
        } catch (Exception ex) {
            log.error("Failed to generate presigned URL: fileId={} chunk={}", fileId, chunkIndex, ex);
            throw new RuntimeException("Could not generate download URL", ex);
        }
    }

    // ── Stream Chunk to OutputStream (Phase 4 download) ─────────────────────────────────

    /**
     * Returns the {@link FileChunk} entity for a specific chunk, after verifying ownership.
     * Used by the controller to populate response headers before streaming.
     *
     * @param fileId      File UUID
     * @param chunkIndex  Zero-based index
     * @param email       Authenticated user email
     * @throws FileNotFoundException if file or chunk does not belong to the user
     */
    @Transactional(readOnly = true)
    public FileChunk getChunkEntity(UUID fileId, int chunkIndex, String email) {
        // Ownership verified via file lookup
        getFile(fileId, email);

        return fileChunkRepository
                .findByFileMetadataIdAndChunkIndex(fileId, chunkIndex)
                .orElseThrow(() -> new FileNotFoundException(
                        "Chunk %d not found for file %s".formatted(chunkIndex, fileId)
                ));
    }

    /**
     * Streams the encrypted chunk bytes from MinIO directly to the provided
     * {@link java.io.OutputStream}, using an 8 KiB transfer buffer.
     *
     * <h4>Zero-copy pipeline:</h4>
     * <pre>
     *   MinIO storage
     *     → GetObjectResponse (extends InputStream)
     *       → 8 KiB byte[] transfer buffer
     *         → HttpServletResponse.getOutputStream()
     *           → client network socket
     * </pre>
     *
     * <p>The encrypted wire frame ({@code [12-byte IV] || [ciphertext+tag]}) is
     * served verbatim — the server does NOT decrypt. The client holds the DEK
     * and performs all decryption in the browser via WebCrypto.
     *
     * @param chunk        FileChunk entity (provides s3ObjectKey)
     * @param outputStream Target output stream (from HttpServletResponse)
     * @throws RuntimeException wrapping any MinIO or IO error
     */
    public void streamChunkToOutputStream(FileChunk chunk, java.io.OutputStream outputStream) {
        final String objectKey = chunk.getS3ObjectKey();

        try (GetObjectResponse minioStream = minioClient.getObject(
                GetObjectArgs.builder()
                        .bucket(minioProperties.bucket().chunks())
                        .object(objectKey)
                        .build()
        )) {
            // 8 KiB buffer — matches typical OS page size for efficient I/O
            final byte[] buffer    = new byte[8 * 1024];
            int           bytesRead;

            while ((bytesRead = minioStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
            }
            outputStream.flush();

            log.debug("Chunk streamed to client: key={} size={}", objectKey, chunk.getChunkSize());

        } catch (Exception ex) {
            log.error("MinIO stream failed for key={}: {}", objectKey, ex.getMessage(), ex);
            throw new RuntimeException(
                    "Failed to stream chunk from object storage: " + objectKey, ex
            );
        }
    }

    // ── Soft Delete File ──────────────────────────────────────────────────────

    @Transactional
    public void deleteFile(UUID fileId, String email) {
        FileMetadata file = fileMetadataRepository
                .findByIdAndUserIdAndDeletedAtIsNull(fileId, resolveUser(email).getId())
                .orElseThrow(() -> new FileNotFoundException(fileId));

        file.setDeletedAt(OffsetDateTime.now());
        fileMetadataRepository.save(file);
        log.info("File soft-deleted: fileId={} user={}", fileId, email);
    }

    // ── Restore File ──────────────────────────────────────────────────────────

    @Transactional
    public void restoreFile(UUID fileId, String email) {
        FileMetadata file = fileMetadataRepository
                .findByIdAndUserIdAndDeletedAtIsNotNull(fileId, resolveUser(email).getId())
                .orElseThrow(() -> new FileNotFoundException("Deleted file not found: " + fileId));

        file.setDeletedAt(null);
        fileMetadataRepository.save(file);
        log.info("File restored: fileId={} user={}", fileId, email);
    }

    // ── Hard Delete File ──────────────────────────────────────────────────────

    /**
     * Permanently deletes a file and all its encrypted chunks from both
     * PostgreSQL and MinIO object storage.
     */
    @Transactional
    public void hardDeleteFile(UUID fileId, String email) {
        FileMetadata file = fileMetadataRepository
                .findByIdAndUserIdAndDeletedAtIsNotNull(fileId, resolveUser(email).getId())
                .orElseThrow(() -> new FileNotFoundException(fileId));

        hardDeleteFileInternal(file);
    }

    /**
     * Internal method to hard delete a file without checking if it was soft-deleted.
     * Used by FolderService for recursive folder deletion.
     */
    @Transactional
    public void hardDeleteFileInternal(FileMetadata file) {
        List<FileChunk> chunks = fileChunkRepository.findByFileMetadataIdOrderByChunkIndexAsc(file.getId());

        // Delete each chunk from MinIO (best-effort — log failures, don't abort)
        for (FileChunk chunk : chunks) {
            try {
                minioClient.removeObject(
                    RemoveObjectArgs.builder()
                        .bucket(minioProperties.bucket().chunks())
                        .object(chunk.getS3ObjectKey())
                        .build()
                );
            } catch (Exception ex) {
                log.error("MinIO delete failed for key={}: {}", chunk.getS3ObjectKey(), ex.getMessage());
            }
        }

        // Cascade delete handles FileChunk records via @OneToMany(orphanRemoval=true)
        fileMetadataRepository.delete(file);
        log.info("File permanently deleted: fileId={}", file.getId());
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    private User resolveUser(String email) {
        return userRepository.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("User not found: " + email));
    }

    private static void validateChunkIndex(int chunkIndex, int totalChunks) {
        if (chunkIndex < 0 || chunkIndex >= totalChunks) {
            throw new IllegalArgumentException(
                "Invalid chunk index %d for file with %d total chunks"
                        .formatted(chunkIndex, totalChunks)
            );
        }
    }
}
