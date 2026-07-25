package com.iitjammu.zkfs.config;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

/**
 * CORS Configuration for the Zero-Knowledge File Storage API.
 *
 * <p><strong>Security policy:</strong>
 * <ul>
 *   <li>Only the explicitly configured origin(s) are allowed — no wildcard.</li>
 *   <li>Credentials (cookies, Authorization header) are permitted.</li>
 *   <li>Preflight cache is set to 1 hour to reduce OPTIONS round-trips.</li>
 *   <li>Only the HTTP methods needed by the REST API are exposed.</li>
 * </ul>
 *
 * <p>Spring Security's {@code .cors()} directive in {@link SecurityConfig}
 * delegates to this bean automatically.
 */
@Slf4j
@Configuration
@RequiredArgsConstructor
public class CorsConfig {

    /**
     * Primary allowed origin — the Next.js dev server.
     * Injected from {@code cors.allowed-origins[0]} in application.yml.
     */
    @Value("${cors.allowed-origins}")
    private List<String> allowedOrigins;

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();

        // ── Origins ──────────────────────────────────────────────────────────
        // Explicitly list allowed origins; never use "*" when credentials=true
        List<String> filteredOrigins = allowedOrigins.stream()
                .filter(o -> o != null && !o.isBlank())
                .toList();

        config.setAllowedOrigins(filteredOrigins);
        log.info("CORS allowed origins configured: {}", filteredOrigins);

        // ── Methods ───────────────────────────────────────────────────────────
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));

        // ── Headers ───────────────────────────────────────────────────────────
        config.setAllowedHeaders(List.of(
                "Authorization",
                "Content-Type",
                "Accept",
                "X-Requested-With",
                "X-Chunk-Index",        // Custom header for chunked uploads
                "X-File-Id",            // Custom header for upload session tracking
                "Cache-Control",
                "Origin"
        ));

        // ── Exposed Headers ───────────────────────────────────────────────────
        // Headers the browser JS can read from cross-origin responses.
        // Phase 4 download: the streaming endpoint returns decryption metadata
        // (SHA-256, IV, chunk index) in custom headers alongside the binary body.
        config.setExposedHeaders(List.of(
                "Authorization",
                "Content-Disposition",
                "Content-Length",          // For accurate Axios download progress
                "X-Upload-Id",
                "X-Chunk-Index",           // Zero-based chunk index
                "X-SHA256-Checksum",       // Hex SHA-256 of wire frame (IV+cipher+tag)
                "X-IV-Chunk"               // Base64 12-byte AES-GCM IV
        ));


        // ── Credentials ───────────────────────────────────────────────────────
        // Required for JWT in Authorization header / HttpOnly cookies
        config.setAllowCredentials(true);

        // ── Preflight Cache ───────────────────────────────────────────────────
        config.setMaxAge(3600L); // 1 hour

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/v1/**", config);  // Only API routes
        return source;
    }
}
