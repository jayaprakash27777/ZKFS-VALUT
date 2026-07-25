package com.iitjammu.zkfs.service;

import com.iitjammu.zkfs.config.properties.JwtProperties;
import com.iitjammu.zkfs.domain.User;
import com.iitjammu.zkfs.dto.AuthResponse;
import com.iitjammu.zkfs.dto.LoginRequest;
import com.iitjammu.zkfs.dto.RegisterRequest;
import com.iitjammu.zkfs.dto.SaltResponse;
import com.iitjammu.zkfs.exception.InvalidCredentialsException;
import com.iitjammu.zkfs.exception.UserAlreadyExistsException;
import com.iitjammu.zkfs.repository.UserRepository;
import com.iitjammu.zkfs.security.JwtService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

/**
 * Authentication Service — Zero-Knowledge Auth Flow
 * ══════════════════════════════════════════════════
 *
 * <h3>Registration Flow:</h3>
 * <pre>
 *   Browser:  password + newSalt → Argon2id → KEK → HKDF("zkfs-auth-v1") → authHash
 *   Client → Server: { email, authHash (hex64), salt (base64) }
 *   Server: stores { email, bcrypt(authHash), salt }
 * </pre>
 *
 * <h3>Login Flow:</h3>
 * <pre>
 *   Client → Server:  GET /auth/salt?email=...
 *   Server → Client:  { salt }  (or fake deterministic salt if user not found)
 *   Browser:  password + salt → Argon2id → KEK → HKDF → authHash
 *   Client → Server:  POST /auth/login { email, authHash }
 *   Server:  bcrypt.verify(authHash, storedHash) → issue JWT
 * </pre>
 *
 * <h3>Security Properties:</h3>
 * <ul>
 *   <li>Plaintext password never transmitted over the network.</li>
 *   <li>authHash ≠ KEK — HKDF domain-separation prevents key recovery from authHash.</li>
 *   <li>Server stores bcrypt(authHash) — cracking it yields authHash, not KEK.</li>
 *   <li>Salt endpoint returns fake salt for unknown emails to prevent enumeration.</li>
 *   <li>Constant-time bcrypt comparison prevents timing attacks.</li>
 * </ul>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository  userRepository;
    private final PasswordEncoder passwordEncoder;      // BCrypt(12)
    private final JwtService      jwtService;
    private final JwtProperties   jwtProperties;

    /**
     * Server-side HMAC key for generating fake deterministic salts.
     * MUST be set via environment variable in production.
     * Prevents timing-attack-based user enumeration on the salt endpoint.
     */
    private static final String FAKE_SALT_HMAC_KEY =
            System.getenv().getOrDefault("FAKE_SALT_HMAC_KEY",
                    "CHANGE_ME_FAKE_SALT_HMAC_KEY_32BYTES_MIN");

    // ── Registration ──────────────────────────────────────────────────────────

    /**
     * Registers a new user with their client-derived auth hash and Argon2id salt.
     *
     * @param request  Contains email, authHash (hex), and salt (Base64)
     * @throws UserAlreadyExistsException if the email is already registered
     */
    @Transactional
    public AuthResponse register(RegisterRequest request) {
        log.info("Registration attempt for email: {}", request.email());

        // ── 1. Check uniqueness ───────────────────────────────────────────────
        if (userRepository.existsByEmail(request.email())) {
            throw new UserAlreadyExistsException(request.email());
        }

        // ── 2. Validate authHash format (defense-in-depth beyond Bean Validation) ─
        validateAuthHashFormat(request.authHash());

        // ── 3. Hash the authHash with BCrypt ──────────────────────────────────
        //   The server stores bcrypt(authHash), not the raw hash.
        //   Cost factor 12 — deliberate slowness for brute-force resistance.
        String bcryptedHash = passwordEncoder.encode(request.authHash());

        // ── 4. Persist user ───────────────────────────────────────────────────
        User user = User.builder()
                .email(request.email())
                .passwordHash(bcryptedHash)          // bcrypt(authHash)
                .salt(request.salt())                // Base64 Argon2 salt
                .recoveryWrappedKek(request.recoveryWrappedKek())
                .recoveryIv(request.recoveryIv())
                .build();

        user = userRepository.save(user);
        log.info("User registered successfully: id={}", user.getId());

        // ── 5. Issue JWT tokens ────────────────────────────────────────────────
        return buildAuthResponse(user);
    }

    // ── Login ─────────────────────────────────────────────────────────────────

    /**
     * Authenticates a user by verifying their client-derived authHash against
     * the stored bcrypt hash.
     *
     * @param request  Contains email and authHash
     * @throws InvalidCredentialsException if email not found or authHash doesn't match
     */
    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest request) {
        log.debug("Login attempt for email: {}", request.email());

        // ── 1. Look up user (constant-time path regardless of existence) ──────
        Optional<User> userOpt = userRepository.findByEmail(request.email());

        // ── 2. Always run bcrypt even if user not found (prevents timing attack) ─
        //   If user doesn't exist, compare against a constant hash string.
        //   This ensures the response time is the same whether user exists or not.
        String storedHash = userOpt
                .map(User::getPasswordHash)
                .orElse("$2a$12$dummyHashToPreventTimingAttackAAAAAAAAAAAAAAAAAAAAAAAAAA");

        boolean matches = passwordEncoder.matches(request.authHash(), storedHash);

        // ── 3. Fail if user not found OR hash doesn't match ───────────────────
        if (userOpt.isEmpty() || !matches) {
            log.warn("Authentication failed for email: {}", request.email());
            throw new InvalidCredentialsException();
        }

        User user = userOpt.get();
        log.info("User authenticated: id={}", user.getId());

        // ── 4. Issue JWT tokens ────────────────────────────────────────────────
        return buildAuthResponse(user);
    }

    // ── Salt Endpoint ─────────────────────────────────────────────────────────

    /**
     * Returns the Argon2id salt for the given email.
     *
     * <p><strong>Anti-enumeration:</strong> For unknown emails, returns a
     * deterministic fake salt derived via HMAC-SHA256(email, serverKey).
     * This is indistinguishable from a real salt to the client but will
     * produce an authHash that never matches any stored record.
     *
     * @param email  User's email address
     * @return       SaltResponse with the real or fake salt
     */
    @Transactional(readOnly = true)
    public SaltResponse getSalt(String email) {
        return userRepository.findByEmail(email)
                .map(user -> new SaltResponse(user.getSalt(), user.getRecoveryWrappedKek(), user.getRecoveryIv()))
                .orElseGet(() -> new SaltResponse(generateFakeSalt(email), null, null));
    }

    // ── Token Refresh ─────────────────────────────────────────────────────────

    /**
     * Validates a refresh token and issues a new access + refresh token pair.
     *
     * @param refreshToken  The JWT refresh token string
     * @throws InvalidCredentialsException if the token is invalid or expired
     */
    @Transactional(readOnly = true)
    public AuthResponse refreshTokens(String refreshToken) {
        try {
            // Validate token type
            String tokenType = jwtService.extractTokenType(refreshToken);
            if (!"refresh".equals(tokenType)) {
                throw new InvalidCredentialsException();
            }

            String email = jwtService.extractSubject(refreshToken);
            User   user  = userRepository.findByEmail(email)
                    .orElseThrow(InvalidCredentialsException::new);

            UserDetails userDetails = toSpringUserDetails(user);

            if (!jwtService.isTokenValid(refreshToken, userDetails)) {
                throw new InvalidCredentialsException();
            }

            return buildAuthResponse(user);

        } catch (io.jsonwebtoken.JwtException ex) {
            log.warn("Invalid refresh token: {}", ex.getMessage());
            throw new InvalidCredentialsException();
        }
    }

    @Transactional
    public void updateKeys(String email, String publicKey, String encPrivateKey) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(InvalidCredentialsException::new);
        user.setPublicKey(publicKey);
        user.setEncPrivateKey(encPrivateKey);
        userRepository.save(user);
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    /**
     * Builds an {@link AuthResponse} including fresh access and refresh tokens.
     */
    private AuthResponse buildAuthResponse(User user) {
        UserDetails userDetails  = toSpringUserDetails(user);
        String      accessToken  = jwtService.generateAccessToken(userDetails);
        String      refreshToken = jwtService.generateRefreshToken(userDetails);

        AuthResponse.UserProfile profile = new AuthResponse.UserProfile(
                user.getId(),
                user.getEmail(),
                user.getSalt(),
                user.getEncPrivateKey(),
                user.getPublicKey(),
                user.getCreatedAt()
        );

        return AuthResponse.of(
                accessToken,
                refreshToken,
                jwtProperties.accessTokenExpiryMs(),
                profile
        );
    }

    /**
     * Wraps a {@link User} domain object into a Spring Security {@link UserDetails}.
     */
    private static UserDetails toSpringUserDetails(User user) {
        return new org.springframework.security.core.userdetails.User(
                user.getEmail(),
                user.getPasswordHash(),
                List.of(new SimpleGrantedAuthority("ROLE_USER"))
        );
    }

    /**
     * Generates a deterministic fake Argon2id salt for non-existent emails.
     * Uses HMAC-SHA256(email, FAKE_SALT_HMAC_KEY) truncated to 16 bytes,
     * then Base64-encoded — same format as a real salt.
     *
     * <p>The fake salt is consistent for the same email across requests, so
     * response timing is indistinguishable from a real user's salt lookup.
     */
    private static String generateFakeSalt(String email) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(
                    FAKE_SALT_HMAC_KEY.getBytes(StandardCharsets.UTF_8),
                    "HmacSHA256"
            ));
            byte[] hmac       = mac.doFinal(email.getBytes(StandardCharsets.UTF_8));
            byte[] saltBytes  = new byte[16];
            System.arraycopy(hmac, 0, saltBytes, 0, 16);  // Take first 16 bytes
            return Base64.getEncoder().encodeToString(saltBytes);
        } catch (Exception ex) {
            // Should never happen with standard HMAC-SHA256
            log.error("Failed to generate fake salt for enumeration protection", ex);
            return Base64.getEncoder().encodeToString(new byte[16]); // Fallback: zero salt
        }
    }

    /**
     * Defense-in-depth validation for authHash format.
     * Bean Validation on the DTO already checks this, but we re-validate
     * at the service layer for defense-in-depth.
     */
    private static void validateAuthHashFormat(String authHash) {
        if (authHash == null || !authHash.matches("^[0-9a-f]{64}$")) {
            throw new InvalidCredentialsException();
        }
    }

    @Transactional
    public void updateRecoveryKey(String email, com.iitjammu.zkfs.dto.UpdateRecoveryKeyRequest request) {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new RuntimeException("User not found"));
        user.setRecoveryWrappedKek(request.recoveryWrappedKek());
        user.setRecoveryIv(request.recoveryIv());
        userRepository.save(user);
    }
}
