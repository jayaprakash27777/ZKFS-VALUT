package com.iitjammu.zkfs.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Response body for both /register and /login endpoints.
 *
 * <p>Contains:
 * <ul>
 *   <li>JWT access token (short-lived, 15 minutes)</li>
 *   <li>JWT refresh token (long-lived, 7 days)</li>
 *   <li>Minimal user profile (id, email, salt, createdAt)</li>
 * </ul>
 *
 * <p>The {@code salt} field is returned so the client can immediately
 * re-derive the KEK without a separate salt-fetch round trip on re-login.
 */
public record AuthResponse(

        @JsonProperty("accessToken")
        String accessToken,

        @JsonProperty("refreshToken")
        String refreshToken,

        @JsonProperty("tokenType")
        String tokenType,

        @JsonProperty("expiresIn")
        long expiresIn,    // Access token TTL in seconds

        @JsonProperty("user")
        UserProfile user

) {
    /** Nested user profile embedded in auth responses. */
    public record UserProfile(
            UUID           id,
            String         email,
            String         salt,         // Base64 Argon2 salt — needed for KEK re-derivation
            String         encPrivateKey,
            String         publicKey,
            OffsetDateTime createdAt
    ) {}

    /** Factory method for building the response cleanly from service layer. */
    public static AuthResponse of(
            String      accessToken,
            String      refreshToken,
            long        accessTokenExpiryMs,
            UserProfile user
    ) {
        return new AuthResponse(
                accessToken,
                refreshToken,
                "Bearer",
                accessTokenExpiryMs / 1000L,
                user
        );
    }
}
