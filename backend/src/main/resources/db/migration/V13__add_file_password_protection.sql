ALTER TABLE files ADD COLUMN is_password_protected BOOLEAN DEFAULT FALSE;
ALTER TABLE files ADD COLUMN password_salt TEXT;
