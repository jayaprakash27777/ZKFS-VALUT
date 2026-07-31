-- V15__add_folder_id_to_file_shares.sql

CREATE INDEX IF NOT EXISTS idx_file_shares_folder_id ON file_shares (folder_id);
