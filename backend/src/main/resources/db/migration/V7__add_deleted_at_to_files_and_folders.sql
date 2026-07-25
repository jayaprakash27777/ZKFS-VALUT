-- Add deleted_at timestamp for soft-deletes in files
ALTER TABLE files ADD COLUMN deleted_at TIMESTAMP(3) WITH TIME ZONE DEFAULT NULL;
