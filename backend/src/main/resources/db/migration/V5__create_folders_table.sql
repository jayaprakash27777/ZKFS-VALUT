-- V5__create_folders_table.sql
CREATE TABLE folders (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    parent_id UUID,
    name_encrypted TEXT NOT NULL,
    iv VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT fk_folders_parent FOREIGN KEY (parent_id) REFERENCES folders (id) ON DELETE CASCADE
);

CREATE INDEX idx_folders_user ON folders (user_id);
CREATE INDEX idx_folders_parent ON folders (parent_id);

-- Alter file_shares to support folder sharing
ALTER TABLE file_shares ADD COLUMN folder_id UUID;
ALTER TABLE file_shares ADD CONSTRAINT fk_file_shares_folder_id FOREIGN KEY (folder_id) REFERENCES folders (id) ON DELETE CASCADE;
ALTER TABLE file_shares ALTER COLUMN file_id DROP NOT NULL;
ALTER TABLE file_shares ADD CONSTRAINT chk_file_or_folder CHECK (
    (file_id IS NOT NULL AND folder_id IS NULL) OR
    (file_id IS NULL AND folder_id IS NOT NULL)
);
