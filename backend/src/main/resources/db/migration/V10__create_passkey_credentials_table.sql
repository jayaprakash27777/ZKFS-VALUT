CREATE TABLE passkey_credentials (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    name VARCHAR(255),
    credential_id VARCHAR(512) NOT NULL UNIQUE,
    public_key_cose TEXT NOT NULL,
    signature_count BIGINT NOT NULL,
    passkey_wrapped_kek TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_passkey_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
