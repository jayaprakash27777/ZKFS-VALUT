package com.iitjammu.zkfs.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * JPA entity representing a single encrypted chunk of a file.
 *
 * <p>Each chunk is independently encrypted with the file's DEK using a
 * unique IV, enabling parallel upload/download and partial decryption.
 *
 * <p>Fields:
 * <ul>
 *   <li>{@code chunkIndex} — zero-based ordering; critical for reassembly.</li>
 *   <li>{@code s3ObjectKey} — full path in object storage, e.g.
 *       {@code chunks/{file_uuid}/{chunk_index}.enc}</li>
 *   <li>{@code sha256Checksum} — hex SHA-256 of the *encrypted* chunk for
 *       tamper detection.</li>
 *   <li>{@code ivChunk} — Base64 12-byte AES-GCM IV unique to this chunk.</li>
 * </ul>
 */
@Entity
@Table(
    name = "file_chunks",
    uniqueConstraints = @UniqueConstraint(
        name = "uq_file_chunk_index",
        columnNames = {"file_id", "chunk_index"}
    ),
    indexes = {
        @Index(name = "idx_file_chunks_file_id",     columnList = "file_id"),
        @Index(name = "idx_file_chunks_chunk_index",  columnList = "file_id,chunk_index")
    }
)
@Getter
@Setter
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FileChunk {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "file_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_file_chunks_file_id"))
    private FileMetadata fileMetadata;

    @Column(name = "chunk_index", nullable = false)
    private int chunkIndex;

    /** Size of the *encrypted* chunk stored in object storage (bytes). */
    @Column(name = "chunk_size", nullable = false)
    private long chunkSize;

    /** Full S3/MinIO object key, e.g. {@code chunks/uuid/0.enc}. */
    @Column(name = "s3_object_key", nullable = false, length = 1024)
    private String s3ObjectKey;

    /** Hex-encoded SHA-256 hash of the encrypted chunk bytes. */
    @Column(name = "sha256_checksum", nullable = false, length = 64)
    private String sha256Checksum;

    /** Base64-encoded 12-byte AES-GCM IV for this specific chunk. */
    @Column(name = "iv_chunk", nullable = false, length = 32)
    private String ivChunk;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false, columnDefinition = "TIMESTAMPTZ")
    private OffsetDateTime createdAt;
}
