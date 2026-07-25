package com.iitjammu.zkfs.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * JPA entity representing a WebAuthn (Passkey) credential.
 */
@Entity
@Table(name = "passkey_credentials")
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PasskeyCredential {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "name")
    private String name; // e.g., "YubiKey", "iPhone iCloud"

    @Column(name = "credential_id", nullable = false, length = 512, unique = true)
    private String credentialId; // Base64Url encoded byte array

    @Column(name = "public_key_cose", nullable = false, columnDefinition = "TEXT")
    private String publicKeyCose; // Base64Url encoded CBOR COSE Key

    @Column(name = "signature_count", nullable = false)
    private long signatureCount;

    /**
     * The Zero-Knowledge Master KEK encrypted by the WebAuthn PRF output of this specific passkey.
     * Stored as Base64. When the user logs in with this passkey, they derive the PRF,
     * decrypt this field to get the original KEK, and thus unlock the vault.
     */
    @Column(name = "passkey_wrapped_kek", columnDefinition = "TEXT", nullable = false)
    private String passkeyWrappedKek;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false, columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime updatedAt;
}
