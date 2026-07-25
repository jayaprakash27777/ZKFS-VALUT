/**
 * lib/crypto/__tests__/cipher.test.ts
 *
 * Unit tests for the AES-256-GCM chunk encryption engine.
 * Runs in jsdom (Node.js >= 19 has WebCrypto globally).
 */

import {
  encryptChunk,
  decryptChunk,
  verifyChunkIntegrity,
  readChunk,
  computeTotalChunks,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  DEFAULT_CHUNK_SIZE,
  uint8ToHex,
  uint8ToBase64,
  base64ToUint8,
} from '../cipher';
import { generateDEK } from '../keys';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTestFile(sizeBytes: number, fillByte = 0x42): File {
  const data = new Uint8Array(sizeBytes).fill(fillByte);
  return new File([data], 'test-file.bin', { type: 'application/octet-stream' });
}

// ── computeTotalChunks ─────────────────────────────────────────────────────

describe('computeTotalChunks', () => {
  it('returns 1 for an empty file', () => {
    expect(computeTotalChunks(0)).toBe(1);
  });

  it('returns 1 when file fits in one chunk', () => {
    expect(computeTotalChunks(DEFAULT_CHUNK_SIZE)).toBe(1);
  });

  it('returns 2 when file exceeds one chunk by 1 byte', () => {
    expect(computeTotalChunks(DEFAULT_CHUNK_SIZE + 1)).toBe(2);
  });

  it('correctly handles exact multiples', () => {
    expect(computeTotalChunks(DEFAULT_CHUNK_SIZE * 5)).toBe(5);
  });
});

// ── readChunk ──────────────────────────────────────────────────────────────

describe('readChunk', () => {
  it('reads the correct byte range for chunk 0', async () => {
    const file  = makeTestFile(100);
    const bytes = await readChunk(file, 0, 50);
    expect(bytes.byteLength).toBe(50);
  });

  it('reads a partial last chunk', async () => {
    const file  = makeTestFile(75);
    const bytes = await readChunk(file, 1, 50);  // 75 - 50 = 25 bytes
    expect(bytes.byteLength).toBe(25);
  });

  it('throws RangeError for out-of-bounds chunk index', async () => {
    const file = makeTestFile(50);
    await expect(readChunk(file, 1, 50)).rejects.toBeInstanceOf(RangeError);
  });
});

// ── Core encryption / decryption ───────────────────────────────────────────

describe('encryptChunk / decryptChunk', () => {
  let dek: CryptoKey;

  beforeAll(async () => {
    dek = await generateDEK();
  });

  it('produces wire frame with correct structure', async () => {
    const file   = makeTestFile(1024);
    const result = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);

    // IV (12) + ciphertext (1024) + tag (16) = 1052
    expect(result.encryptedData.length).toBe(GCM_IV_BYTES + 1024 + GCM_TAG_BYTES);
    expect(result.encryptedData.subarray(0, GCM_IV_BYTES)).not.toEqual(new Uint8Array(GCM_IV_BYTES));
    expect(result.chunkIndex).toBe(0);
    expect(result.plainSize).toBe(1024);
  });

  it('ivB64 matches the first 12 bytes of encryptedData', async () => {
    const file   = makeTestFile(512);
    const result = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);

    const ivFromFrame  = result.encryptedData.subarray(0, GCM_IV_BYTES);
    const ivFromB64    = base64ToUint8(result.ivB64);
    expect(ivFromFrame).toEqual(ivFromB64);
  });

  it('decrypts to the original plaintext', async () => {
    const original  = makeTestFile(2048, 0xAB);
    const encrypted = await encryptChunk(original, 0, DEFAULT_CHUNK_SIZE, dek);
    const decrypted = await decryptChunk(encrypted.encryptedData, dek, 0);

    expect(decrypted.data.length).toBe(2048);
    expect(decrypted.data.every(b => b === 0xAB)).toBe(true);
    expect(decrypted.chunkIndex).toBe(0);
  });

  it('each encryption of the same chunk produces a different IV', async () => {
    const file   = makeTestFile(256);
    const enc1   = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);
    const enc2   = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);

    const iv1 = enc1.encryptedData.subarray(0, GCM_IV_BYTES);
    const iv2 = enc2.encryptedData.subarray(0, GCM_IV_BYTES);
    expect(iv1).not.toEqual(iv2);  // Random IV — should differ
  });

  it('sha256Hex is 64 hex characters', async () => {
    const file   = makeTestFile(64);
    const result = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);
    expect(result.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('decryption fails with wrong DEK (GCM auth tag mismatch)', async () => {
    const wrongDek = await generateDEK();
    const file     = makeTestFile(256);
    const enc      = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);

    await expect(decryptChunk(enc.encryptedData, wrongDek, 0))
      .rejects.toThrow();  // DOMException — auth tag verification failure
  });

  it('decryption fails when wire frame is tampered (bit flip)', async () => {
    const file   = makeTestFile(256);
    const enc    = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);

    // Flip a bit in the ciphertext portion (after the IV)
    const tampered = new Uint8Array(enc.encryptedData);
    tampered[GCM_IV_BYTES + 10] ^= 0xFF;

    await expect(decryptChunk(tampered, dek, 0))
      .rejects.toThrow();  // GCM tag verification must fail
  });
});

// ── Integrity Verification ─────────────────────────────────────────────────

describe('verifyChunkIntegrity', () => {
  let dek: CryptoKey;

  beforeAll(async () => {
    dek = await generateDEK();
  });

  it('returns true for a valid checksum', async () => {
    const file   = makeTestFile(128);
    const enc    = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);
    const result = await verifyChunkIntegrity(enc.encryptedData, enc.sha256Hex);
    expect(result).toBe(true);
  });

  it('returns false when checksum does not match', async () => {
    const file   = makeTestFile(128);
    const enc    = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);
    const wrong  = enc.sha256Hex.replace(/^./, '0'); // Corrupt first char
    const result = await verifyChunkIntegrity(enc.encryptedData, wrong);
    expect(result).toBe(false);
  });

  it('returns false when data is tampered', async () => {
    const file     = makeTestFile(128);
    const enc      = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);
    const tampered = new Uint8Array(enc.encryptedData);
    tampered[20] ^= 0x01;
    const result   = await verifyChunkIntegrity(tampered, enc.sha256Hex);
    expect(result).toBe(false);
  });
});
