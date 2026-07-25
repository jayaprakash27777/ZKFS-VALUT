package com.iitjammu.zkfs.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * FileShare — Password-Protected Zero-Knowledge File Share
 * ═════════════════════════════════════════════════════════
 *
 * <p>A FileShare lets an authenticated file owner grant time-limited,
 * password-protected download access to any recipient — without the
 * server ever learning the password, the raw DEK, or the filename.
 *
 * <h3>Cryptographic fields (all server-opaque):</h3>
 * <ul>
 *   <li>{@code shareSaltB64}       — Argon2id salt for recipient's shareKEK derivation</li>
 *   <li>{@code shareWrappedDek}    — File DEK re-wrapped with shareKEK (AES-GCM)</li>
 *   <li>{@code shareIvDek}         — 12-byte IV for DEK re-wrapping</li>
 *   <li>{@code shareEncFilename}   — Filename re-encrypted with shareKEK</li>
 *   <li>{@code shareIvFilename}    — 12-byte IV for filename encryption</li>
 * </ul>
 *
 * <p>The {@code shareToken} UUID is the only public-facing identifier.
 * It must be guarded by the recipient and is not a secret by itself —
 * the real protection is the password required to derive shareKEK.
 */
@Entity
@Table(
    name = "file_shares",
    indexes = {
        @Index(name = "idx_file_shares_token",    columnList = "share_token"),
        @Index(name = "idx_file_shares_file_id",  columnList = "file_id"),
        @Index(name = "idx_file_shares_expires",  columnList = "expires_at")
    }
)
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FileShare {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    /**
     * Public-facing share token — sent in the share URL.
     * Random UUID generated on creation. NOT a secret; password protects the DEK.
     */
    @Column(name = "share_token", nullable = false, unique = true, updatable = false)
    @Builder.Default
    private UUID shareToken = UUID.randomUUID();

    /** The file being shared (null if sharing a folder). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "file_id",
                foreignKey = @ForeignKey(name = "fk_file_shares_file_id"))
    private FileMetadata fileMetadata;

    /** The folder being shared (null if sharing a file). */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "folder_id",
                foreignKey = @ForeignKey(name = "fk_file_shares_folder_id"))
    private Folder folder;

    // ── Opaque crypto blobs (server cannot decrypt) ─────────────────────────

    /** Base64-encoded Argon2id salt used by recipient to derive shareKEK. */
    @Column(name = "share_salt_b64", nullable = false, length = 32)
    private String shareSaltB64;

    /** Base64(AES-GCM(DEK, shareKEK)) — DEK re-wrapped with shareKEK. */
    @Column(name = "share_wrapped_dek", nullable = false, columnDefinition = "TEXT")
    private String shareWrappedDek;

    /** Base64-encoded 12-byte IV for DEK re-wrapping. */
    @Column(name = "share_iv_dek", nullable = false, length = 32)
    private String shareIvDek;

    /** Base64(AES-GCM(filename_plaintext, shareKEK)) — re-encrypted filename. */
    @Column(name = "share_enc_filename", nullable = false, columnDefinition = "TEXT")
    private String shareEncFilename;

    /** Base64-encoded 12-byte IV for filename encryption. */
    @Column(name = "share_iv_filename", nullable = false, length = 32)
    private String shareIvFilename;

    // ── Access control ───────────────────────────────────────────────────────

    /** Optional expiry timestamp. Null = never expires. */
    @Column(name = "expires_at", columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime expiresAt;

    /** Optional download limit. Null = unlimited. */
    @Column(name = "max_downloads")
    private Integer maxDownloads;

    /** Number of times this share has been successfully downloaded. */
    @Column(name = "download_count", nullable = false)
    @Builder.Default
    private int downloadCount = 0;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime createdAt;

    // ── Domain logic ─────────────────────────────────────────────────────────

    /** Returns true if this share is still valid (not expired, not exhausted). */
    public boolean isAccessible() {
        if (expiresAt != null && OffsetDateTime.now().isAfter(expiresAt)) {
            return false;
        }
        if (maxDownloads != null && downloadCount >= maxDownloads) {
            return false;
        }
        return true;
    }
}
