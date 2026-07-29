/**
 * lib/crypto/argon2.ts
 *
 * Argon2id Key Derivation — Zero-Knowledge Authentication Layer
 * ═════════════════════════════════════════════════════════════
 *
 * WHY Argon2id over PBKDF2?
 * ──────────────────────────
 *   • Memory-hard: forces attackers to use large amounts of RAM per guess.
 *   • GPU-resistant: parallel ASIC/GPU brute-force becomes economically infeasible.
 *   • Winner of the Password Hashing Competition (PHC) 2015.
 *   • OWASP recommends Argon2id as the first choice for password hashing.
 *
 * Parameters chosen (OWASP minimum for interactive login, 2024):
 *   • memory:      64 MiB  (m = 65536)
 *   • iterations:  3       (t = 3)
 *   • parallelism: 4       (p = 4)
 *   • outputLen:   32 bytes → 256-bit KEK
 *
 * Implementation: `hash-wasm` (WebAssembly port, browser-safe, no native deps)
 *   npm install hash-wasm
 *
 * Key hierarchy produced here:
 *   password + salt  →[Argon2id]→  KEK (32 bytes, never leaves browser)
 *   KEK              →[HKDF-SHA256, info="zkfs-auth-v1"]→  authHash (32 bytes)
 *   authHash is the only secret ever sent to the server.
 */

import { argon2id } from 'hash-wasm';
import { bufferToBase64 } from './index';

// ── Argon2id Parameters ────────────────────────────────────────────────────

/** Argon2id tuning parameters — tweak for your target login latency. */
export const ARGON2_PARAMS = {
  /** Memory cost in KiB (64 MiB = 65536 KiB) — OWASP interactive minimum */
  memorySize:   65_536,
  /** Number of iterations (time cost) */
  iterations:   3,
  /** Degree of parallelism */
  parallelism:  4,
  /** Output key length in bytes */
  outputLen:    32,
  /** Hash type string used in version metadata */
  hashType:     'argon2id' as const,
} as const;

/** Size of the random salt in bytes (16 = 128 bits, OWASP minimum) */
export const ARGON2_SALT_BYTES = 16;

// ── Salt Generation ────────────────────────────────────────────────────────

/**
 * Generates a cryptographically secure Argon2id salt.
 * Called once per user registration — stored on server, returned on login.
 */
export function generateArgon2Salt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(ARGON2_SALT_BYTES));
}

// ── KEK Derivation ─────────────────────────────────────────────────────────

/**
 * Derives the 256-bit Key Encryption Key (KEK) from the user's password
 * and salt using Argon2id-WebAssembly.
 *
 * @param password  Raw user password string (UTF-8)
 * @param salt      16-byte random salt (Uint8Array)
 * @returns         32-byte KEK as Uint8Array — KEEP IN MEMORY ONLY
 *
 * @throws          {Error} if hash-wasm Argon2id computation fails
 *
 * @example
 *   const salt = generateArgon2Salt();
 *   const kekBytes = await deriveKEKBytes(password, salt);
 *   const kek = await importKEKAsCryptoKey(kekBytes);
 */
export async function deriveKEKBytes(
  password: string,
  salt: Uint8Array
): Promise<Uint8Array> {
  if (salt.length !== ARGON2_SALT_BYTES) {
    throw new Error(
      `Argon2 salt must be exactly ${ARGON2_SALT_BYTES} bytes, got ${salt.length}`
    );
  }
  if (!password || password.length === 0) {
    throw new Error('Password must not be empty');
  }

  // hash-wasm argon2id returns a hex string by default when outputType='hex'
  // We request 'binary' to get raw bytes directly.
  const result = await argon2id({
    password,
    salt,
    memorySize:  ARGON2_PARAMS.memorySize,
    iterations:  ARGON2_PARAMS.iterations,
    parallelism: ARGON2_PARAMS.parallelism,
    hashLength:  ARGON2_PARAMS.outputLen,
    outputType:  'binary',     // Returns Uint8Array
  });

  // hash-wasm 'binary' outputType returns a Uint8Array
  return result as unknown as Uint8Array;
}

/**
 * Imports raw KEK bytes as a non-extractable WebCrypto CryptoKey
 * suitable for AES-GCM key wrapping.
 *
 * Non-extractable: JS code cannot read the raw bytes after import.
 * This provides a memory safety boundary inside the browser's crypto subsystem.
 */
export async function importKEKAsCryptoKey(kekBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    kekBytes as any,
    { name: 'AES-GCM', length: 256 },
    true,                         // ← Must be extractable so it can be wrapped for Passkeys
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
  );
}

// ── Auth Hash Derivation (HKDF) ───────────────────────────────────────────

/**
 * Derives a 32-byte authentication hash from the KEK using HKDF-SHA256.
 *
 * CRITICAL SEPARATION OF CONCERNS:
 *   authHash ≠ KEK.
 *   The server receives only authHash. Even if the server is compromised,
 *   an attacker cannot reconstruct the KEK from authHash alone.
 *   The KEK stays entirely in browser memory.
 *
 * @param kekBytes  Raw 32-byte KEK output from Argon2id
 * @returns         32-byte authHash as hex string (sent to server during auth)
 *
 * Info string "zkfs-auth-v1" prevents cross-purpose key reuse.
 */
export async function deriveAuthHash(kekBytes: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();

  // Step 1: Import KEK bytes as HKDF key material
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    kekBytes as any,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );


  // Step 2: HKDF-Expand with domain-separation info label
  const derived = await crypto.subtle.deriveBits(
    {
      name:  'HKDF',
      hash:  'SHA-256',
      salt:  new Uint8Array(32),           // Zero salt (HKDF spec allows empty salt)
      info:  encoder.encode('zkfs-auth-v1'), // Domain-separation context label
    },
    hkdfKey,
    256  // 32 bytes
  );

  // Return as lowercase hex string
  return Array.from(new Uint8Array(derived))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Full Registration Key Material ─────────────────────────────────────────

export interface RegistrationKeyMaterial {
  /** Raw KEK bytes — NEVER leave this function's scope except into importKEKAsCryptoKey */
  kek:          CryptoKey;
  /** Base64-encoded 16-byte salt — stored on server, returned on login */
  saltB64:      string;
  /** 64-char hex auth hash — sent to server instead of password */
  authHashHex:  string;
  /** Raw KEK bytes — needed to wrap with mnemonic. Call .fill(0) when done. */
  kekBytes:     Uint8Array;
}

/**
 * One-shot helper: generates salt, derives KEK via Argon2id, derives authHash
 * via HKDF. Returns all key material needed for registration.
 *
 * @param password  User's plaintext password
 */
export async function deriveRegistrationKeyMaterial(
  password: string
): Promise<RegistrationKeyMaterial> {
  // 1. Generate fresh random salt
  const saltBytes = generateArgon2Salt();

  // 2. Derive KEK via Argon2id
  const kekBytes = await deriveKEKBytes(password, saltBytes);

  // 3. Import KEK as non-extractable CryptoKey
  const kek = await importKEKAsCryptoKey(kekBytes);

  // 4. Derive auth hash via HKDF (separate domain from encryption key)
  const authHashHex = await deriveAuthHash(kekBytes);

  // 5. Encode salt as Base64 for transmission
  const saltB64 = bufferToBase64(saltBytes);

  return { kek, saltB64, authHashHex, kekBytes };
}

// ── Full Login Key Material ────────────────────────────────────────────────

export interface LoginKeyMaterial {
  /** Non-extractable KEK CryptoKey — stays in memory until logout */
  kek:         CryptoKey;
  /** Auth hash to verify with the server */
  authHashHex: string;
}

/**
 * Derives login key material using the server-provided salt.
 * Called after fetching the user's salt from GET /api/auth/salt.
 *
 * @param password  User's plaintext password
 * @param saltB64   Base64-encoded salt returned by the server
 */
export async function deriveLoginKeyMaterial(
  password: string,
  saltB64:  string
): Promise<LoginKeyMaterial> {
  // Decode Base64 salt back to bytes
  const saltBinary = atob(saltB64);
  const saltBytes  = new Uint8Array(saltBinary.length);
  for (let i = 0; i < saltBinary.length; i++) {
    saltBytes[i] = saltBinary.charCodeAt(i);
  }

  // Derive KEK
  const kekBytes = await deriveKEKBytes(password, saltBytes);

  // Import as CryptoKey
  const kek = await importKEKAsCryptoKey(kekBytes);

  // Derive auth hash
  const authHashHex = await deriveAuthHash(kekBytes);

  // Zero out raw bytes
  kekBytes.fill(0);

  return { kek, authHashHex };
}
