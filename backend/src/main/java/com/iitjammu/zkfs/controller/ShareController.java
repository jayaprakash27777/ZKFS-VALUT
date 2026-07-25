package com.iitjammu.zkfs.controller;

import com.iitjammu.zkfs.domain.FileChunk;
import com.iitjammu.zkfs.dto.CreateShareRequest;
import com.iitjammu.zkfs.dto.CreateShareResponse;
import com.iitjammu.zkfs.dto.ShareMetadataResponse;
import com.iitjammu.zkfs.service.ShareService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.util.List;
import java.util.UUID;

/**
 * ShareController — Password-Protected File Share API
 * ═════════════════════════════════════════════════════
 *
 * <pre>
 *   POST   /v1/share                              Create share (JWT required)
 *   GET    /v1/share                              List my shares (JWT required)
 *   GET    /v1/share/{token}                      Get share metadata (PUBLIC)
 *   GET    /v1/share/{token}/chunk/{i}/stream     Stream chunk (PUBLIC)
 *   DELETE /v1/share/{token}                      Revoke share (JWT required)
 * </pre>
 *
 * <p>Public endpoints are secured by the share token + password (ZK protocol).
 * The server has no knowledge of the password or the raw DEK.
 */
@Slf4j
@Validated
@RestController
@RequestMapping("/v1/share")
@RequiredArgsConstructor
public class ShareController {

    private final ShareService shareService;

    // ── POST /v1/share — Create share (JWT required) ─────────────────────────

    @PostMapping
    public ResponseEntity<CreateShareResponse> createShare(
            @Valid @RequestBody CreateShareRequest request,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.info("[POST /share] user={} fileId={}", principal.getUsername(), request.fileId());
        CreateShareResponse response = shareService.createShare(request, principal.getUsername());
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    // ── GET /v1/share — List my shares (JWT required) ────────────────────────

    @GetMapping
    public ResponseEntity<List<ShareMetadataResponse>> listMyShares(
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.debug("[GET /share] listing shares for user={}", principal.getUsername());
        return ResponseEntity.ok(shareService.listMyShares(principal.getUsername()));
    }

    // ── GET /v1/share/{token} — Get share metadata (PUBLIC, no JWT) ──────────

    @GetMapping("/{token}")
    public ResponseEntity<ShareMetadataResponse> getShareMetadata(
            @PathVariable UUID token
    ) {
        log.debug("[GET /share/{}] fetching metadata", token);
        return ResponseEntity.ok(shareService.getShareMetadata(token));
    }

    // ── GET /v1/share/{token}/chunk/{i}/stream — Stream chunk (PUBLIC) ───────

    /**
     * Streams an encrypted chunk to the recipient.
     * Token validity and expiry are checked in the service.
     * No JWT required — the share token IS the authorization.
     *
     * <p>Response headers delivered to the browser:
     * <ul>
     *   <li>{@code Content-Length}     — chunk size for progress reporting</li>
     *   <li>{@code X-Chunk-Index}      — zero-based chunk index</li>
     *   <li>{@code X-SHA256-Checksum}  — hex SHA-256 for tamper detection</li>
     *   <li>{@code X-IV-Chunk}         — Base64 AES-GCM IV for decryption</li>
     * </ul>
     */
    @GetMapping(
        value    = "/{token}/chunk/{chunkIndex}/stream",
        produces = MediaType.APPLICATION_OCTET_STREAM_VALUE
    )
    public ResponseEntity<StreamingResponseBody> streamShareChunk(
            @PathVariable UUID token,
            @PathVariable @Min(0) int chunkIndex
    ) {
        log.debug("[GET /share/{}/chunk/{}/stream]", token, chunkIndex);

        FileChunk chunk = shareService.resolveShareChunk(token, chunkIndex);

        StreamingResponseBody body = outputStream ->
                shareService.streamChunkToOutputStream(chunk, outputStream);

        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_LENGTH,     String.valueOf(chunk.getChunkSize()))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"chunk-" + chunkIndex + ".enc\"")
                .header("X-Chunk-Index",     String.valueOf(chunkIndex))
                .header("X-SHA256-Checksum", chunk.getSha256Checksum())
                .header("X-IV-Chunk",        chunk.getIvChunk())
                .header(HttpHeaders.ACCESS_CONTROL_EXPOSE_HEADERS,
                        "X-Chunk-Index, X-SHA256-Checksum, X-IV-Chunk, Content-Length")
                .body(body);
    }

    // ── DELETE /v1/share/{token} — Revoke share (JWT required) ───────────────

    @DeleteMapping("/{token}")
    public ResponseEntity<Void> revokeShare(
            @PathVariable UUID token,
            @AuthenticationPrincipal UserDetails principal
    ) {
        log.info("[DELETE /share/{}] user={}", token, principal.getUsername());
        shareService.revokeShare(token, principal.getUsername());
        return ResponseEntity.noContent().build();
    }
}
