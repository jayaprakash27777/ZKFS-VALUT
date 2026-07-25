package com.iitjammu.zkfs.dto;

import jakarta.validation.constraints.*;

import java.util.UUID;

/**
 * Request body for POST /v1/share
 *
 * <p>All crypto fields are server-opaque — the server stores them verbatim
 * without being able to decrypt or verify them. The share password is
 * never included; only its Argon2id salt is stored.
 */
public record CreateShareRequest(

        /** UUID of the file to share (optional if folderId is provided). */
        UUID fileId,

        /** UUID of the folder to share (optional if fileId is provided). */
        UUID folderId,

        /**
         * Base64-encoded Argon2id salt used to derive shareKEK from the share password.
         * Generated client-side for each new share.
         */
        @NotBlank(message = "shareSaltB64 is required")
        String shareSaltB64,

        /**
         * Base64(AES-GCM(DEK_bytes, shareKEK)) — the file DEK re-wrapped with the shareKEK.
         * Only the recipient who knows the share password can unwrap this.
         */
        @NotBlank(message = "shareWrappedDek is required")
        String shareWrappedDek,

        /**
         * Base64-encoded 12-byte IV used when wrapping the DEK with shareKEK.
         */
        @NotBlank(message = "shareIvDek is required")
        String shareIvDek,

        /**
         * Base64(AES-GCM(filename_plaintext, shareKEK)) — filename re-encrypted
         * with the shareKEK so the recipient can learn the filename without the server seeing it.
         */
        @NotBlank(message = "shareEncFilename is required")
        String shareEncFilename,

        /**
         * Base64-encoded 12-byte IV for filename re-encryption.
         */
        @NotBlank(message = "shareIvFilename is required")
        String shareIvFilename,

        /**
         * Optional expiry in hours from now. Null or 0 = never expires.
         * Capped at 720 hours (30 days).
         */
        @Min(value = 0, message = "expiresHours must be non-negative")
        @Max(value = 720, message = "expiresHours cannot exceed 720 (30 days)")
        Integer expiresHours,

        /**
         * Optional maximum number of downloads allowed. Null or 0 = unlimited.
         */
        @Min(value = 0, message = "maxDownloads must be non-negative")
        @Max(value = 10_000, message = "maxDownloads cannot exceed 10,000")
        Integer maxDownloads

) {}
