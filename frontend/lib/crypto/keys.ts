/**
 * lib/crypto/keys.ts
 *
 * WebCrypto Key Management — DEK Generation, Wrapping, and Unwrapping
 * ════════════════════════════════════════════════════════════════════
 *
 * Key Hierarchy:
 * ─────────────
 *   KEK  (Key Encryption Key)   — 256-bit AES-GCM, derived via Argon2id
 *   DEK  (Data Encryption Key)  — 256-bit AES-GCM, unique per file, random
 *   Chunks                      — Encrypted with DEK, each chunk has unique IV
 *
 * Wrapping Protocol (AES-Key-Wrap via AES-GCM):
 * ──────────────────────────────────────────────
 *   1. Generate random DEK
 *   2. Generate random 12-byte IV_wrap
 *   3. wrappedDEK = AES-GCM-Encrypt(key=KEK, iv=IV_wrap, plaintext=rawDEK)
 *   4. Store (wrappedDEK, IV_wrap) on server — server sees only opaque bytes
 *
 * On Download:
 *   1. Fetch (wrappedDEK, IV_wrap) from server
 *   2. DEK = AES-GCM-Decrypt(key=KEK, iv=IV_wrap, ciphertext=wrappedDEK)
 *   3. Use DEK to decrypt chunks
 *
 * All operations use window.crypto.subtle (WebCrypto API).
 * No third-party crypto library is used for key operations — only WASM Argon2.
 */

// ── Re-export utilities from index for convenience ─────────────────────────

export {
  bufferToBase64,
  base64ToBuffer,
  bufferToHex,
  generateIV,
  encryptChunk,
  decryptChunk,
  encryptString,
  decryptString,
  splitFileIntoChunks,
  CHUNK_SIZE_BYTES,
} from './index';

// ── Types ──────────────────────────────────────────────────────────────────

/** Result of wrapping a DEK — stored on the server */
export interface WrappedDEK {
  /** Base64-encoded AES-GCM ciphertext of the raw DEK bytes */
  wrappedDekB64: string;
  /** Base64-encoded 12-byte IV used during wrapping */
  ivB64:         string;
}

/** Complete key set for a single file session */
export interface FileKeySet {
  dek:        CryptoKey;    // In-memory only
  wrappedDEK: WrappedDEK;  // Safe to send to server
}

// ── DEK Generation ─────────────────────────────────────────────────────────

/**
 * Generates a fresh, cryptographically random 256-bit AES-GCM
 * Data Encryption Key (DEK) for a single file.
 *
 * The key is marked as:
 *   extractable: true  → needed so we can wrap it with the KEK for server storage
 *   usages: ['encrypt', 'decrypt']
 *
 * One DEK per file. Never reuse a DEK across files.
 */
export async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name:   'AES-GCM',
      length: 256,
    },
    true,                          // Extractable (only for wrapping)
    ['encrypt', 'decrypt']
  );
}

// ── DEK Wrapping ───────────────────────────────────────────────────────────

/**
 * Wraps (encrypts) a DEK with the user's KEK using AES-256-GCM.
 *
 * Under the hood, WebCrypto's `wrapKey('raw', ...)` calls:
 *   1. exportKey('raw', dek) → raw DEK bytes
 *   2. AES-GCM-Encrypt(key=kek, iv=randomIV, data=rawDEK)
 *
 * The wrapped blob is safe to store on the server — it reveals nothing
 * about the DEK without the KEK, which never leaves the client.
 *
 * @param dek  The file's Data Encryption Key (extractable CryptoKey)
 * @param kek  The user's Key Encryption Key (AES-GCM CryptoKey)
 * @returns    WrappedDEK with Base64-encoded ciphertext and IV
 */
export async function wrapDEK(
  dek: CryptoKey,
  kek: CryptoKey
): Promise<WrappedDEK> {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const wrappedDekBuffer = await crypto.subtle.wrapKey(
    'raw',   // Export DEK as raw bytes before wrapping
    dek,
    kek,
    {
      name: 'AES-GCM',
      iv,
    }
  );

  const toBase64 = (buf: ArrayBuffer): string => {
    const bytes  = new Uint8Array(buf);
    let   binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  return {
    wrappedDekB64: toBase64(wrappedDekBuffer),
    ivB64:         toBase64(iv.buffer),
  };
}

/**
 * Unwraps a DEK received from the server using the user's KEK.
 *
 * Under the hood, WebCrypto's `unwrapKey('raw', ...)` calls:
 *   1. AES-GCM-Decrypt(key=kek, iv=iv, ciphertext=wrappedDek)
 *   2. importKey('raw', decryptedBytes, 'AES-GCM', ...)
 *
 * The result is a non-extractable CryptoKey — the raw DEK bytes
 * are never accessible to JavaScript after unwrapping.
 *
 * @param wrappedDekB64  Base64-encoded wrapped DEK from server
 * @param ivB64          Base64-encoded 12-byte IV from server
 * @param kek            User's KEK (must have 'unwrapKey' usage)
 * @returns              Non-extractable AES-GCM CryptoKey for decryption
 */
export async function unwrapDEK(
  wrappedDekB64: string,
  ivB64:         string,
  kek:           CryptoKey
): Promise<CryptoKey> {
  const fromBase64 = (b64: string): ArrayBuffer => {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  };

  const wrappedDekBuffer = fromBase64(wrappedDekB64);
  const ivBuffer         = fromBase64(ivB64);

  return crypto.subtle.unwrapKey(
    'raw',
    wrappedDekBuffer,
    kek,
    {
      name: 'AES-GCM',
      iv:   ivBuffer,
    },
    {
      name:   'AES-GCM',
      length: 256,
    },
    false,                   // ← NOT extractable after unwrap
    ['encrypt', 'decrypt']
  );
}

// ── Composite Helper ───────────────────────────────────────────────────────

/**
 * Generates a fresh DEK and immediately wraps it with the user's KEK.
 * Returns both the in-memory DEK (for encrypting this upload session)
 * and the wrapped DEK (for sending to the server).
 *
 * @param kek  User's Key Encryption Key
 */
export async function generateAndWrapDEK(kek: CryptoKey): Promise<FileKeySet> {
  const dek        = await generateDEK();
  const wrappedDEK = await wrapDEK(dek, kek);
  return { dek, wrappedDEK };
}

// ── IV Utilities ───────────────────────────────────────────────────────────

/** 12-byte IV for AES-GCM (NIST recommendation: 96-bit IV) */
export function generateGCMIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(12));
}

// ── Key Fingerprint (for debugging only, never log in prod) ───────────────

/**
 * Computes a SHA-256 fingerprint of a CryptoKey for diagnostic purposes.
 * Only call this on extractable keys in development environments.
 *
 * @param key         An extractable CryptoKey
 * @returns           Hex fingerprint (first 16 chars shown for logs)
 */
export async function keyFingerprint(key: CryptoKey): Promise<string> {
  if (process.env.NODE_ENV === 'production') {
    return '[redacted-in-production]';
  }
  const raw     = await crypto.subtle.exportKey('raw', key);
  const hash    = await crypto.subtle.digest('SHA-256', raw);
  const hex     = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex.slice(0, 16)}...`;
}

// ── Secure Memory Erasure (best-effort) ───────────────────────────────────

/**
 * Overwrites a Uint8Array with zeros to minimize the window during which
 * sensitive bytes reside in JavaScript heap memory.
 *
 * NOTE: JS does not guarantee GC timing or prevent memory page swaps,
 * so this is best-effort — not a cryptographic memory safety guarantee.
 */
export function secureErase(buffer: Uint8Array): void {
  buffer.fill(0);
}
