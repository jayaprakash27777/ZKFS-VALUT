package com.iitjammu.zkfs.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for POST /api/v1/auth/register
 *
 * <p>Zero-Knowledge contract:
 * <ul>
 *   <li>{@code authHash} — a 64-char hex string derived via HKDF(KEK, "zkfs-auth-v1").
 *       It is cryptographically separate from the KEK, so the server cannot
 *       reconstruct the user's encryption key even if the database is breached.</li>
 *   <li>{@code salt} — Base64-encoded 16-byte Argon2id salt generated in the browser.
 *       Stored on the server and returned on login so the client can re-derive KEK.</li>
 * </ul>
 */
public record RegisterRequest(

        @NotBlank(message = "Email is required")
        @Email(message = "Email must be a valid address")
        @Size(max = 255, message = "Email must not exceed 255 characters")
        String email,

        /**
         * 64-char hex-encoded HKDF-derived authentication hash.
         * Pattern: exactly 64 lowercase hex digits.
         * Server stores bcrypt(authHash) — never the raw hash.
         */
        @NotBlank(message = "Auth hash is required")
        @Pattern(
            regexp  = "^[0-9a-f]{64}$",
            message = "authHash must be a 64-character lowercase hex string"
        )
        String authHash,

        /**
         * Base64-encoded 16-byte Argon2id salt.
         * Valid Base64 for 16 bytes encodes to exactly 24 characters (with padding).
         */
        @NotBlank(message = "Salt is required")
        @Size(min = 24, max = 24, message = "Salt must be a 24-character Base64 string (16 bytes)")
        String salt,

        String recoveryWrappedKek,
        String recoveryIv

) {}
