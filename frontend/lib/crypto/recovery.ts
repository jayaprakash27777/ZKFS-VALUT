import * as bip39 from 'bip39';
import { deriveKEKBytes, deriveAuthHash } from './argon2';
import { bufferToBase64, base64ToBuffer } from './index';

export function generateMnemonic(): string {
  return bip39.generateMnemonic(128); // 12 words
}

export async function wrapKekWithMnemonic(kekBytes: Uint8Array, mnemonic: string, salt: Uint8Array): Promise<{ wrappedKek: string, iv: string }> {
  // 1. Derive recovery KEK from mnemonic
  const recoveryKekBytes = await deriveKEKBytes(mnemonic, salt);
  const recoveryKek = await crypto.subtle.importKey(
    'raw', recoveryKekBytes as any, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
  
  // 2. Encrypt raw KEK with recovery KEK
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    recoveryKek,
    kekBytes as any
  );
  
  return {
    wrappedKek: bufferToBase64(ciphertext),
    iv: bufferToBase64(iv)
  };
}

export async function unwrapKekWithMnemonic(mnemonic: string, saltB64: string, wrappedKekB64: string, ivB64: string): Promise<{ kek: CryptoKey, authHashHex: string }> {
  const saltBytes = new Uint8Array(base64ToBuffer(saltB64));
  const recoveryKekBytes = await deriveKEKBytes(mnemonic, saltBytes);
  const recoveryKek = await crypto.subtle.importKey(
    'raw', recoveryKekBytes as any, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );

  const ivBytes = new Uint8Array(base64ToBuffer(ivB64));
  const ciphertextBytes = new Uint8Array(base64ToBuffer(wrappedKekB64));
  
  const decryptedRawKek = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    recoveryKek,
    ciphertextBytes
  );
  
  const kek = await crypto.subtle.importKey(
    'raw', decryptedRawKek as any, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt']
  );

  const authHashHex = await deriveAuthHash(new Uint8Array(decryptedRawKek));

  return { kek, authHashHex };
}
