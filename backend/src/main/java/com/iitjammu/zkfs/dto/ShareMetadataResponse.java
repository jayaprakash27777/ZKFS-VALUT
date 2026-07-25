package com.iitjammu.zkfs.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Public response for GET /v1/share/{token}
 *
 * <p>This is served WITHOUT authentication to any caller with the share token.
 * All sensitive fields are server-opaque crypto blobs — they are only useful
 * to someone who also knows the share password.
 *
 * <p>Security properties:
 * <ul>
 *   <li>The share password is never stored or returned</li>
 *   <li>The raw DEK is never stored or returned</li>
 *   <li>The plaintext filename is never stored or returned</li>
 *   <li>Only the password holder can derive shareKEK and unwrap the blobs</li>
 * </ul>
 */
public record ShareMetadataResponse(

        /** The share token itself (for client convenience). */
        @JsonProperty("shareToken")
        UUID shareToken,

        /** Whether this share points to a folder. */
        @JsonProperty("isFolder")
        boolean isFolder,

        // ── Opaque crypto blobs ───────────────────────────────────────────

        /** Argon2id salt — recipient uses this to derive shareKEK from password. */
        @JsonProperty("shareSaltB64")
        String shareSaltB64,

        /** AES-GCM wrapped DEK — decrypt with shareKEK to get the file's DEK. */
        @JsonProperty("shareWrappedDek")
        String shareWrappedDek,

        /** IV for DEK unwrapping. */
        @JsonProperty("shareIvDek")
        String shareIvDek,

        /** AES-GCM encrypted filename — decrypt with shareKEK to get plaintext filename. */
        @JsonProperty("shareEncFilename")
        String shareEncFilename,

        /** IV for filename decryption. */
        @JsonProperty("shareIvFilename")
        String shareIvFilename,

        // ── Plaintext metadata (safe to expose) ──────────────────────────

        /** Optional MIME type hint (e.g. "application/pdf") — stored in plaintext. */
        @JsonProperty("mimeType")
        String mimeType,

        /** Number of encrypted chunks to download. */
        @JsonProperty("totalChunks")
        int totalChunks,

        /** Original file size in bytes (pre-encryption). */
        @JsonProperty("totalSize")
        long totalSize,

        /** Optional expiry timestamp. Null = never expires. */
        @JsonProperty("expiresAt")
        OffsetDateTime expiresAt,

        /** Optional download limit. Null = unlimited. */
        @JsonProperty("maxDownloads")
        Integer maxDownloads,

        /** How many times this share has been downloaded so far. */
        @JsonProperty("downloadCount")
        int downloadCount

) {}
