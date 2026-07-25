ALTER TABLE users ADD COLUMN recovery_wrapped_kek TEXT;
ALTER TABLE users ADD COLUMN recovery_iv VARCHAR(32);
