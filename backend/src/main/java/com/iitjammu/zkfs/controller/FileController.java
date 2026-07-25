package com.iitjammu.zkfs.controller;

import com.iitjammu.zkfs.domain.FileChunk;
import com.iitjammu.zkfs.dto.*;
import com.iitjammu.zkfs.service.FileStorageService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.util.List;
import java.util.Map;
import java.util.UUID;


/**
 * File Controller — Chunked Zero-Knowledge Upload & Download API
 * ══════════════════════════════════════════════════════════════
 *
 * All endpoints require a valid JWT Bearer token (enforced by Spring Security).
 * Ownership is verified at the service layer — users can only access their own files.
 *
 * <pre>
 *   POST   /v1/files/initiate              Initiate upload session
 *   POST   /v1/files/{fileId}/chunk/{idx}  Upload an encrypted chunk
 *   POST   /v1/files/{fileId}/complete     Mark upload complete
 *   GET    /v1/files                       List files (paginated)
 *   GET    /v1/files/{fileId}              Get file metadata
 *   GET    /v1/files/{fileId}/chunks       Get all chunk metadata
 *   GET    /v1/files/{fileId}/chunk/{idx}/url  Get presigned download URL
 *   DELETE /v1/files/{fileId}              Delete file + chunks
 * </pre>
 */
@Slf4j
@Validated
@RestController
@RequestMapping("/v1/files")
@RequiredArgsConstructor
public class FileController {

    private final FileStorageService fileStorageService;
    private final com.iitjammu.zkfs.service.ShareService shareService;

    // ── POST /v1/files/initiate ───────────────────────────────────────────────

    /**
     * Initiates a multi-chunk encrypted file upload session.
     *
     * <p>The client must call this before any chunk uploads.
     * Returns a {@code fileId} UUID that identifies the upload session.
     *
     * <p>Request body:
     * <pre>
     * {
     *   "filenameEncrypted": "Base64(AES-GCM(filename))",
     *   "mimeType":          "application/pdf",      // optional
     *   "totalChunks":       10,
     *   "totalSize":         52428800,                // original bytes
     *   "wrappedDek":        "Base64(AES-GCM(DEK))",
     *   "ivWrappedDek":      "Base64(12-byte IV)"
     * }
     * </pre>
     */
    @PostMapping("/initiate")
    public ResponseEntity<InitiateUploadResponse> initiateUpload(
            @Valid @RequestBody InitiateUploadRequest request,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.info("[POST /files/initiate] user={} chunks={}", principal.getUsername(), request.totalChunks());
        InitiateUploadResponse response = fileStorageService.initiateUpload(request, principal.getUsername());
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    // ── POST /v1/files/{fileId}/chunk/{chunkIndex} ────────────────────────────

    /**
     * Uploads a single encrypted chunk and streams it directly to MinIO.
     *
     * <p>Request: {@code multipart/form-data} with:
     * <ul>
     *   <li>{@code chunk}         — Binary file part: {@code [12-byte IV] || [ciphertext+tag]}</li>
     *   <li>{@code sha256Checksum}— Hex SHA-256 of the entire chunk binary (IV + ciphertext)</li>
     *   <li>{@code ivChunk}       — Base64 12-byte IV (also embedded in chunk header, but stored here for DB)</li>
     * </ul>
     *
     * <p>The chunk binary is streamed directly from the request to MinIO —
     * no intermediate byte[] allocation occurs.
     *
     * @param fileId         Server-assigned file UUID from /initiate
     * @param chunkIndex     Zero-based chunk index
     * @param chunk          Binary multipart chunk file
     * @param sha256Checksum Hex SHA-256 checksum for integrity storage
     * @param ivChunk        Base64 12-byte AES-GCM IV
     */
    @PostMapping(
        value    = "/{fileId}/chunk/{chunkIndex}",
        consumes = MediaType.MULTIPART_FORM_DATA_VALUE
    )
    public ResponseEntity<ChunkUploadResponse> uploadChunk(
            @PathVariable UUID     fileId,
            @PathVariable @Min(0)  int chunkIndex,
            @RequestPart("chunk")  MultipartFile chunk,
            @RequestParam
            @NotBlank
            @Pattern(regexp = "^[0-9a-f]{64}$", message = "sha256Checksum must be 64 hex chars")
            String sha256Checksum,
            @RequestParam
            @NotBlank
            String ivChunk,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.debug("[POST /files/{}/chunk/{}] user={} size={}",
                fileId, chunkIndex, principal.getUsername(), chunk.getSize());

        ChunkUploadResponse response = fileStorageService.storeChunk(
                fileId,
                chunkIndex,
                chunk,
                sha256Checksum,
                ivChunk,
                principal.getUsername()
        );

        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    // ── POST /v1/files/{fileId}/complete ──────────────────────────────────────

    /**
     * Marks an upload as complete after all chunks have been uploaded.
     *
     * <p>The server validates that the number of stored chunks matches
     * {@code totalChunks} declared during initiation.
     * Transitions the file status from {@code UPLOADING} → {@code COMPLETE}.
     */
    @PostMapping("/{fileId}/complete")
    public ResponseEntity<FileMetadataDto> completeUpload(
            @PathVariable UUID fileId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.info("[POST /files/{}/complete] user={}", fileId, principal.getUsername());
        FileMetadataDto response = fileStorageService.completeUpload(fileId, principal.getUsername());
        return ResponseEntity.ok(response);
    }

    @GetMapping("/shared")
    public ResponseEntity<List<com.iitjammu.zkfs.dto.SharedFileResponse>> getSharedFiles(
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.info("[GET /files/shared] user={}", principal.getUsername());
        List<com.iitjammu.zkfs.dto.SharedFileResponse> response = shareService.getSharedFiles(principal.getUsername());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/{fileId}/share/user")
    public ResponseEntity<Void> shareFileWithUser(
            @PathVariable UUID fileId,
            @Valid @RequestBody com.iitjammu.zkfs.dto.UserShareRequest request,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.info("[POST /files/{}/share/user] owner={} target={}", fileId, principal.getUsername(), request.email());
        shareService.shareFileWithUser(fileId, principal.getUsername(), request);
        return ResponseEntity.status(HttpStatus.CREATED).build();
    }

    // ── Chunk Download ─────────────────────────────────────────────────────────

    /**
     * Lists files for the authenticated user, ordered by creation date descending.
     *
     * <p>Query params:
     * <ul>
     *   <li>{@code page} — zero-based page number (default 0)</li>
     *   <li>{@code size} — page size, 1–100 (default 20)</li>
     * </ul>
     */
    @GetMapping
    public ResponseEntity<Page<FileMetadataDto>> listFiles(
            @RequestParam(defaultValue = "0")  int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) UUID folderId,
            @RequestParam(defaultValue = "false") boolean deleted,
            @AuthenticationPrincipal UserDetails principal
    ) {
        int clampedSize = Math.min(Math.max(size, 1), 100);
        PageRequest pageable = PageRequest.of(page, clampedSize,
                Sort.by(Sort.Direction.DESC, "createdAt"));

        Page<FileMetadataDto> result = fileStorageService.listFiles(principal.getUsername(), folderId, deleted, pageable);
        return ResponseEntity.ok(result);
    }

    // ── GET /v1/files/{fileId} ────────────────────────────────────────────────

    @GetMapping("/{fileId}")
    public ResponseEntity<FileMetadataDto> getFile(
            @PathVariable UUID fileId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        FileMetadataDto dto = fileStorageService.getFile(fileId, principal.getUsername());
        return ResponseEntity.ok(dto);
    }

    // ── GET /v1/files/{fileId}/chunks ─────────────────────────────────────────

    /**
     * Returns the ordered list of chunk metadata for a file.
     * The client uses {@code ivChunk} and {@code sha256Checksum} from each
     * ChunkInfo to drive the decryption and integrity-verification steps.
     */
    @GetMapping("/{fileId}/chunks")
    public ResponseEntity<List<ChunkInfo>> getChunks(
            @PathVariable UUID fileId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        List<FileChunk> chunks = fileStorageService.getChunkMetadata(fileId, principal.getUsername());
        List<ChunkInfo> infos  = chunks.stream()
                .map(c -> new ChunkInfo(
                        c.getId(),
                        c.getChunkIndex(),
                        c.getChunkSize(),
                        c.getIvChunk(),
                        c.getSha256Checksum()
                ))
                .toList();
        return ResponseEntity.ok(infos);
    }

    /** Lightweight chunk descriptor returned to the download client. */
    public record ChunkInfo(
            java.util.UUID id,
            int            chunkIndex,
            long           chunkSize,
            String         ivChunk,       // Base64 IV for client-side AES-GCM decrypt
            String         sha256Checksum // Hex SHA-256 for integrity verification
    ) {}

    // ── GET /v1/files/{fileId}/chunk/{chunkIndex}/url ─────────────────────────

    /**
     * Generates a short-lived presigned URL for downloading a single encrypted chunk.
     *
     * <p>The client downloads the binary wire frame via this URL (bypassing the
     * Spring server entirely), then decrypts it locally with the unwrapped DEK.
     *
     * <p>Presigned URL expiry is configured via {@code minio.presigned-url-expiry}
     * (default: 3600 seconds).
     */
    @GetMapping("/{fileId}/chunk/{chunkIndex}/url")
    public ResponseEntity<Map<String, String>> getChunkDownloadUrl(
            @PathVariable UUID fileId,
            @PathVariable @Min(0) int chunkIndex,
            @AuthenticationPrincipal UserDetails principal
    ) {
        String url = fileStorageService.generateChunkDownloadUrl(
                fileId, chunkIndex, principal.getUsername()
        );
        return ResponseEntity.ok(Map.of("url", url, "fileId", fileId.toString(),
                "chunkIndex", String.valueOf(chunkIndex)));
    }

    // ── GET /v1/files/{fileId}/chunk/{chunkIndex}/stream ──────────────────────
    //   Phase 4 — Direct encrypted byte streaming from MinIO to browser

    /**
     * Streams the encrypted chunk wire frame directly from MinIO to the client.
     *
     * <p><strong>Pipeline (zero intermediate buffering):</strong>
     * <pre>
     *   MinIO GetObjectResponse (InputStream)
     *     → 8 KiB transfer buffer loop
     *       → HttpServletResponse OutputStream
     *         → client TCP socket
     * </pre>
     *
     * <p><strong>Response headers for the download orchestrator:</strong>
     * <ul>
     *   <li>{@code Content-Length}      — encrypted chunk size in bytes (for progress reporting)</li>
     *   <li>{@code X-Chunk-Index}       — zero-based chunk index</li>
     *   <li>{@code X-SHA256-Checksum}   — hex SHA-256 of the wire frame (IV+ciphertext+tag)</li>
     *   <li>{@code X-IV-Chunk}          — Base64 12-byte AES-GCM IV (also embedded in frame)</li>
     * </ul>
     *
     * <p>The server serves the ciphertext verbatim. Decryption happens entirely
     * in the browser using the session DEK (unwrapped client-side from wrappedDek).
     *
     * <p>Uses Spring's {@link StreamingResponseBody} to avoid loading the entire
     * chunk into the JVM heap before writing — the InputStream is piped buffer-by-buffer.
     *
     * @param fileId      File UUID
     * @param chunkIndex  Zero-based chunk index (0 … totalChunks-1)
     * @param principal   Authenticated user (ownership verified in service layer)
     */
    @GetMapping(
        value    = "/{fileId}/chunk/{chunkIndex}/stream",
        produces = MediaType.APPLICATION_OCTET_STREAM_VALUE
    )
    public ResponseEntity<StreamingResponseBody> streamChunk(
            @PathVariable UUID fileId,
            @PathVariable @Min(0) int chunkIndex,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.debug("[GET /files/{}/chunk/{}/stream] user={}", fileId, chunkIndex, principal.getUsername());

        // Look up the chunk entity (also verifies file ownership)
        FileChunk chunk = fileStorageService.getChunkEntity(fileId, chunkIndex, principal.getUsername());

        // Build the streaming response body — no bytes read until the lambda executes
        StreamingResponseBody body = outputStream ->
                fileStorageService.streamChunkToOutputStream(chunk, outputStream);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                // Content-Length lets Axios report accurate download progress
                .header(HttpHeaders.CONTENT_LENGTH,    String.valueOf(chunk.getChunkSize()))
                // Content-Disposition: inline so browser doesn't show save dialog
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"chunk-" + chunkIndex + ".enc\"")
                // Custom headers deliver decryption metadata alongside the bytes.
                // The client can verify integrity and decrypt without a separate API call.
                .header("X-Chunk-Index",     String.valueOf(chunkIndex))
                .header("X-SHA256-Checksum", chunk.getSha256Checksum())
                .header("X-IV-Chunk",        chunk.getIvChunk())
                // Expose custom headers to browser JavaScript (CORS requirement)
                .header(HttpHeaders.ACCESS_CONTROL_EXPOSE_HEADERS,
                        "X-Chunk-Index, X-SHA256-Checksum, X-IV-Chunk, Content-Length")
                .body(body);
    }

    // ── DELETE /v1/files/{fileId} (Soft Delete) ───────────────────────────

    /**
     * Soft-deletes a file (moves to trash).
     */
    @DeleteMapping("/{fileId}")
    public ResponseEntity<Void> deleteFile(
            @PathVariable UUID fileId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.info("[DELETE /files/{}] user={}", fileId, principal.getUsername());
        fileStorageService.deleteFile(fileId, principal.getUsername());
        return ResponseEntity.noContent().build();
    }

    // ── POST /v1/files/{fileId}/restore ───────────────────────────────────────

    /**
     * Restores a soft-deleted file.
     */
    @PostMapping("/{fileId}/restore")
    public ResponseEntity<Void> restoreFile(
            @PathVariable UUID fileId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.info("[POST /files/{}/restore] user={}", fileId, principal.getUsername());
        fileStorageService.restoreFile(fileId, principal.getUsername());
        return ResponseEntity.ok().build();
    }

    // ── DELETE /v1/files/{fileId}/force ───────────────────────────────────────

    /**
     * Permanently deletes a file and all its encrypted chunks.
     */
    @DeleteMapping("/{fileId}/force")
    public ResponseEntity<Void> hardDeleteFile(
            @PathVariable UUID fileId,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.info("[DELETE /files/{}/force] user={}", fileId, principal.getUsername());
        fileStorageService.hardDeleteFile(fileId, principal.getUsername());
        return ResponseEntity.noContent().build();
    }
}
