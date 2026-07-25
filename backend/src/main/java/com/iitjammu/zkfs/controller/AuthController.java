package com.iitjammu.zkfs.controller;

import com.iitjammu.zkfs.dto.AuthResponse;
import com.iitjammu.zkfs.dto.LoginRequest;
import com.iitjammu.zkfs.dto.RegisterRequest;
import com.iitjammu.zkfs.dto.SaltResponse;
import com.iitjammu.zkfs.service.AuthService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Authentication REST Controller
 * ════════════════════════════════
 *
 * All endpoints are under {@code /api/v1/auth} (Spring context-path + prefix).
 *
 * <pre>
 *   POST   /api/v1/auth/register    Register a new user
 *   POST   /api/v1/auth/login       Login and obtain JWT tokens
 *   POST   /api/v1/auth/refresh     Refresh the access token
 *   GET    /api/v1/auth/salt        Fetch salt for KEK derivation (pre-login)
 *   GET    /api/v1/auth/me          Get current authenticated user info
 * </pre>
 *
 * All auth endpoints (except {@code /me}) are public — configured in
 * {@link com.iitjammu.zkfs.config.SecurityConfig}.
 */
@Slf4j
@Validated
@RestController
@RequestMapping("/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    // ── POST /v1/auth/register ─────────────────────────────────────────────

    /**
     * Register a new user.
     *
     * <p>Request body:
     * <pre>
     * {
     *   "email":    "alice@example.com",
     *   "authHash": "abc123...64hex...",   // HKDF(Argon2id(password, salt), "zkfs-auth-v1")
     *   "salt":     "base64==...24chars"   // Argon2id salt (16 bytes, Base64)
     * }
     * </pre>
     *
     * <p>Response (201 Created): AuthResponse with JWT tokens and user profile.
     */
    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(
            @Valid @RequestBody RegisterRequest request
    ) {
        log.info("[POST /register] email={}", request.email());
        AuthResponse response = authService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    // ── POST /v1/auth/login ────────────────────────────────────────────────

    /**
     * Authenticate and obtain JWT tokens.
     *
     * <p>Request body:
     * <pre>
     * {
     *   "email":    "alice@example.com",
     *   "authHash": "abc123...64hex..."
     * }
     * </pre>
     *
     * <p>Response (200 OK): AuthResponse with fresh JWT tokens.
     */
    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(
            @Valid @RequestBody LoginRequest request
    ) {
        log.debug("[POST /login] email={}", request.email());
        AuthResponse response = authService.login(request);
        return ResponseEntity.ok(response);
    }

    // ── POST /v1/auth/refresh ──────────────────────────────────────────────

    /**
     * Refresh the access token using a valid refresh token.
     *
     * <p>Request body:
     * <pre>
     * { "refreshToken": "eyJhbGci..." }
     * </pre>
     *
     * <p>Response (200 OK): AuthResponse with new access + refresh tokens.
     */
    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(
            @RequestBody Map<String, String> body
    ) {
        String refreshToken = body.get("refreshToken");
        if (refreshToken == null || refreshToken.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        AuthResponse response = authService.refreshTokens(refreshToken);
        return ResponseEntity.ok(response);
    }

    // ── GET /v1/auth/salt ──────────────────────────────────────────────────

    /**
     * Fetch the Argon2id salt for a given email.
     *
     * <p>Called by the client BEFORE login to derive KEK via Argon2id.
     *
     * <p>Anti-enumeration: For unknown emails, returns a deterministic fake
     * salt so an attacker cannot determine whether an account exists.
     *
     * <p>Query param: {@code ?email=alice@example.com}
     */
    @GetMapping("/salt")
    public ResponseEntity<SaltResponse> getSalt(
            @RequestParam
            @NotBlank(message = "Email parameter is required")
            @Email(message = "Email must be a valid address")
            String email
    ) {
        SaltResponse response = authService.getSalt(email);
        return ResponseEntity.ok(response);
    }

    // ── GET /v1/auth/me ────────────────────────────────────────────────────

    /**
     * Returns basic profile info for the currently authenticated user.
     * Requires a valid Bearer token — protected by Spring Security.
     *
     * <p>Uses the {@link org.springframework.security.core.annotation.AuthenticationPrincipal}
     * to inject the authenticated UserDetails without a DB call.
     */
    @GetMapping("/me")
    public ResponseEntity<Map<String, String>> getMe(
            @org.springframework.security.core.annotation.AuthenticationPrincipal
            org.springframework.security.core.userdetails.UserDetails userDetails
    ) {
        if (userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        return ResponseEntity.ok(Map.of("email", userDetails.getUsername()));
    }

    @PutMapping("/recovery-key")
    public ResponseEntity<Void> updateRecoveryKey(
            @Valid @RequestBody com.iitjammu.zkfs.dto.UpdateRecoveryKeyRequest request,
            @org.springframework.security.core.annotation.AuthenticationPrincipal
            org.springframework.security.core.userdetails.UserDetails userDetails
    ) {
        if (userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        authService.updateRecoveryKey(userDetails.getUsername(), request);
        return ResponseEntity.ok().build();
    }

    @PutMapping("/keys")
    public ResponseEntity<Void> updateKeys(
            @Valid @RequestBody com.iitjammu.zkfs.dto.UpdateKeysRequest request,
            @org.springframework.security.core.annotation.AuthenticationPrincipal
            org.springframework.security.core.userdetails.UserDetails userDetails
    ) {
        if (userDetails == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        authService.updateKeys(userDetails.getUsername(), request.publicKey(), request.encPrivateKey());
        return ResponseEntity.ok().build();
    }
}
