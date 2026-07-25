-- =============================================================================
-- Migration: V2__create_files_table.sql
-- Description: Creates the files metadata table. All sensitive fields
--              (filename, DEK) are encrypted client-side before reaching
--              the server — zero-knowledge guarantee.
--
-- Zero-Knowledge fields:
--   filename_encrypted : AES-GCM ciphertext of original filename (Base64)
--   wrapped_dek        : DEK (Data Encryption Key) wrapped with user's KEK (Base64)
--   iv_wrapped_dek     : 12-byte IV used during DEK wrapping (Base64)
-- =============================================================================

CREATE TABLE IF NOT EXISTS files (
    id                 UUID         NOT NULL DEFAULT gen_random_uuid(),
    user_id            UUID         NOT NULL,
    filename_encrypted TEXT         NOT NULL,   -- Base64(AES-GCM(original_filename))
    mime_type          VARCHAR(255),             -- Optional; stored in plaintext for UI hints
    total_chunks       INTEGER      NOT NULL CHECK (total_chunks > 0),
    total_size         BIGINT       NOT NULL CHECK (total_size >= 0),  -- bytes
    wrapped_dek        TEXT         NOT NULL,    -- Base64(AES-KeyWrap(DEK, KEK))
    iv_wrapped_dek     VARCHAR(32)  NOT NULL,    -- Base64(12-byte IV)
    upload_status      VARCHAR(20)  NOT NULL DEFAULT 'PENDING'
                                    CHECK (upload_status IN ('PENDING', 'UPLOADING', 'COMPLETE', 'FAILED')),
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_files          PRIMARY KEY (id),
    CONSTRAINT fk_files_user_id  FOREIGN KEY (user_id)
                                 REFERENCES users (id)
                                 ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files (user_id);
CREATE INDEX IF NOT EXISTS idx_files_upload_status ON files (upload_status);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files (created_at DESC);

-- Auto-update trigger
CREATE TRIGGER trg_files_updated_at
    BEFORE UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE  files                   IS 'File metadata. Filenames and DEKs are encrypted; server is zero-knowledge.';
COMMENT ON COLUMN files.filename_encrypted IS 'AES-256-GCM ciphertext of original filename, Base64-encoded.';
COMMENT ON COLUMN files.wrapped_dek        IS 'DEK wrapped (AES Key Wrap / GCM) with the user''s Key Encryption Key (KEK). Server cannot decrypt.';
COMMENT ON COLUMN files.iv_wrapped_dek     IS 'Base64-encoded 12-byte IV used when wrapping the DEK. Required for unwrapping on client.';
COMMENT ON COLUMN files.total_chunks       IS 'Number of encrypted chunks uploaded to object storage.';
COMMENT ON COLUMN files.total_size         IS 'Original (pre-encryption) file size in bytes.';
