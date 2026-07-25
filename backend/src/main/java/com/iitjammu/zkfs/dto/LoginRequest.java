package com.iitjammu.zkfs.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request body for POST /api/v1/auth/login
 *
 * <p>The client sends the HKDF-derived {@code authHash} rather than
 * the plaintext password. The server verifies via bcrypt.matches().
 */
public record LoginRequest(

        @NotBlank(message = "Email is required")
        @Email(message = "Email must be a valid address")
        String email,

        /**
         * 64-char hex-encoded HKDF authentication hash.
         * Must match the bcrypt hash stored during registration.
         */
        @NotBlank(message = "Auth hash is required")
        @Pattern(
            regexp  = "^[0-9a-f]{64}$",
            message = "authHash must be a 64-character lowercase hex string"
        )
        String authHash

) {}
