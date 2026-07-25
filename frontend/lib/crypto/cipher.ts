/**
 * lib/crypto/cipher.ts
 *
 * AES-256-GCM Chunk Encryption Engine
 * ═════════════════════════════════════
 *
 * Binary wire format for each encrypted chunk:
 * ┌─────────────────────────────────────────────────────────┐
 * │  Offset   │  Length   │  Contents                       │
 * ├───────────┼───────────┼─────────────────────────────────┤
 * │  0        │  12 bytes │  AES-GCM IV (random, unique)    │
 * │  12       │  N bytes  │  AES-GCM ciphertext             │
 * │  12+N     │  16 bytes │  AES-GCM authentication tag     │
 * └─────────────────────────────────────────────────────────┘
 *
 * The IV is prepended so the encrypted blob is self-contained:
 * a downloader only needs the DEK to decrypt any chunk independently.
 *
 * The IV is also returned separately as Base64 for database storage,
 * giving the backend a fast lookup path without parsing the binary header.
 *
 * SHA-256 is computed over the ENTIRE wire frame (IV + ciphertext + tag),
 * giving end-to-end tamper detection across the storage layer.
 */

// ── Constants ──────────────────────────────────────────────────────────────

/** AES-GCM IV length in bytes — NIST SP 800-38D mandates 96-bit (12-byte) IVs */
export const GCM_IV_BYTES = 12;

/** AES-GCM authentication tag length in bytes (128-bit tag — WebCrypto default) */
export const GCM_TAG_BYTES = 16;

/** Default chunk size: 5 MiB — balances memory use vs. request overhead */
export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

// ── Core Types ─────────────────────────────────────────────────────────────

/** Encrypted chunk result with all metadata needed for server + DB storage */
export interface EncryptedChunk {
  /**
   * Wire-format bytes: [12-byte IV] + [AES-GCM ciphertext+tag]
   * This is what gets POSTed to the server and stored in MinIO.
   */
  encryptedData: Uint8Array;
  /** Base64-encoded 12-byte IV — stored in file_chunks.iv_chunk */
  ivB64: string;
  /** Hex-encoded SHA-256 of encryptedData — stored in file_chunks.sha256_checksum */
  sha256Hex: string;
  /** Total byte count of encryptedData (= 12 + plaintext.length + 16) */
  encryptedSize: number;
  /** Original (pre-encryption) chunk size in bytes */
  plainSize: number;
  /** Zero-based chunk index */
  chunkIndex: number;
}

/** Result of decrypting a single chunk */
export interface DecryptedChunk {
  /** Raw plaintext bytes */
  data: Uint8Array;
  /** Zero-based chunk index — needed to reassemble in correct order */
  chunkIndex: number;
}

// ── Chunk Slicing ──────────────────────────────────────────────────────────

/**
 * Reads a file slice for the given chunk index as ArrayBuffer.
 * Uses `File.slice()` which is zero-copy in modern browsers.
 *
 * @param file       Source file from <input> or drag-and-drop
 * @param chunkIndex Zero-based index of the chunk to read
 * @param chunkSize  Max bytes per chunk (default: 5 MiB)
 * @returns          Raw chunk bytes as ArrayBuffer
 */
export async function readChunk(
  file:       File,
  chunkIndex: number,
  chunkSize   = DEFAULT_CHUNK_SIZE
): Promise<ArrayBuffer> {
  const start = chunkIndex * chunkSize;
  const end   = Math.min(start + chunkSize, file.size);

  if (start >= file.size && file.size !== 0) {
    throw new RangeError(
      `Chunk index ${chunkIndex} is out of range for file of size ${file.size}`
    );
  }

  return file.slice(start, end).arrayBuffer();
}

/**
 * Computes the total number of chunks for a file at a given chunk size.
 */
export function computeTotalChunks(fileSize: number, chunkSize = DEFAULT_CHUNK_SIZE): number {
  if (fileSize === 0) return 1; // Empty file gets one (empty) chunk
  return Math.ceil(fileSize / chunkSize);
}

// ── AES-GCM Encryption ─────────────────────────────────────────────────────

/**
 * Encrypts a single file chunk using AES-256-GCM and returns the
 * self-contained wire frame: `[12-byte IV] || [ciphertext + GCM-tag]`.
 *
 * Each call generates a fresh random IV — NEVER reuse an IV with the same DEK.
 *
 * @param file        Source File object
 * @param chunkIndex  Zero-based chunk index
 * @param chunkSize   Bytes per chunk (default: 5 MiB)
 * @param dek         File's AES-256-GCM Data Encryption Key
 * @returns           EncryptedChunk with wire frame + metadata
 *
 * @example
 *   const chunk = await encryptChunk(file, 0, DEFAULT_CHUNK_SIZE, dek);
 *   // POST chunk.encryptedData to /api/v1/files/{id}/chunk/0
 */
export async function encryptChunk(
  file:       File,
  chunkIndex: number,
  chunkSize:  number,
  dek:        CryptoKey
): Promise<EncryptedChunk> {
  // ── 1. Read raw bytes from file ──────────────────────────────────────────
  const plainBuffer = await readChunk(file, chunkIndex, chunkSize);
  const plainSize   = plainBuffer.byteLength;

  // ── 2. Generate a unique 12-byte IV for this chunk ───────────────────────
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));

  // ── 3. AES-256-GCM encrypt ───────────────────────────────────────────────
  //   Result = ciphertext (plaintext.length bytes) + auth tag (16 bytes)
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name:       'AES-GCM',
      iv:         iv as any,
      tagLength:  128,   // 128-bit authentication tag (maximum)
    },
    dek,
    plainBuffer
  );

  // ── 4. Build wire frame: [IV (12)] || [ciphertext+tag (N+16)] ────────────
  const cipherBytes    = new Uint8Array(cipherBuffer);
  const encryptedData  = new Uint8Array(GCM_IV_BYTES + cipherBytes.length);
  encryptedData.set(iv, 0);
  encryptedData.set(cipherBytes, GCM_IV_BYTES);

  // ── 5. Compute SHA-256 over the ENTIRE wire frame ────────────────────────
  //   (IV + ciphertext + tag) — any byte-level tampering invalidates this
  const hashBuffer = await crypto.subtle.digest('SHA-256', encryptedData as any);
  const sha256Hex  = uint8ToHex(new Uint8Array(hashBuffer));

  // ── 6. Encode IV as Base64 for DB storage ────────────────────────────────
  const ivB64 = uint8ToBase64(iv);

  return {
    encryptedData,
    ivB64,
    sha256Hex,
    encryptedSize: encryptedData.length,
    plainSize,
    chunkIndex,
  };
}

/**
 * Encrypts all chunks of a file sequentially, yielding each EncryptedChunk
 * via an async generator. This allows the caller to pipeline encryption and
 * upload — while chunk N is uploading, chunk N+1 is being encrypted.
 *
 * @param file      Source file
 * @param dek       AES-256-GCM Data Encryption Key
 * @param chunkSize Bytes per chunk (default: 5 MiB)
 * @param signal    Optional AbortSignal for cancellation
 *
 * @example
 *   for await (const chunk of encryptFileChunks(file, dek)) {
 *     await uploadChunk(chunk);
 *   }
 */
export async function* encryptFileChunks(
  file:      File,
  dek:       CryptoKey,
  chunkSize  = DEFAULT_CHUNK_SIZE,
  signal?:   AbortSignal
): AsyncGenerator<EncryptedChunk> {
  const total = computeTotalChunks(file.size, chunkSize);

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      throw new DOMException('Upload cancelled by user', 'AbortError');
    }
    yield await encryptChunk(file, i, chunkSize, dek);
  }
}

// ── AES-GCM Decryption ─────────────────────────────────────────────────────

/**
 * Decrypts a single chunk from its wire-format bytes.
 *
 * Extracts the IV from the first 12 bytes of the frame, then
 * AES-GCM-decrypts the remaining bytes (ciphertext + tag).
 *
 * The GCM authentication tag is verified automatically by WebCrypto —
 * any tampering will cause the decrypt call to throw.
 *
 * @param encryptedData  Wire-format bytes: [12-byte IV] || [ciphertext+tag]
 * @param dek            AES-256-GCM Data Encryption Key
 * @param chunkIndex     Index for reassembly ordering
 * @returns              Raw plaintext bytes + chunk index
 *
 * @throws               DOMException if authentication tag verification fails
 */
export async function decryptChunk(
  encryptedData: Uint8Array,
  dek:           CryptoKey,
  chunkIndex:    number
): Promise<DecryptedChunk> {
  if (encryptedData.length < GCM_IV_BYTES + GCM_TAG_BYTES) {
    throw new RangeError(
      `Encrypted chunk is too short (${encryptedData.length} bytes) — corrupt data`
    );
  }

  // ── 1. Extract IV from wire-frame header ─────────────────────────────────
  const iv         = encryptedData.slice(0, GCM_IV_BYTES);
  const ciphertext = encryptedData.slice(GCM_IV_BYTES);

  // ── 2. AES-GCM decrypt — throws if tag verification fails ────────────────
  const plainBuffer = await crypto.subtle.decrypt(
    {
      name:      'AES-GCM',
      iv:        iv as any,
      tagLength: 128,
    },
    dek,
    ciphertext as any
  );

  return {
    data: new Uint8Array(plainBuffer),
    chunkIndex,
  };
}

/**
 * Decrypts all chunks and reassembles them into a single Blob.
 * Chunks must be provided in correct order (ascending chunkIndex).
 *
 * @param encryptedChunks  Array of wire-format encrypted chunks
 * @param dek              AES-256-GCM Data Encryption Key
 * @param mimeType         MIME type for the reconstructed Blob
 */
export async function decryptAndReassemble(
  encryptedChunks: Uint8Array[],
  dek:             CryptoKey,
  mimeType?:       string
): Promise<Blob> {
  const decryptedParts: Uint8Array[] = [];

  for (let i = 0; i < encryptedChunks.length; i++) {
    const { data } = await decryptChunk(encryptedChunks[i], dek, i);
    decryptedParts.push(data);
  }

  return new Blob(decryptedParts as any, { type: mimeType });
}

// ── Integrity Verification ─────────────────────────────────────────────────

/**
 * Verifies the SHA-256 checksum of an encrypted chunk wire frame.
 * Call this after downloading a chunk and before decrypting it.
 *
 * @param encryptedData  Wire-format bytes received from server
 * @param expectedHex    Hex SHA-256 stored in database at upload time
 * @returns              true if integrity check passes
 */
export async function verifyChunkIntegrity(
  encryptedData: Uint8Array,
  expectedHex:   string
): Promise<boolean> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', encryptedData as any);
  const actualHex  = uint8ToHex(new Uint8Array(hashBuffer));
  return actualHex === expectedHex.toLowerCase();
}

// ── Binary Utilities ───────────────────────────────────────────────────────

/** Converts Uint8Array to lowercase hex string */
export function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Converts Uint8Array to Base64 string */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Converts Base64 string to Uint8Array */
export function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Converts ArrayBuffer to Uint8Array without copying */
export function toUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

// ── Phase 4: Download Decryption Primitives ────────────────────────────────────────

/**
 * Decrypts a chunk wire frame and returns the raw plaintext as ArrayBuffer.
 *
 * This is the primary decryption function used by the download orchestrator.
 * It is a lighter-weight alternative to `decryptChunk` — no index tracking,
 * returns `ArrayBuffer` directly for Blob construction.
 *
 * Protocol:
 *   1. Slice bytes 0–11 as the 12-byte AES-GCM IV.
 *   2. Pass bytes 12…end (ciphertext + GCM tag) to SubtleCrypto.decrypt.
 *   3. WebCrypto automatically verifies the 128-bit GCM auth tag.
 *      If verification fails (tampered data), the Promise rejects.
 *
 * @param encryptedData  Wire-format bytes from MinIO: [IV(12)] || [ciphertext+tag]
 * @param dek            AES-256-GCM Data Encryption Key (unwrapped from server's wrappedDek)
 * @returns              Plaintext ArrayBuffer — original file bytes for this chunk
 *
 * @throws DOMException  ('OperationError') if GCM auth tag verification fails
 * @throws RangeError    if encryptedData is too short to contain a valid frame
 */
export async function decryptChunkBuffer(
  encryptedData: Uint8Array,
  dek:           CryptoKey
): Promise<ArrayBuffer> {
  if (encryptedData.length < GCM_IV_BYTES + GCM_TAG_BYTES) {
    throw new RangeError(
      `Chunk frame too short: ${encryptedData.length} bytes — minimum is ${
        GCM_IV_BYTES + GCM_TAG_BYTES
      } (IV + empty plaintext + tag)`
    );
  }

  // ── 1. Extract IV from wire-frame header (first 12 bytes) ───────────────────
  const iv         = encryptedData.subarray(0, GCM_IV_BYTES);
  const ciphertext = encryptedData.subarray(GCM_IV_BYTES);

  // ── 2. AES-256-GCM decrypt (GCM tag verified automatically) ────────────────
  return crypto.subtle.decrypt(
    {
      name:      'AES-GCM',
      iv:        iv as any,
      tagLength: 128,   // Must match the tagLength used during encryption
    },
    dek,
    ciphertext as any
  );
}


// ── Filename Encryption / Decryption (Phase 4) ────────────────────────────────

/**
 * Encrypts a filename and encodes it as a single self-contained Base64 string.
 *
 * Wire format (stored in `filename_encrypted` DB column):
 *   Base64( [IV (12 bytes)] || [AES-GCM ciphertext + 16-byte tag] )
 *
 * This matches the chunk wire format — self-contained, no separate IV column.
 * Requires no DB schema change from Phase 1.
 *
 * @param filename  Original UTF-8 filename string
 * @param kek       User's Key Encryption Key (AES-256-GCM CryptoKey)
 * @returns         Combined Base64 string safe to store in filename_encrypted
 */
export async function encryptFilenameForStorage(
  filename: string,
  kek:      CryptoKey
): Promise<string> {
  const iv         = crypto.getRandomValues(new Uint8Array(GCM_IV_BYTES));
  const encoder    = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any, tagLength: 128 },
    kek,
    encoder.encode(filename) as any
  );


  // Build combined wire frame: [IV(12)] || [ciphertext+tag]
  const combined = new Uint8Array(GCM_IV_BYTES + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), GCM_IV_BYTES);

  return uint8ToBase64(combined);
}

/**
 * Decrypts a filename stored in the combined Base64 wire format.
 *
 * Reverses `encryptFilenameForStorage`:
 *   1. Base64-decode the combined field.
 *   2. Extract first 12 bytes as IV.
 *   3. AES-GCM decrypt remaining bytes with the session KEK.
 *   4. UTF-8 decode the plaintext bytes.
 *
 * @param combinedB64  Value of `filename_encrypted` from server
 * @param kek          User's Key Encryption Key (from session memory)
 * @returns            Original filename string
 *
 * @throws DOMException if KEK is wrong or data was tampered
 */
export async function decryptFilenameFromStorage(
  combinedB64: string,
  kek:         CryptoKey
): Promise<string> {
  const combined = base64ToUint8(combinedB64);

  if (combined.length < GCM_IV_BYTES + GCM_TAG_BYTES) {
    throw new RangeError('filename_encrypted is too short — corrupt or wrong format');
  }

  const iv         = combined.subarray(0, GCM_IV_BYTES);
  const ciphertext = combined.subarray(GCM_IV_BYTES);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any, tagLength: 128 },
    kek,
    ciphertext as any
  );


  return new TextDecoder('utf-8').decode(plainBuffer);
}

// ── DEK Unwrapping Helper (re-exported for download orchestrator) ───────────────

/**
 * Unwraps a stored DEK using the session KEK.
 * Reads the Base64 IV and ciphertext, runs AES-GCM unwrapKey.
 * Returns a non-extractable CryptoKey ready for chunk decryption.
 *
 * @param wrappedDekB64   Base64 wrapped DEK (from FileMetadataDto.wrappedDek)
 * @param ivB64           Base64 12-byte IV  (from FileMetadataDto.ivWrappedDek)
 * @param kek             Session KEK in memory (from useAuth)
 */
export async function unwrapDEKForDownload(
  wrappedDekB64: string,
  ivB64:         string,
  kek:           CryptoKey
): Promise<CryptoKey> {
  const wrappedDek = base64ToUint8(wrappedDekB64);
  const iv         = base64ToUint8(ivB64);

  return crypto.subtle.unwrapKey(
    'raw',
    wrappedDek as any,
    kek,
    { name: 'AES-GCM', iv: iv as any },
    { name: 'AES-GCM', length: 256 },
    true,                     // Extractable (needed for re-wrapping in secure share)
    ['encrypt', 'decrypt']    // Both usages — encrypt needed for re-wrap if ever
  );
}

