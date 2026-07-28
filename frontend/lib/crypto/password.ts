/**
 * Utilities for deriving a File-Specific Key Encryption Key (File-KEK)
 * from a user-provided custom file password.
 */



/**
 * Derives a 256-bit AES-GCM Key Encryption Key (File-KEK) from a custom password.
 * Uses PBKDF2 with SHA-256, 100,000 iterations.
 * 
 * @param password The custom password entered by the user
 * @param saltHex  A 16-byte random salt, encoded as hex
 * @returns CryptoKey for AES-GCM (extractable, encrypt/decrypt)
 */
export async function deriveFileKek(password: string, saltHex: string): Promise<CryptoKey> {
  const passwordBuf = new TextEncoder().encode(password);
  
  // Convert hex string salt back to Uint8Array
  const saltBuf = new Uint8Array(
    saltHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
  );

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    passwordBuf,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuf,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, // Extractable so we can export it if needed, or false if just for wrap/unwrap
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
  );
}
