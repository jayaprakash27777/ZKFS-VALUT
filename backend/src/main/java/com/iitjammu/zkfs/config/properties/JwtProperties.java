package com.iitjammu.zkfs.config.properties;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Type-safe binding for the {@code jwt.*} block in application.yml.
 *
 * <pre>
 * jwt:
 *   secret: &lt;base64-512bit-key&gt;
 *   access-token-expiry-ms:  900000
 *   refresh-token-expiry-ms: 604800000
 *   issuer: zk-file-storage
 * </pre>
 */
@ConfigurationProperties(prefix = "jwt")
public record JwtProperties(
        String secret,
        long accessTokenExpiryMs,
        long refreshTokenExpiryMs,
        String issuer
) {}
