-- V12__create_user_shares_table.sql

CREATE TABLE user_shares (
    id UUID PRIMARY KEY,
    file_id UUID NOT NULL,
    owner_id UUID NOT NULL,
    shared_with_id UUID NOT NULL,
    wrapped_dek TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_shares_file_id FOREIGN KEY (file_id) REFERENCES files (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_shares_owner_id FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_shares_shared_with_id FOREIGN KEY (shared_with_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX idx_user_shares_file_id ON user_shares (file_id);
CREATE INDEX idx_user_shares_shared_with_id ON user_shares (shared_with_id);
