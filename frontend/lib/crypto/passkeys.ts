/**
 * lib/crypto/passkeys.ts
 *
 * Implements AES-GCM wrapping and unwrapping of the Master KEK
 * using the WebAuthn PRF (Pseudo-Random Function) extension output.
 */

import { base64ToBuffer, bufferToBase64 } from './index';

// 32-byte salt for the WebAuthn PRF extension.
// This is used to derive a stable 32-byte output from the authenticator.
export const PRF_SALT = new TextEncoder().encode("ZKFS-WebAuthn-PRF-Salt-v1").buffer;
// Since we need exactly 32 bytes for the PRF salt, we hash it.
export async function getPrfSaltBytes(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', PRF_SALT);
  return new Uint8Array(hash);
}

/**
 * Derives an AES-GCM key from the raw PRF output bytes.
 */
async function derivePrfKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    prfOutput,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Wraps the given Master KEK using the PRF output.
 * Returns a Base64 string containing: IV (12 bytes) + Ciphertext (wrapped KEK).
 */
export async function wrapKekWithPrf(masterKek: CryptoKey, prfOutput: ArrayBuffer): Promise<string> {
  const prfKey = await derivePrfKey(prfOutput);
  
  // Export the actual KEK bytes
  const rawKek = await crypto.subtle.exportKey('raw', masterKek);
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    prfKey,
    rawKek
  );
  
  // Combine IV and Ciphertext
  const payload = new Uint8Array(iv.length + ciphertext.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(ciphertext), iv.length);
  
  return bufferToBase64(payload.buffer);
}

/**
 * Unwraps the Master KEK using the PRF output.
 */
export async function unwrapKekWithPrf(wrappedKekBase64: string, prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const prfKey = await derivePrfKey(prfOutput);
  const payload = new Uint8Array(base64ToBuffer(wrappedKekBase64));
  
  const iv = payload.slice(0, 12);
  const ciphertext = payload.slice(12);
  
  const rawKek = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    prfKey,
    ciphertext
  );
  
  return crypto.subtle.importKey(
    'raw',
    rawKek,
    { name: 'AES-GCM' },
    true, // Extractable so it can be exported later if needed
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}
