-- V4__create_file_shares_table.sql
CREATE TABLE file_shares (
    id UUID PRIMARY KEY,
    share_token UUID NOT NULL UNIQUE,
    file_id UUID NOT NULL,
    share_salt_b64 VARCHAR(32) NOT NULL,
    share_wrapped_dek TEXT NOT NULL,
    share_iv_dek VARCHAR(32) NOT NULL,
    share_enc_filename TEXT NOT NULL,
    share_iv_filename VARCHAR(32) NOT NULL,
    expires_at TIMESTAMPTZ,
    max_downloads INT,
    download_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_file_shares_file_id FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE
);

CREATE INDEX idx_file_shares_token ON file_shares (share_token);
CREATE INDEX idx_file_shares_file_id ON file_shares (file_id);
CREATE INDEX idx_file_shares_expires ON file_shares (expires_at);
