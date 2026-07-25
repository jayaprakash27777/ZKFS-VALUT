-- V11__add_user_keypairs.sql

-- Add columns for asymmetric encryption (Zero-Knowledge Sharing)
ALTER TABLE users ADD COLUMN public_key TEXT;
ALTER TABLE users ADD COLUMN enc_private_key TEXT;
