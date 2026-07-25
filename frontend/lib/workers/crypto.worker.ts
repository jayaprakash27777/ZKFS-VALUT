/**
 * lib/workers/crypto.worker.ts
 *
 * AES-256-GCM Crypto Web Worker
 * ════════════════════════════════
 * Runs all heavy cryptographic operations OFF the UI thread, ensuring
 * the React render cycle and Framer Motion animations never freeze.
 *
 * Operations handled:
 *   GENERATE_WRAP_DEK  — AES-256-GCM key generation + AES-KW wrapping with KEK
 *   UNWRAP_DEK         — AES-KW unwrap; stores DEK in worker memory by fileId
 *   ENCRYPT_CHUNK      — AES-256-GCM encrypt: [IV(12)] || [ciphertext+tag]
 *   DECRYPT_CHUNK      — AES-256-GCM decrypt + GCM auth tag verification
 *   PURGE_DEK          — Delete DEK from worker memory map
 *
 * Memory model:
 *   DEKs are stored in `dekStore: Map<fileId, CryptoKey>`.
 *   Call PURGE_DEK when upload/download completes to release the key.
 *
 * Transfer protocol:
 *   ArrayBuffers are Transferred (zero-copy) back to the main thread.
 *   CryptoKeys are Structured-Cloned (they implement the SCA in all modern browsers).
 *
 * Progress reporting:
 *   The worker posts PROGRESS events during multi-chunk operations so
 *   the main thread can update the UploadHUD without polling.
 */

/// <reference lib="webworker" />

const GCM_IV_BYTES = 12;

// ── In-worker DEK store ────────────────────────────────────────────────────
// Maps fileId → non-extractable AES-GCM CryptoKey
const dekStore = new Map<string, CryptoKey>();

// ── Performance timing helper ──────────────────────────────────────────────
function measureMBs(bytes: number, startMs: number): number {
  const elapsedSec = (performance.now() - startMs) / 1000;
  return elapsedSec > 0 ? bytes / 1024 / 1024 / elapsedSec : 0;
}

// ── SHA-256 helper ─────────────────────────────────────────────────────────
async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Base64 helpers ─────────────────────────────────────────────────────────
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ── Command Handlers ───────────────────────────────────────────────────────

async function handleGenerateWrapDek(
  taskId: string, fileId: string, kek: CryptoKey
): Promise<void> {
  // 1. Generate a fresh AES-256-GCM DEK
  const dek = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,   // Must be extractable for wrapping
    ['encrypt', 'decrypt']
  );

  // 2. Generate a random 12-byte IV for wrapping
  const wrapIv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));

  // 3. Wrap (encrypt) the DEK using the KEK via AES-GCM
  const wrappedDekBuffer = await crypto.subtle.wrapKey(
    'raw',
    dek,
    kek,
    { name: 'AES-GCM', iv: wrapIv }
  );

  // 4. Store the extractable DEK as non-extractable for encryption use
  const storedDek = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.exportKey('raw', dek),
    { name: 'AES-GCM', length: 256 },
    false,  // Non-extractable in worker memory
    ['encrypt', 'decrypt']
  );
  dekStore.set(fileId, storedDek);

  // 5. Send wrapped DEK and IV back as Transferable ArrayBuffers (zero-copy)
  const response = {
    taskId, fileId,
    type:    'DEK_READY',
    payload: { wrappedDekBuffer, ivBuffer: wrapIv.buffer },
  };
  (self as unknown as Worker).postMessage(response, [wrappedDekBuffer, wrapIv.buffer]);
}

async function handleUnwrapDek(
  taskId:      string,
  fileId:      string,
  wrappedDek:  ArrayBuffer,
  iv:          ArrayBuffer,
  kek:         CryptoKey
): Promise<void> {
  const dek = await crypto.subtle.unwrapKey(
    'raw',
    wrappedDek,
    kek,
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    { name: 'AES-GCM', length: 256 },
    false,                      // Non-extractable
    ['encrypt', 'decrypt']
  );
  dekStore.set(fileId, dek);

  (self as unknown as Worker).postMessage({ taskId, fileId, type: 'DEK_UNWRAPPED', payload: { success: true } });
}

async function handleEncryptChunk(
  taskId:     string,
  fileId:     string,
  chunk:      ArrayBuffer,
  chunkIndex: number
): Promise<void> {
  const dek = dekStore.get(fileId);
  if (!dek) throw new Error(`DEK not found for fileId=${fileId}. Call GENERATE_WRAP_DEK or UNWRAP_DEK first.`);

  const t0 = performance.now();

  // 1. Random 12-byte IV — unique per chunk
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));

  // 2. AES-256-GCM encrypt
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    dek,
    chunk
  );

  // 3. Build wire frame: [IV(12)] || [ciphertext+tag]
  const cipherBytes   = new Uint8Array(cipherBuffer);
  const wireFrame     = new Uint8Array(GCM_IV_BYTES + cipherBytes.length);
  wireFrame.set(iv, 0);
  wireFrame.set(cipherBytes, GCM_IV_BYTES);

  // 4. SHA-256 over entire wire frame
  const sha256  = await sha256Hex(wireFrame.buffer);
  const ivB64   = uint8ToBase64(iv);
  const speedMBs = measureMBs(chunk.byteLength, t0);

  // 5. Post PROGRESS first (lightweight, no transferable)
  (self as unknown as Worker).postMessage({
    taskId, fileId,
    type:    'PROGRESS',
    payload: {
      phase:   'encrypting',
      current: chunkIndex,
      total:   -1,           // Caller knows totalChunks
      speedMBs,
    },
  });

  // 6. Transfer the wire frame buffer (zero-copy)
  const payload = {
    chunkIndex,
    data:          wireFrame.buffer,
    ivB64,
    sha256Hex:     sha256,
    encryptedSize: wireFrame.length,
  };
  (self as unknown as Worker).postMessage(
    { taskId, fileId, type: 'CHUNK_ENCRYPTED', payload },
    [wireFrame.buffer]
  );
}

async function handleDecryptChunk(
  taskId:        string,
  fileId:        string,
  encryptedData: ArrayBuffer,
  chunkIndex:    number
): Promise<void> {
  const dek = dekStore.get(fileId);
  if (!dek) throw new Error(`DEK not found for fileId=${fileId}.`);

  const bytes      = new Uint8Array(encryptedData);
  const iv         = bytes.subarray(0, GCM_IV_BYTES);
  const ciphertext = bytes.subarray(GCM_IV_BYTES);

  // AES-GCM decrypt — GCM auth tag is verified automatically
  // If tampered, crypto.subtle.decrypt rejects
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    dek,
    ciphertext
  );

  (self as unknown as Worker).postMessage(
    { taskId, fileId, type: 'CHUNK_DECRYPTED', payload: { chunkIndex, data: plainBuffer } },
    [plainBuffer]
  );
}

function handlePurgeDek(taskId: string, fileId: string): void {
  dekStore.delete(fileId);
  (self as unknown as Worker).postMessage({
    taskId, fileId, type: 'DEK_PURGED', payload: {}
  });
}

// ── Main Message Handler ───────────────────────────────────────────────────

self.addEventListener('message', async (event: MessageEvent) => {
  const { taskId, fileId, type, payload } = event.data;

  try {
    switch (type) {
      case 'GENERATE_WRAP_DEK':
        await handleGenerateWrapDek(taskId, fileId, payload.kek);
        break;

      case 'UNWRAP_DEK':
        await handleUnwrapDek(taskId, fileId, payload.wrappedDek, payload.iv, payload.kek);
        break;

      case 'ENCRYPT_CHUNK':
        await handleEncryptChunk(taskId, fileId, payload.chunk, payload.chunkIndex);
        break;

      case 'DECRYPT_CHUNK':
        await handleDecryptChunk(taskId, fileId, payload.encryptedData, payload.chunkIndex);
        break;

      case 'PURGE_DEK':
        handlePurgeDek(taskId, fileId);
        break;

      default:
        throw new Error(`Unknown worker command: ${type}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    (self as unknown as Worker).postMessage({
      taskId, fileId, type: 'ERROR', payload: { message }
    });
  }
});

// ── Worker health ping ──────────────────────────────────────────────────────
(self as unknown as Worker).postMessage({ type: 'WORKER_READY', taskId: '__init__', fileId: '', payload: {} });

export {};
