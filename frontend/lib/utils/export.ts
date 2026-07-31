import { base64ToBuffer } from '../crypto/index';

export async function exportEncryptedZkfs(
  plaintextBlob: Blob,
  originalFilename: string,
  kek: CryptoKey,
  saltHex: string
): Promise<void> {
  const plaintext = await plaintextBlob.arrayBuffer();

  // 1. Encrypt with KEK
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    kek,
    plaintext
  );

  // 2. Assemble .zkfs format
  // Magic (4) + Salt (16) + IV (12) + Ciphertext
  const magic = new TextEncoder().encode('ZKFS');
  // Hex to Uint8Array for salt
  const salt = new Uint8Array(
    saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  );

  const result = new Uint8Array(4 + 16 + 12 + ciphertext.byteLength);
  result.set(magic, 0);
  result.set(salt, 4);
  result.set(iv, 20);
  result.set(new Uint8Array(ciphertext), 32);

  // 3. Download
  const blob = new Blob([result], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${originalFilename}.zkfs`;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
