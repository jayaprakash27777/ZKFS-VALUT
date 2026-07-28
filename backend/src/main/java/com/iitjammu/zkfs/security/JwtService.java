package com.iitjammu.zkfs.security;

import com.iitjammu.zkfs.config.properties.JwtProperties;
import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.util.Base64;
import java.util.Date;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/**
 * JWT utility service for generating and validating access / refresh tokens.
 *
 * <p>Token structure:
 * <pre>
 *   Header : { alg: "HS512", typ: "JWT" }
 *   Payload: { sub: email, jti: uuid, iss: issuer, iat, exp, type: "access"|"refresh" }
 * </pre>
 *
 * <p>Signing: HMAC-SHA512 with a ≥512-bit secret key from configuration.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class JwtService {

    private final JwtProperties jwtProperties;

    // ── Token Generation ──────────────────────────────────────────────────────

    public String generateAccessToken(UserDetails userDetails) {
        return generateAccessToken(Map.of(), userDetails);
    }

    public String generateAccessToken(Map<String, Object> extraClaims, UserDetails userDetails) {
        return buildToken(extraClaims, userDetails, jwtProperties.accessTokenExpiryMs(), "access");
    }

    public String generateRefreshToken(UserDetails userDetails) {
        return buildToken(Map.of(), userDetails, jwtProperties.refreshTokenExpiryMs(), "refresh");
    }

    private String buildToken(
            Map<String, Object> extraClaims,
            UserDetails userDetails,
            long expiryMs,
            String tokenType
    ) {
        long now = System.currentTimeMillis();
        return Jwts.builder()
                .claims(extraClaims)
                .subject(userDetails.getUsername())    // username = email
                .issuer(jwtProperties.issuer())
                .issuedAt(new Date(now))
                .expiration(new Date(now + expiryMs))
                .id(UUID.randomUUID().toString())      // jti — for future revocation
                .claim("type", tokenType)
                .signWith(getSigningKey(), Jwts.SIG.HS512)
                .compact();
    }

    // ── Token Validation ──────────────────────────────────────────────────────

    public boolean isTokenValid(String token, UserDetails userDetails) {
        try {
            String subject = extractSubject(token);
            return subject.equals(userDetails.getUsername()) && !isTokenExpired(token);
        } catch (JwtException | IllegalArgumentException e) {
            log.warn("JWT validation failed: {}", e.getMessage());
            return false;
        }
    }

    public boolean isTokenExpired(String token) {
        return extractExpiration(token).before(new Date());
    }

    // ── Claims Extraction ─────────────────────────────────────────────────────

    public String extractSubject(String token) {
        return extractClaim(token, Claims::getSubject);
    }

    public Date extractExpiration(String token) {
        return extractClaim(token, Claims::getExpiration);
    }

    public String extractTokenType(String token) {
        return extractClaim(token, claims -> claims.get("type", String.class));
    }

    public <T> T extractClaim(String token, Function<Claims, T> claimsResolver) {
        Claims claims = extractAllClaims(token);
        return claimsResolver.apply(claims);
    }

    private Claims extractAllClaims(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    // ── Signing Key ───────────────────────────────────────────────────────────

    private SecretKey getSigningKey() {
        byte[] keyBytes = jwtProperties.secret().getBytes();
        return Keys.hmacShaKeyFor(keyBytes);
    }
}
