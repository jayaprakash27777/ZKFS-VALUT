/**
 * types/vault.ts
 * Central TypeScript type registry for the ZK File Vault frontend.
 */

// ── File & Server Types ─────────────────────────────────────────────────────

export type UploadStatus = 'UPLOADING' | 'COMPLETE' | 'FAILED';

/** File metadata as returned by the Spring Boot API */
export interface VaultFile {
  id:                string;
  filenameEncrypted: string;   // Base64([IV(12)]||[AES-GCM ciphertext])
  mimeType:          string | null;
  totalSize:         number;
  totalChunks:       number;
  wrappedDek:        string;   // Base64 wrapped DEK
  ivWrappedDek:      string;   // Base64 12-byte IV
  uploadStatus:      UploadStatus;
  createdAt:         string;   // ISO-8601
  updatedAt:         string;

  // Client-side decrypted fields (populated lazily by the filename cache)
  filename?:         string;
  thumbnailEncrypted?: string;
  thumbnail?:        string;
}

export interface ChunkManifestEntry {
  id:             string;
  chunkIndex:     number;
  chunkSize:      number;
  ivChunk:        string;
  sha256Checksum: string;
}

// ── Upload Pipeline Types ────────────────────────────────────────────────────

export type UploadPhase =
  | 'queued'
  | 'deriving-key'
  | 'initiating'
  | 'encrypting'
  | 'uploading'
  | 'completing'
  | 'done'
  | 'error'
  | 'paused';

export interface PendingUpload {
  /** Client-side UUID (also used as the fileId before server assigns one) */
  localId:          string;
  /** Server-assigned fileId (null until initiate returns) */
  fileId:           string | null;
  /** Original plaintext filename — stored in memory only */
  fileName:         string;
  mimeType:         string;
  fileSize:         number;
  totalChunks:      number;
  phase:            UploadPhase;

  /**
   * The actual File object — kept in memory only during upload.
   * Needed by the UploadOrchestrator to read bytes for encryption.
   * Set to null after upload completes to avoid memory leaks.
   */
  file:             File | null;

  // Chunk-level progress
  currentChunk:     number;
  overallProgress:  number;   // 0–100

  // Performance metrics
  encryptSpeedMBs:  number;   // Encryption throughput in MB/s
  uploadSpeedMBs:   number;   // Network throughput in MB/s
  etaSeconds:       number | null;

  // Timing for speed calculation
  bytesProcessed:   number;
  startedAt:        number | null;   // Date.now() timestamp

  // Control
  paused:           boolean;
  abortController:  AbortController | null;
  error:            string | null;
}

// ── Worker Message Protocol ──────────────────────────────────────────────────

export type WorkerCommandType =
  | 'GENERATE_WRAP_DEK'
  | 'UNWRAP_DEK'
  | 'ENCRYPT_CHUNK'
  | 'DECRYPT_CHUNK'
  | 'PURGE_DEK';

export type WorkerEventType =
  | 'DEK_READY'
  | 'DEK_UNWRAPPED'
  | 'CHUNK_ENCRYPTED'
  | 'CHUNK_DECRYPTED'
  | 'PROGRESS'
  | 'DEK_PURGED'
  | 'ERROR';

export interface WorkerCommand<T = unknown> {
  taskId:  string;
  fileId:  string;
  type:    WorkerCommandType;
  payload: T;
}

export interface WorkerEvent<T = unknown> {
  taskId:  string;
  fileId:  string;
  type:    WorkerEventType;
  payload: T;
}

// Typed command payloads
export interface GenerateWrapDekPayload  { kek: CryptoKey }
export interface UnwrapDekPayload        { wrappedDek: ArrayBuffer; iv: ArrayBuffer; kek: CryptoKey }
export interface EncryptChunkPayload     { chunk: ArrayBuffer; chunkIndex: number }
export interface DecryptChunkPayload     { encryptedData: ArrayBuffer }

// Typed event payloads
export interface DekReadyPayload         { wrappedDekBuffer: ArrayBuffer; ivBuffer: ArrayBuffer }
export interface DekUnwrappedPayload     { success: boolean }
export interface ChunkEncryptedPayload   { chunkIndex: number; data: ArrayBuffer; ivB64: string; sha256Hex: string; encryptedSize: number }
export interface ChunkDecryptedPayload   { chunkIndex: number; data: ArrayBuffer }
export interface ProgressPayload         { phase: string; current: number; total: number; speedMBs: number }
export interface WorkerErrorPayload      { message: string; code?: string }

// ── UI State Types ────────────────────────────────────────────────────────────

export type ViewMode = 'grid' | 'list';
export type SortField = 'name' | 'date' | 'size' | 'type';
export type SortOrder = 'asc' | 'desc';

export interface FileFilter {
  query:     string;
  mimeGroup: 'all' | 'images' | 'documents' | 'videos' | 'archives';
  sortField: SortField;
  sortOrder: SortOrder;
}

export interface StorageQuota {
  used:  number;   // bytes
  total: number;   // bytes
}

// ── Crypto Worker Instance (returned by useCryptoWorker) ─────────────────────

export interface CryptoWorkerAPI {
  /** Generate a DEK and wrap it with the user's KEK. Stores DEK in worker memory keyed by fileId. */
  generateAndWrapDek(fileId: string, kek: CryptoKey): Promise<DekReadyPayload>;
  /** Unwrap a stored DEK into worker memory. Must be called before decryptChunk. */
  unwrapDek(fileId: string, wrappedDek: ArrayBuffer, iv: ArrayBuffer, kek: CryptoKey): Promise<void>;
  /** Encrypt a chunk using the worker's stored DEK for this fileId. */
  encryptChunk(
    fileId:     string,
    chunk:      ArrayBuffer,
    chunkIndex: number,
    onProgress?: (p: ProgressPayload) => void
  ): Promise<ChunkEncryptedPayload>;
  /** Decrypt a chunk using the worker's stored DEK for this fileId. */
  decryptChunk(
    fileId:        string,
    encryptedData: ArrayBuffer,
    chunkIndex:    number
  ): Promise<ChunkDecryptedPayload>;
  /** Remove a DEK from worker memory (call after upload/download completes). */
  purgeDek(fileId: string): Promise<void>;
  /** True if the worker has been created and is ready. */
  isReady: boolean;
  /** Terminate the worker (call on unmount). */
  terminate(): void;
}
