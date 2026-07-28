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
 * JPA entity representing encrypted file metadata.
 *
 * <p>Zero-knowledge notes:
 * <ul>
 *   <li>{@code filenameEncrypted} — AES-256-GCM ciphertext of the original filename.</li>
 *   <li>{@code wrappedDek} — Data Encryption Key wrapped with the user's KEK.
 *       The server stores this opaque blob without any ability to decrypt it.</li>
 *   <li>{@code ivWrappedDek} — 12-byte IV required to unwrap the DEK on the client.</li>
 * </ul>
 */
@Entity
@Table(
    name = "files",
    indexes = {
        @Index(name = "idx_files_user_id",      columnList = "user_id"),
        @Index(name = "idx_files_upload_status", columnList = "upload_status"),
        @Index(name = "idx_files_created_at",    columnList = "created_at DESC")
    }
)
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FileMetadata {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_files_user_id"))
    private User user;

    @Column(name = "user_id", nullable = false, updatable = false, insertable = false)
    private UUID userId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "folder_id", foreignKey = @ForeignKey(name = "fk_files_folder"))
    private Folder folder;

    /** Base64(AES-GCM(original_filename)) — opaque to the server. */
    @Column(name = "filename_encrypted", nullable = false, columnDefinition = "TEXT")
    private String filenameEncrypted;

    /** Optional MIME type hint stored in plaintext (e.g., "application/pdf"). */
    @Column(name = "mime_type", length = 255)
    private String mimeType;

    /** Base64(AES-GCM(thumbnail)) — opaque to the server. */
    @Column(name = "thumbnail_encrypted", columnDefinition = "TEXT")
    private String thumbnailEncrypted;

    @Column(name = "total_chunks", nullable = false)
    private int totalChunks;

    /** Original (pre-encryption) file size in bytes. */
    @Column(name = "total_size", nullable = false)
    private long totalSize;

    /** Base64(AES-KeyWrap(DEK, KEK)) — server cannot decrypt. */
    @Column(name = "wrapped_dek", nullable = false, columnDefinition = "TEXT")
    private String wrappedDek;

    /** Base64-encoded 12-byte IV used when wrapping the DEK. */
    @Column(name = "iv_wrapped_dek", nullable = false, length = 32)
    private String ivWrappedDek;

    @Column(name = "is_password_protected", nullable = false)
    @Builder.Default
    private boolean isPasswordProtected = false;

    @Column(name = "password_salt", columnDefinition = "TEXT")
    private String passwordSalt;

    @Enumerated(EnumType.STRING)
    @Column(name = "upload_status", nullable = false, length = 20)
    @Builder.Default
    private UploadStatus uploadStatus = UploadStatus.PENDING;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false, columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime updatedAt;

    @Column(name = "deleted_at", columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime deletedAt;

    // ── Relationships ─────────────────────────────────────────────────────────

    @OneToMany(mappedBy = "fileMetadata", cascade = CascadeType.ALL,
               orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("chunkIndex ASC")
    @Builder.Default
    private List<FileChunk> chunks = new ArrayList<>();

    // ── Enums ─────────────────────────────────────────────────────────────────

    public enum UploadStatus {
        PENDING, UPLOADING, COMPLETE, FAILED
    }
}
