-- =============================================================================
-- Migration: V3__create_file_chunks_table.sql
-- Description: Creates the file_chunks table. Each chunk is independently
--              encrypted with the file's DEK using a unique IV (AES-256-GCM).
--              Chunks are stored in object storage (MinIO/S3); this table
--              tracks their metadata and integrity checksums.
-- =============================================================================

CREATE TABLE IF NOT EXISTS file_chunks (
    id              UUID          NOT NULL DEFAULT gen_random_uuid(),
    file_id         UUID          NOT NULL,
    chunk_index     INTEGER       NOT NULL CHECK (chunk_index >= 0),
    chunk_size      BIGINT        NOT NULL CHECK (chunk_size > 0),  -- encrypted chunk size in bytes
    s3_object_key   VARCHAR(1024) NOT NULL,   -- e.g. "chunks/{file_id}/{chunk_index}.enc"
    sha256_checksum VARCHAR(64)   NOT NULL,   -- hex-encoded SHA-256 of the encrypted chunk bytes
    iv_chunk        VARCHAR(32)   NOT NULL,   -- Base64-encoded 12-byte AES-GCM IV for this chunk
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_file_chunks             PRIMARY KEY (id),
    CONSTRAINT fk_file_chunks_file_id     FOREIGN KEY (file_id)
                                          REFERENCES files (id)
                                          ON DELETE CASCADE,
    CONSTRAINT uq_file_chunk_index        UNIQUE (file_id, chunk_index)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_file_chunks_file_id    ON file_chunks (file_id);
CREATE INDEX IF NOT EXISTS idx_file_chunks_chunk_index ON file_chunks (file_id, chunk_index);

COMMENT ON TABLE  file_chunks              IS 'Individual encrypted chunks for each file. Each chunk has its own AES-GCM IV.';
COMMENT ON COLUMN file_chunks.chunk_index  IS 'Zero-based index of this chunk within the file. Ordering is critical for reconstruction.';
COMMENT ON COLUMN file_chunks.chunk_size   IS 'Size of the *encrypted* chunk in bytes stored in object storage.';
COMMENT ON COLUMN file_chunks.s3_object_key IS 'Full object key path in MinIO/S3 bucket, e.g. chunks/{file_uuid}/{chunk_index}.enc';
COMMENT ON COLUMN file_chunks.sha256_checksum IS 'Hex-encoded SHA-256 hash of encrypted chunk bytes for integrity verification.';
COMMENT ON COLUMN file_chunks.iv_chunk     IS 'Base64-encoded 12-byte IV unique to this chunk. Required for AES-GCM decryption.';
