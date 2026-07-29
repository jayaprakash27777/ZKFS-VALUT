package com.iitjammu.zkfs.dto;

import jakarta.validation.constraints.*;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Request body for POST /api/v1/files/initiate
 *
 * <p>All sensitive fields ({@code filenameEncrypted}, {@code wrappedDek},
 * {@code ivWrappedDek}) are opaque ciphertext blobs — the server cannot
 * read the original filename or the DEK.
 */
public record InitiateUploadRequest(

        /**
         * AES-GCM ciphertext of the original filename, Base64-encoded.
         * Encrypted client-side with the user's KEK.
         */
        @NotBlank(message = "filenameEncrypted is required")
        String filenameEncrypted,

        /** Optional plaintext MIME type hint (e.g. "application/pdf"). */
        String mimeType,

        /** Optional Base64(AES-GCM(thumbnail)) */
        String thumbnailEncrypted,

        @Min(value = 1, message = "totalChunks must be at least 1")
        @Max(value = 10_000, message = "totalChunks cannot exceed 10,000")
        int totalChunks,

        @Min(value = 0, message = "totalSize must be non-negative")
        @Max(value = 5_368_709_120L, message = "totalSize cannot exceed 5 GiB")
        long totalSize,

        /**
         * Base64-encoded AES-GCM wrapped DEK.
         * The DEK was encrypted client-side using the user's KEK.
         */
        @NotBlank(message = "wrappedDek is required")
        String wrappedDek,

        /**
         * Base64-encoded 12-byte IV used during DEK wrapping.
         * Stored alongside wrappedDek for client-side unwrapping.
         */
        @NotBlank(message = "ivWrappedDek is required")
        @Size(min = 16, max = 24, message = "ivWrappedDek must be a Base64-encoded 12-byte IV")
        String ivWrappedDek,
        
        java.util.UUID folderId,

        @JsonProperty("isPasswordProtected")
        boolean isPasswordProtected,

        String passwordSalt,

        @JsonProperty("isPasskeyProtected")
        boolean isPasskeyProtected,

        String passkeySalt

) {}
