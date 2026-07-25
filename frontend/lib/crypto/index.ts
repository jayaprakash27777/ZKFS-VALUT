/**
 * lib/crypto/index.ts
 *
 * Zero-Knowledge Cryptography Layer — Core Utilities
 * ═══════════════════════════════════════════════════
 * Canonical barrel for all browser-side cryptographic operations.
 * All operations use the native WebCrypto API (window.crypto.subtle).
 * No sensitive key material ever leaves the browser.
 *
 * Phase 2 Key Hierarchy (Argon2id):
 * ──────────────────────────────────
 *   password + salt →[Argon2id-WASM]→ KEK (256-bit, in memory only)
 *   KEK             →[HKDF-SHA256]→   authHash (sent to server, ≠ KEK)
 *   KEK             →[AES-GCM wrap]→  wrappedDEK (stored on server opaquely)
 *   DEK (per file)  →[AES-GCM]→       Encrypted chunks (unique IV per chunk)
 *
 * Modules:
 *   argon2.ts  — Argon2id KDF, HKDF auth-hash derivation
 *   keys.ts    — DEK generation, wrap, unwrap
 *   index.ts   — Low-level AES-GCM primitives, buffer utilities
 *
 * Conventions:
 *   - All IVs are 12 bytes (96 bits) per NIST SP 800-38D.
 *   - Binary data transmitted as Base64 strings.
 *   - Hex strings used for checksums (SHA-256).
 */

// ── Re-export Argon2 and key management for convenience ──────────────────
export * from './argon2';
export * from './keys';

// ── Utility: ArrayBuffer ↔ Base64 ──────────────────────────────────────────

export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary  = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary  = atob(base64);
  const bytes   = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── IV Generation ──────────────────────────────────────────────────────────

/** Generates a cryptographically secure 12-byte IV for AES-GCM. */
export function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12));
}

/** Generates a cryptographically secure 16-byte salt for PBKDF2. */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

// ── PBKDF2 Key Derivation ──────────────────────────────────────────────────

/**
 * Derives a 256-bit AES-GCM Key Encryption Key (KEK) from the user's
 * password and a server-provided salt using PBKDF2-HMAC-SHA256.
 *
 * @param password  Raw user password (UTF-8 string)
 * @param saltB64   Base64-encoded 16-byte salt from the server
 * @returns         CryptoKey usable for AES-GCM wrap/unwrap operations
 */
export async function deriveKEK(
  password: string,
  saltB64: string
): Promise<CryptoKey> {
  const enc      = new TextEncoder();
  const saltBuf  = base64ToBuffer(saltB64);

  // Import the raw password as a PBKDF2 base key
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  // Derive a 256-bit AES-GCM key
  return crypto.subtle.deriveKey(
    {
      name:       'PBKDF2',
      salt:       saltBuf,
      iterations: 310_000,           // NIST SP 800-132 recommendation
      hash:       'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,                           // Not extractable — stays in browser memory
    ['wrapKey', 'unwrapKey']
  );
}

// ── Data Encryption Key (DEK) ──────────────────────────────────────────────

/**
 * Generates a new random 256-bit AES-GCM Data Encryption Key (DEK).
 * One DEK is generated per file.
 */
export async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,    // Extractable so we can wrap it for storage
    ['encrypt', 'decrypt']
  );
}

/**
 * Wraps (encrypts) the DEK using the user's KEK with AES-GCM.
 * The wrapped DEK and its IV are stored server-side.
 *
 * @returns { wrappedDekB64, ivB64 } — both Base64-encoded
 */
export async function wrapDEK(
  dek: CryptoKey,
  kek: CryptoKey
): Promise<{ wrappedDekB64: string; ivB64: string }> {
  const iv         = generateIV();
  const wrappedDek = await crypto.subtle.wrapKey('raw', dek, kek, {
    name: 'AES-GCM',
    iv: iv as any,
  });


  return {
    wrappedDekB64: bufferToBase64(wrappedDek),
    ivB64:         bufferToBase64(iv),
  };

}

/**
 * Unwraps (decrypts) a stored DEK using the user's KEK.
 *
 * @param wrappedDekB64  Base64-encoded wrapped DEK from the server
 * @param ivB64          Base64-encoded IV used during wrapping
 * @param kek            The user's Key Encryption Key
 */
export async function unwrapDEK(
  wrappedDekB64: string,
  ivB64: string,
  kek: CryptoKey
): Promise<CryptoKey> {
  const wrappedDek = base64ToBuffer(wrappedDekB64);
  const iv         = base64ToBuffer(ivB64);

  return crypto.subtle.unwrapKey(
    'raw',
    wrappedDek,
    kek,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Chunk Encryption / Decryption ──────────────────────────────────────────

/**
 * Encrypts a file chunk with the file's DEK using AES-256-GCM.
 * Each chunk receives a unique, randomly generated IV.
 *
 * @param chunk  Raw chunk bytes (ArrayBuffer)
 * @param dek    The file's Data Encryption Key
 * @returns      { ciphertext, ivB64, sha256Hex }
 */
export async function encryptChunk(
  chunk: ArrayBuffer,
  dek: CryptoKey
): Promise<{ ciphertext: ArrayBuffer; ivB64: string; sha256Hex: string }> {
  const iv         = generateIV();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    dek,
    chunk as any
  );

  // Compute SHA-256 of the *encrypted* ciphertext for integrity
  const hashBuffer = await crypto.subtle.digest('SHA-256', ciphertext);

  return {
    ciphertext,
    ivB64:     bufferToBase64(iv),
    sha256Hex: bufferToHex(hashBuffer),
  };
}

/**
 * Decrypts a single file chunk.
 *
 * @param ciphertext  Encrypted chunk bytes
 * @param ivB64       Base64-encoded IV used during encryption
 * @param dek         The file's Data Encryption Key
 */
export async function decryptChunk(
  ciphertext: ArrayBuffer,
  ivB64: string,
  dek: CryptoKey
): Promise<ArrayBuffer> {
  const iv = base64ToBuffer(ivB64);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, ciphertext);
}

/**
 * Encrypts a UTF-8 string (e.g., filename) with the user's KEK.
 * Returns Base64 ciphertext.
 */
export async function encryptString(
  plaintext: string,
  kek: CryptoKey
): Promise<{ ciphertextB64: string; ivB64: string }> {
  const iv  = generateIV();
  const enc = new TextEncoder();

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    kek,
    enc.encode(plaintext) as any
  );

  return {
    ciphertextB64: bufferToBase64(ciphertext),
    ivB64:         bufferToBase64(iv),
  };
}

/**
 * Decrypts a Base64-encoded ciphertext string (e.g., filename) with the KEK.
 */
export async function decryptString(
  ciphertextB64: string,
  ivB64: string,
  kek: CryptoKey
): Promise<string> {
  const ciphertext = base64ToBuffer(ciphertextB64);
  const iv         = base64ToBuffer(ivB64);
  const dec        = new TextDecoder();

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    kek,
    ciphertext
  );

  return dec.decode(plainBuffer);
}

// ── File Chunking ──────────────────────────────────────────────────────────

export const CHUNK_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per chunk

/**
 * Splits a File into fixed-size ArrayBuffer chunks ready for encryption.
 *
 * @param file       The File object from an <input> element
 * @param chunkSize  Chunk size in bytes (default: 5 MB)
 */
export async function splitFileIntoChunks(
  file: File,
  chunkSize = CHUNK_SIZE_BYTES
): Promise<ArrayBuffer[]> {
  const chunks: ArrayBuffer[] = [];
  let   offset = 0;

  while (offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    chunks.push(await slice.arrayBuffer());
    offset += chunkSize;
  }

  return chunks;
}
