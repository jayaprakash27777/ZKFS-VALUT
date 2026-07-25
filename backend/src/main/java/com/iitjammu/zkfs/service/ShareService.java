package com.iitjammu.zkfs.service;

import com.iitjammu.zkfs.config.properties.MinioProperties;
import com.iitjammu.zkfs.domain.FileChunk;
import com.iitjammu.zkfs.domain.FileMetadata;
import com.iitjammu.zkfs.domain.FileShare;
import com.iitjammu.zkfs.dto.CreateShareRequest;
import com.iitjammu.zkfs.dto.CreateShareResponse;
import com.iitjammu.zkfs.dto.ShareMetadataResponse;
import com.iitjammu.zkfs.exception.FileNotFoundException;
import com.iitjammu.zkfs.repository.FileChunkRepository;
import com.iitjammu.zkfs.repository.FileMetadataRepository;
import com.iitjammu.zkfs.repository.FileShareRepository;
import com.iitjammu.zkfs.repository.FolderRepository;
import com.iitjammu.zkfs.repository.UserRepository;
import io.minio.GetObjectArgs;
import io.minio.GetObjectResponse;
import io.minio.MinioClient;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import com.iitjammu.zkfs.domain.User;

import java.io.OutputStream;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * ShareService — Zero-Knowledge Password-Protected File Sharing
 * =============================================================
 *
 * <h3>Protocol:</h3>
 * <ol>
 *   <li>Owner calls createShare() with ZK crypto blobs (shareWrappedDek, etc.).</li>
 *   <li>Service validates ownership, persists FileShare, returns shareToken.</li>
 *   <li>Recipient opens GET /v1/share/{token} — gets public metadata + opaque blobs.</li>
 *   <li>Recipient enters password → derives shareKEK → unwraps DEK in browser.</li>
 *   <li>Recipient streams chunks via GET /v1/share/{token}/chunk/{i}/stream.</li>
 *   <li>Service validates token is still accessible (not expired / not exhausted).</li>
 * </ol>
 *
 * <p>The server is unable to decrypt any of the stored blobs.
 * The share password never reaches the server.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ShareService {

    private final FileShareRepository    shareRepository;
    private final com.iitjammu.zkfs.repository.UserShareRepository userShareRepository;
    private final FileMetadataRepository fileMetadataRepository;
    private final FolderRepository       folderRepository;
    private final FileChunkRepository    fileChunkRepository;
    private final UserRepository         userRepository;
    private final MinioClient            minioClient;
    private final MinioProperties        minioProperties;

    @Transactional
    public void shareFileWithUser(UUID fileId, String ownerEmail, com.iitjammu.zkfs.dto.UserShareRequest request) {
        User owner = userRepository.findByEmail(ownerEmail)
                .orElseThrow(() -> new UsernameNotFoundException("Owner not found"));

        FileMetadata file = fileMetadataRepository.findByIdAndUserIdAndDeletedAtIsNull(fileId, owner.getId())
                .orElseThrow(() -> new FileNotFoundException("File not found or access denied"));

        User target = userRepository.findByEmail(request.email())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Target user not found"));

        if (target.getPublicKey() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Target user has not setup sharing keys");
        }

        com.iitjammu.zkfs.domain.UserShare userShare = com.iitjammu.zkfs.domain.UserShare.builder()
                .file(file)
                .owner(owner)
                .sharedWith(target)
                .wrappedDek(request.wrappedDek())
                .build();

        userShareRepository.save(userShare);
    }

    @Transactional(readOnly = true)
    public List<com.iitjammu.zkfs.dto.SharedFileResponse> getSharedFiles(String userEmail) {
        User user = userRepository.findByEmail(userEmail)
                .orElseThrow(() -> new UsernameNotFoundException("User not found"));

        return userShareRepository.findBySharedWithId(user.getId()).stream().map(share -> {
            FileMetadata file = share.getFile();
            return new com.iitjammu.zkfs.dto.SharedFileResponse(
                    file.getId(),
                    file.getFilenameEncrypted(),
                    share.getWrappedDek(),
                    file.getIvWrappedDek(),
                    file.getTotalSize(),
                    file.getMimeType(),
                    share.getOwner().getId(),
                    share.getOwner().getEmail(),
                    share.getCreatedAt()
            );
        }).toList();
    }

    // ── Public Link Sharing ─────────────────────────────────────────────────────────

    /**
     * Creates a new password-protected share for a file owned by the caller.
     *
     * @param request  ZK crypto blobs + access control settings
     * @param email    Authenticated owner's email
     * @return         CreateShareResponse with shareToken and share URL
     */
    @Transactional
    public CreateShareResponse createShare(CreateShareRequest request, String email) {
        // 1. Verify caller owns the file or folder
        var user = userRepository.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("User not found: " + email));

        if (request.fileId() == null && request.folderId() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "fileId or folderId must be provided.");
        }

        FileMetadata file = null;
        com.iitjammu.zkfs.domain.Folder folder = null;

        if (request.fileId() != null) {
            file = fileMetadataRepository
                    .findByIdAndUserIdAndDeletedAtIsNull(request.fileId(), user.getId())
                    .orElseThrow(() -> new FileNotFoundException(request.fileId()));

            if (file.getUploadStatus() != FileMetadata.UploadStatus.COMPLETE) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Cannot share a file that has not finished uploading.");
            }
        } else {
            folder = folderRepository
                    .findByIdAndUserIdAndDeletedAtIsNull(request.folderId(), user.getId())
                    .orElseThrow(() -> new FileNotFoundException(request.folderId()));
        }

        // 2. Build expiry
        OffsetDateTime expiresAt = null;
        if (request.expiresHours() != null && request.expiresHours() > 0) {
            expiresAt = OffsetDateTime.now().plusHours(request.expiresHours());
        }

        // 3. Build and persist FileShare
        FileShare share = FileShare.builder()
                .fileMetadata(file)
                .folder(folder)
                .shareSaltB64(request.shareSaltB64())
                .shareWrappedDek(request.shareWrappedDek())
                .shareIvDek(request.shareIvDek())
                .shareEncFilename(request.shareEncFilename())
                .shareIvFilename(request.shareIvFilename())
                .expiresAt(expiresAt)
                .maxDownloads(request.maxDownloads() != null && request.maxDownloads() > 0
                        ? request.maxDownloads() : null)
                .build();

        share = shareRepository.save(share);

        log.info("Share created: shareToken={} isFolder={} owner={} expiresAt={}",
                share.getShareToken(), folder != null, email, expiresAt);

        return new CreateShareResponse(
                share.getShareToken(),
                "/share/" + share.getShareToken(),
                share.getExpiresAt(),
                share.getMaxDownloads(),
                share.getCreatedAt()
        );
    }

    // ── Get Share Metadata (Public) ──────────────────────────────────────────

    /**
     * Returns public share metadata for a given token.
     * No authentication required — the share token + password together grant access.
     *
     * @param token  The share UUID from the URL
     * @return       ShareMetadataResponse with opaque crypto blobs
     * @throws ResponseStatusException 404 if token not found; 410 if expired/exhausted
     */
    @Transactional(readOnly = true)
    public ShareMetadataResponse getShareMetadata(UUID token) {
        FileShare share = resolveActiveShare(token);
        FileMetadata file = share.getFileMetadata();
        boolean isFolder = share.getFolder() != null;

        return new ShareMetadataResponse(
                share.getShareToken(),
                isFolder,
                share.getShareSaltB64(),
                share.getShareWrappedDek(),
                share.getShareIvDek(),
                share.getShareEncFilename(),
                share.getShareIvFilename(),
                file != null ? file.getMimeType() : null,
                file != null ? file.getTotalChunks() : 0,
                file != null ? file.getTotalSize() : 0,
                share.getExpiresAt(),
                share.getMaxDownloads(),
                share.getDownloadCount()
        );
    }

    // ── List Owner's Shares ──────────────────────────────────────────────────

    /**
     * Lists all shares created by the authenticated user.
     */
    @Transactional(readOnly = true)
    public List<ShareMetadataResponse> listMyShares(String email) {
        return shareRepository.findAllByOwnerEmail(email).stream()
                .map(share -> new ShareMetadataResponse(
                        share.getShareToken(),
                        share.getFolder() != null,
                        share.getShareSaltB64(),
                        share.getShareWrappedDek(),
                        share.getShareIvDek(),
                        share.getShareEncFilename(),
                        share.getShareIvFilename(),
                        share.getFileMetadata() != null ? share.getFileMetadata().getMimeType() : null,
                        share.getFileMetadata() != null ? share.getFileMetadata().getTotalChunks() : 0,
                        share.getFileMetadata() != null ? share.getFileMetadata().getTotalSize() : 0,
                        share.getExpiresAt(),
                        share.getMaxDownloads(),
                        share.getDownloadCount()
                ))
                .toList();
    }

    // ── Stream Chunk (Public) ────────────────────────────────────────────────

    /**
     * Streams an encrypted chunk to the caller via a valid share token.
     * Increments the download count on the FIRST chunk (chunkIndex == 0).
     *
     * @param token       Share token from URL
     * @param chunkIndex  Zero-based chunk index
     * @param out         HTTP response output stream
     */
    @Transactional
    public FileChunk resolveShareChunk(UUID token, int chunkIndex) {
        FileShare share = resolveActiveShare(token);
        FileMetadata file = share.getFileMetadata();

        if (chunkIndex < 0 || chunkIndex >= file.getTotalChunks()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Invalid chunk index: " + chunkIndex);
        }

        // Increment download count only on first chunk to count full downloads
        if (chunkIndex == 0) {
            shareRepository.incrementDownloadCount(share.getId());
            log.info("Share download started: shareToken={} fileId={}",
                    token, file.getId());
        }

        return fileChunkRepository
                .findByFileMetadataIdAndChunkIndex(file.getId(), chunkIndex)
                .orElseThrow(() -> new FileNotFoundException(
                        "Chunk %d not found for share %s".formatted(chunkIndex, token)));
    }

    /**
     * Streams the encrypted chunk bytes from MinIO to the given OutputStream.
     * Zero-copy pipeline: MinIO → 8 KiB buffer → HTTP response socket.
     */
    public void streamChunkToOutputStream(FileChunk chunk, OutputStream outputStream) {
        final String objectKey = chunk.getS3ObjectKey();
        try (GetObjectResponse minioStream = minioClient.getObject(
                GetObjectArgs.builder()
                        .bucket(minioProperties.bucket().chunks())
                        .object(objectKey)
                        .build()
        )) {
            final byte[] buffer = new byte[8 * 1024];
            int bytesRead;
            while ((bytesRead = minioStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, bytesRead);
            }
            outputStream.flush();
        } catch (Exception ex) {
            log.error("MinIO stream failed for key={}: {}", objectKey, ex.getMessage(), ex);
            throw new RuntimeException("Failed to stream chunk: " + objectKey, ex);
        }
    }

    // ── Revoke Share ─────────────────────────────────────────────────────────

    /**
     * Revokes (deletes) a share. Only the owner can do this.
     *
     * @param token  Share token from URL
     * @param email  Authenticated owner's email
     */
    @Transactional
    public void revokeShare(UUID token, String email) {
        FileShare share = shareRepository
                .findByTokenAndOwnerEmail(token, email)
                .orElseThrow(() -> new FileNotFoundException(
                        "Share not found or you do not own it: " + token));
        shareRepository.delete(share);
        log.info("Share revoked: shareToken={} owner={}", token, email);
    }

    // ── Private Helpers ──────────────────────────────────────────────────────

    private FileShare resolveActiveShare(UUID token) {
        FileShare share = shareRepository.findByShareToken(token)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Share not found or has expired."));

        if (!share.isAccessible()) {
            throw new ResponseStatusException(HttpStatus.GONE,
                    "This share link has expired or reached its download limit.");
        }
        return share;
    }
}
