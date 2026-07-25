package com.iitjammu.zkfs.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * JPA entity representing a registered user.
 *
 * <p>Zero-knowledge notes:
 * <ul>
 *   <li>{@code passwordHash} — bcrypt hash for server-side authentication only.</li>
 *   <li>{@code salt} — Base64-encoded random salt for client-side PBKDF2 / Argon2
 *       key derivation. The master encryption key never leaves the client.</li>
 * </ul>
 */
@Entity
@Table(
    name = "users",
    uniqueConstraints = @UniqueConstraint(name = "uq_users_email", columnNames = "email")
)
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @Column(name = "email", nullable = false, length = 255)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    /** Base64-encoded 16-byte random salt. Sent to the client for KEK derivation. */
    @Column(name = "salt", nullable = false, length = 255)
    private String salt;

    @Column(name = "recovery_wrapped_kek", columnDefinition = "TEXT")
    private String recoveryWrappedKek;

    @Column(name = "recovery_iv", length = 32)
    private String recoveryIv;

    @Column(name = "public_key", columnDefinition = "TEXT")
    private String publicKey;

    @Column(name = "enc_private_key", columnDefinition = "TEXT")
    private String encPrivateKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false, columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime updatedAt;

    // ── Relationships ─────────────────────────────────────────────────────────

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<FileMetadata> files = new ArrayList<>();

    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    @Builder.Default
    private List<PasskeyCredential> passkeyCredentials = new ArrayList<>();
}
