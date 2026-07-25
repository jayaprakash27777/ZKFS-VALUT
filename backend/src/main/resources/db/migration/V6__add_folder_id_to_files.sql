-- V6__add_folder_id_to_files.sql
ALTER TABLE files ADD COLUMN folder_id UUID;
ALTER TABLE files ADD CONSTRAINT fk_files_folder FOREIGN KEY (folder_id) REFERENCES folders (id) ON DELETE CASCADE;
CREATE INDEX idx_files_folder_id ON files (folder_id);
