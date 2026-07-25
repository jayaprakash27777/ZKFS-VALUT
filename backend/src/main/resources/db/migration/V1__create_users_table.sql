-- =============================================================================
-- Migration: V1__create_users_table.sql
-- Description: Creates the core users table for Zero-Knowledge E2E Encrypted
--              File Storage System. Password is stored as a bcrypt hash.
--              Salt is stored separately to support PBKDF2/Argon2 key derivation
--              on the client side (zero-knowledge architecture).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- For gen_random_uuid()

CREATE TABLE IF NOT EXISTS users (
    id             UUID         NOT NULL DEFAULT gen_random_uuid(),
    email          VARCHAR(255) NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,  -- bcrypt hash stored server-side
    salt           VARCHAR(255) NOT NULL,  -- Base64-encoded random salt for client-side KDF
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT pk_users        PRIMARY KEY (id),
    CONSTRAINT uq_users_email  UNIQUE (email),
    CONSTRAINT chk_email_format CHECK (email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')
);

-- Index for fast login lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Trigger to auto-update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Documentation for schema visibility
COMMENT ON TABLE  users               IS 'Core user accounts table.';
COMMENT ON COLUMN users.password_hash IS 'Server-side bcrypt hash of the client-side AuthHash.';
COMMENT ON COLUMN users.salt          IS 'Unique cryptographic salt for generating client-side keys.';
