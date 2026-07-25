package com.iitjammu.zkfs.dto;

/**
 * Response for GET /api/v1/auth/salt?email={email}
 *
 * <p>Returned to the client before login so it can re-derive the KEK
 * via Argon2id(password, salt) without performing authentication first.
 *
 * <p>Security note: This endpoint is intentionally public. Returning the salt
 * for a non-existent email would reveal user enumeration. To mitigate this,
 * the server should return a deterministic fake salt for unknown emails
 * (derived from a server-side HMAC of the email). See AuthService for impl.
 */
public record SaltResponse(

        /** Base64-encoded 16-byte Argon2id salt. */
        String salt,

        String recoveryWrappedKek,
        String recoveryIv

) {}
