/**
 * hooks/useDownloader.ts
 *
 * Secure File Download & In-Browser Decryption Orchestrator
 * ══════════════════════════════════════════════════════════
 *
 * Complete download pipeline (fully client-side decryption):
 *
 *   1. Fetch file metadata  →  GET /v1/files/{fileId}
 *                              Receives: filenameEncrypted, wrappedDek, ivWrappedDek,
 *                                        totalChunks, totalSize, mimeType
 *
 *   2. Fetch chunk manifest →  GET /v1/files/{fileId}/chunks
 *                              Receives: [{chunkIndex, chunkSize, ivChunk, sha256Checksum}]
 *
 *   3. Decrypt filename     →  decryptFilenameFromStorage(filenameEncrypted, kek)
 *                              KEK lives only in session memory (useAuth)
 *
 *   4. Unwrap DEK           →  crypto.subtle.unwrapKey(wrappedDek, kek)
 *                              Produces a non-extractable AES-GCM CryptoKey
 *
 *   5. Download + decrypt   →  For each chunk (parallel, max 3 concurrent):
 *      chunks in parallel        a. GET /v1/files/{fileId}/chunk/{index}/stream
 *                                   → ArrayBuffer (encrypted wire frame from MinIO)
 *                                b. verifyChunkIntegrity(frame, sha256Checksum)
 *                                   → throws on mismatch (tamper detection)
 *                                c. decryptChunkBuffer(frame, dek)
 *                                   → plaintext ArrayBuffer
 *                                d. Store in decryptedParts[chunkIndex]
 *
 *   6. Assemble Blob        →  new Blob(decryptedParts, { type: mimeType })
 *      & trigger save           URL.createObjectURL(blob)
 *                               → <a download={filename}>.click()
 *                               → revokeObjectURL after 100ms (GC the Blob URL)
 *
 * Memory model:
 *   Peak RAM ≈ totalSize × 2  (encrypted download buffer + decrypted parts)
 *   During batch download, only MAX_CONCURRENT × chunkSize bytes are held
 *   encrypted in memory simultaneously before decryption replaces them.
 *
 *   For files >500MB, prefer the File System Access API (showSaveFilePicker)
 *   to avoid materialising the full Blob in the JS heap. See note below.
 */

'use client';

import { useCallback, useReducer, useRef }  from 'react';
import apiClient                            from '@/lib/api/client';
import {
  decryptChunkBuffer,
  decryptFilenameFromStorage,
  unwrapDEKForDownload,
  verifyChunkIntegrity,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
} from '@/lib/crypto/cipher';
import { exportEncryptedZkfs }              from '@/lib/utils/export';
import { useVaultStore }                    from '@/store/useVaultStore';

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_CONCURRENT_DOWNLOADS = 3;
const MAX_RETRIES               = 2;
const RETRY_BASE_DELAY_MS       = 600;

// ── Types ──────────────────────────────────────────────────────────────────

export type DownloaderStatus =
  | 'idle'
  | 'fetching-metadata'
  | 'unwrapping-key'
  | 'downloading'
  | 'assembling'
  | 'complete'
  | 'error'
  | 'cancelled';

export type DownloadChunkState =
  | 'pending'
  | 'downloading'
  | 'decrypting'
  | 'done'
  | 'error';

export interface DownloadChunkStatus {
  index:    number;
  state:    DownloadChunkState;
  /** Download progress for this specific chunk (0–100) */
  progress: number;
  retries:  number;
  error?:   string;
}

export interface DownloaderState {
  status:          DownloaderStatus;
  /** Decrypted filename (available after Step 3) */
  fileName:        string | null;
  mimeType:        string | null;
  totalChunks:     number;
  /** Long-axis total — estimated from server totalSize (original bytes) */
  totalBytes:      number;
  bytesDownloaded: number;
  /** Overall progress 0–100 */
  overallProgress: number;
  chunks:          DownloadChunkStatus[];
  error:           string | null;
}

export interface DownloadOptions {
  fileId:      string;
  /** Session KEK from useAuth — must be non-null or this will throw */
  kek:         CryptoKey;
  onProgress?: (progress: number, state: DownloaderState) => void;
  onComplete?: (fileName: string) => void;
  onError?:    (error: string) => void;
  offline?:    boolean;

  isSharedWithMe?: boolean;
  sharedWrappedDek?: string;
  sharedIv?: string;
  privateKey?: CryptoKey | null;
  customPassword?: string;
  passkeyKek?: CryptoKey;
}

/** Shape returned by GET /v1/files/{fileId} */
interface FileMetadataResponse {
  id:                string;
  filenameEncrypted: string;
  mimeType?:         string;
  totalChunks:       number;
  totalSize:         number;
  wrappedDek:        string;
  ivWrappedDek:      string;
  uploadStatus:      string;
  isPasswordProtected: boolean;
  passwordSalt?:     string;
  isPasskeyProtected: boolean;
  passkeySalt?:      string;
}

/** Shape returned by GET /v1/files/{fileId}/chunks — one element per chunk */
interface ChunkManifestEntry {
  id:             string;
  chunkIndex:     number;
  chunkSize:      number;
  ivChunk:        string;   // Base64 12-byte IV (also embedded in wire frame header)
  sha256Checksum: string;   // Hex SHA-256 for integrity check before decryption
}

// ── Reducer ────────────────────────────────────────────────────────────────

type DownloaderAction =
  | { type: 'FETCH_METADATA' }
  | { type: 'UNWRAP_KEY' }
  | {
      type: 'DOWNLOAD_START';
      totalChunks:  number;
      totalBytes:   number;
      fileName:     string;
      mimeType:     string | null;
    }
  | { type: 'CHUNK_DOWNLOADING'; index: number }
  | { type: 'CHUNK_PROGRESS';    index: number; byteDelta: number; chunkProgress: number }
  | { type: 'CHUNK_DECRYPTING';  index: number }
  | { type: 'CHUNK_DONE';        index: number }
  | { type: 'CHUNK_ERROR';       index: number; error: string; retries: number }
  | { type: 'ASSEMBLING' }
  | { type: 'COMPLETE' }
  | { type: 'CANCEL' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' };

const initialState = (): DownloaderState => ({
  status:          'idle',
  fileName:        null,
  mimeType:        null,
  totalChunks:     0,
  totalBytes:      0,
  bytesDownloaded: 0,
  overallProgress: 0,
  chunks:          [],
  error:           null,
});

function computeProgress(bytesDownloaded: number, totalBytes: number): number {
  if (totalBytes === 0) return 0;
  return Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100));
}

function downloaderReducer(state: DownloaderState, action: DownloaderAction): DownloaderState {
  switch (action.type) {
    case 'RESET':
      return initialState();

    case 'FETCH_METADATA':
      return { ...state, status: 'fetching-metadata', error: null };

    case 'UNWRAP_KEY':
      return { ...state, status: 'unwrapping-key' };

    case 'DOWNLOAD_START': {
      const chunks: DownloadChunkStatus[] = Array.from(
        { length: action.totalChunks },
        (_, i) => ({ index: i, state: 'pending', progress: 0, retries: 0 })
      );
      return {
        ...state,
        status:      'downloading',
        totalChunks: action.totalChunks,
        totalBytes:  action.totalBytes,
        fileName:    action.fileName,
        mimeType:    action.mimeType,
        chunks,
      };
    }

    case 'CHUNK_DOWNLOADING':
      return patchChunk(state, action.index, { state: 'downloading' });

    case 'CHUNK_PROGRESS': {
      const bytesDownloaded = state.bytesDownloaded + action.byteDelta;
      const next = patchChunk(state, action.index, { progress: action.chunkProgress });
      return {
        ...next,
        bytesDownloaded,
        overallProgress: computeProgress(bytesDownloaded, next.totalBytes),
      };
    }

    case 'CHUNK_DECRYPTING':
      return patchChunk(state, action.index, { state: 'decrypting' });

    case 'CHUNK_DONE':
      return patchChunk(state, action.index, { state: 'done', progress: 100 });

    case 'CHUNK_ERROR':
      return patchChunk(state, action.index, {
        state:   'error',
        retries: action.retries,
        error:   action.error,
      });

    case 'ASSEMBLING':
      return { ...state, status: 'assembling' };

    case 'COMPLETE':
      return { ...state, status: 'complete', overallProgress: 100 };

    case 'CANCEL':
      return { ...state, status: 'cancelled' };

    case 'ERROR':
      return { ...state, status: 'error', error: action.message };

    default:
      return state;
  }
}

function patchChunk(
  state:  DownloaderState,
  index:  number,
  patch:  Partial<DownloadChunkStatus>
): DownloaderState {
  return {
    ...state,
    chunks: state.chunks.map(c => c.index === index ? { ...c, ...patch } : c),
  };
}

// ── Mutex & Semaphore ────────────────────────────────────────────────────────

class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise(r => this.queue.push(r));
  }
  release(): void {
    if (this.queue.length > 0) {
      this.queue.shift()!();
    } else {
      this.locked = false;
    }
  }
}

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];
  constructor(permits: number) { this.permits = permits; }
  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    return new Promise(r => this.queue.push(r));
  }
  release(): void {
    if (this.queue.length > 0) this.queue.shift()!();
    else this.permits++;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useDownloader() {
  const [state, dispatch]   = useReducer(downloaderReducer, initialState());
  const abortControllerRef  = useRef<AbortController | null>(null);
  // Stable ref to current state for closures
  const stateRef            = useRef<DownloaderState>(state);
  stateRef.current          = state;

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    dispatch({ type: 'CANCEL' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const download = useCallback(async (opts: DownloadOptions): Promise<void> => {
    const { fileId, kek, onProgress, onComplete, onError, offline = false, isSharedWithMe, sharedWrappedDek, privateKey, customPassword, passkeyKek } = opts;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    try {
      // ────────────────────────────────────────────────────────────────────────
      // STEP 1: Fetch file metadata + chunk manifest in parallel
      // ────────────────────────────────────────────────────────────────────────
      dispatch({ type: 'FETCH_METADATA' });
      checkAborted(signal);

      const [metaResp, chunksResp] = await Promise.all([
        apiClient.get<FileMetadataResponse>(`/v1/files/${fileId}`, { signal }),
        apiClient.get<ChunkManifestEntry[]>(`/v1/files/${fileId}/chunks`, { signal }),
      ]);

      const meta          = metaResp.data;
      const chunkManifest = chunksResp.data;  // Ordered by chunkIndex ASC

      if (meta.uploadStatus !== 'COMPLETE') {
        throw new Error(`File is not ready for download (status: ${meta.uploadStatus})`);
      }

      // ────────────────────────────────────────────────────────────────────────
      // STEP 2: Unwrap DEK
      // ────────────────────────────────────────────────────────────────────────
      dispatch({ type: 'UNWRAP_KEY' });
      checkAborted(signal);

      console.log('[ZKFS Download] Step 2: Unwrapping DEK', {
        isPasskeyProtected: meta.isPasskeyProtected,
        isPasswordProtected: meta.isPasswordProtected,
        hasPasskeyKek: !!passkeyKek,
        hasCustomPassword: !!customPassword,
        isSharedWithMe: !!isSharedWithMe,
        wrappedDekLength: meta.wrappedDek?.length,
      });

      let dek: CryptoKey;
      
      if (isSharedWithMe && sharedWrappedDek && privateKey) {
        const { decryptWithPrivateKey } = await import('@/lib/crypto/asymmetric');
        const dekBytes = await decryptWithPrivateKey(privateKey, sharedWrappedDek);
        dek = await window.crypto.subtle.importKey(
          'raw',
          dekBytes as any,
          { name: 'AES-GCM' },
          false,
          ['decrypt']
        );
      } else {
        if (meta.isPasswordProtected) {
          if (!customPassword) {
            throw new Error('Password required to decrypt this file');
          }
          if (!meta.passwordSalt) {
             throw new Error('Missing password salt for password protected file');
          }
          const cryptoLib = await import('@/lib/crypto/password');
          const fileKek = await cryptoLib.deriveFileKek(customPassword, meta.passwordSalt);
          dek = await unwrapDEKForDownload(meta.wrappedDek, meta.ivWrappedDek, fileKek);
        } else if (meta.isPasskeyProtected) {
          if (!passkeyKek) {
            throw new Error('Passkey authentication is required to decrypt this file. Please try again.');
          }
          dek = await unwrapDEKForDownload(meta.wrappedDek, meta.ivWrappedDek, passkeyKek);
        } else {
          dek = await unwrapDEKForDownload(meta.wrappedDek, meta.ivWrappedDek, kek);
        }
      }

      // ────────────────────────────────────────────────────────────────────────
      // STEP 3: Decrypt filename
      // Filenames are always encrypted with the master KEK (kek).
      // File CONTENTS are encrypted with the passkey/password-derived DEK.
      // ────────────────────────────────────────────────────────────────────────
      let fileName = 'Unknown File';
      try {
        // Always try with master KEK first (new behaviour - filenames use master KEK)
        fileName = await decryptFilenameFromStorage(meta.filenameEncrypted, kek);
        console.log('[ZKFS Download] Step 3: Filename decrypted OK:', fileName);
      } catch (e) {
        console.warn("[ZKFS Download] Filename decryption with master KEK failed:", e);
      }

      dispatch({
        type:        'DOWNLOAD_START',
        totalChunks: meta.totalChunks,
        totalBytes:  meta.totalSize,
        fileName,
        mimeType:    meta.mimeType ?? null,
      });

      // ────────────────────────────────────────────────────────────────────────
      // File System Access API (Stream directly to disk for large files)
      // ────────────────────────────────────────────────────────────────────────
      // File System Access API — skip for passkey-protected files to avoid double browser dialogs
      // (user already had to interact with a passkey dialog; a second OS file-picker right after
      //  causes AbortError or confusion on some browsers)
      let stream: any = null; // FileSystemWritableFileStream
      const useStreamApi = !offline && !meta.isPasskeyProtected && 'showSaveFilePicker' in window;
      if (useStreamApi) {
        try {
          const handle = await (window as any).showSaveFilePicker({ suggestedName: fileName });
          stream = await handle.createWritable();
        } catch (err: any) {
          if (err.name === 'AbortError') {
            dispatch({ type: 'CANCEL' });
            return;
          }
          console.warn('[ZKFS Download] Failed to obtain FileSystemWritableFileStream, falling back to Blob', err);
        }
      }

      // Pre-calculate plaintext offsets for each chunk to write them safely to stream
      const chunkOffsets = new Array<number>(meta.totalChunks);
      let currentOffset = 0;
      for (let i = 0; i < chunkManifest.length; i++) {
        chunkOffsets[i] = currentOffset;
        const plainSize = chunkManifest[i].chunkSize - (GCM_IV_BYTES + GCM_TAG_BYTES);
        currentOffset += plainSize;
      }

      // ────────────────────────────────────────────────────────────────────────
      // STEPS 4+5: Parallel batch download + decrypt
      // Pre-allocate result array — filled out of order, reassembled after
      // ────────────────────────────────────────────────────────────────────────
      const decryptedParts = new Array<ArrayBuffer>(meta.totalChunks);
      const semaphore      = new Semaphore(MAX_CONCURRENT_DOWNLOADS);
      const writeMutex     = new Mutex();

      const downloadAndDecryptChunk = async (manifest: ChunkManifestEntry, index: number): Promise<void> => {
        await semaphore.acquire();
        try {
          await downloadSingleChunk({
            fileId,
            manifest,
            dek,
            signal,
            dispatch,
            decryptedParts,
            stream,
            offset: chunkOffsets[index],
            writeMutex,
          });
        } finally {
          semaphore.release();
        }
      };

      // Launch all download tasks — semaphore bounds concurrency
      await Promise.all(chunkManifest.map((m, index) => downloadAndDecryptChunk(m, index)));

      // ────────────────────────────────────────────────────────────────────────
      // STEP 6: Assemble Blob and trigger browser save dialog
      // ────────────────────────────────────────────────────────────────────────
      dispatch({ type: 'ASSEMBLING' });
      checkAborted(signal);

      if (stream) {
        // If we streamed to disk, just close the stream and we're done!
        await stream.close();
      } else {
        // Verify all chunks were collected (guards against race conditions)
        if (decryptedParts.some(p => p === undefined || p === null)) {
          throw new Error('One or more chunks failed to decrypt — cannot assemble file');
        }

        // Construct Blob from ordered decrypted parts
        const blob = new Blob(decryptedParts, { type: meta.mimeType || 'application/octet-stream' });
        
        if (offline) {
          const { userEmail } = useVaultStore.getState();
          if (!userEmail) throw new Error("User session required for offline export");
          const authApi = (await import('@/lib/api/auth')).authApi;
          const { salt } = await authApi.getSalt(userEmail);
          await exportEncryptedZkfs(blob, fileName, kek, salt);
        } else {
          const blobUrl  = URL.createObjectURL(blob);
          triggerBrowserDownload(blobUrl, fileName);
        }
      }

      dispatch({ type: 'COMPLETE' });
      onProgress?.(100, stateRef.current);
      onComplete?.(fileName);

    } catch (err) {
      if (isAbortError(err)) {
        dispatch({ type: 'CANCEL' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Download failed';
      dispatch({ type: 'ERROR', message });
      onError?.(message);
    }
  }, []);

  return {
    state,
    download,
    cancel,
    reset,
    isDownloading: state.status === 'downloading' || state.status === 'fetching-metadata'
                   || state.status === 'unwrapping-key',
    isAssembling:  state.status === 'assembling',
    isComplete:    state.status === 'complete',
    isCancelled:   state.status === 'cancelled',
    hasError:      state.status === 'error',
    progress:      state.overallProgress,
    fileName:      state.fileName,
  };
}

// ── Single Chunk Download + Decrypt ────────────────────────────────────────

interface ChunkDownloadArgs {
  fileId:         string;
  manifest:       ChunkManifestEntry;
  dek:            CryptoKey;
  signal:         AbortSignal;
  dispatch:       React.Dispatch<DownloaderAction>;
  decryptedParts: ArrayBuffer[];  // Shared result array — filled by index
  stream:         any | null;     // FileSystemWritableFileStream
  offset:         number;
  writeMutex:     Mutex;
}

async function downloadSingleChunk(args: ChunkDownloadArgs): Promise<void> {
  const { fileId, manifest, dek, signal, dispatch, decryptedParts, stream, offset, writeMutex } = args;
  const { chunkIndex, sha256Checksum } = manifest;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    checkAborted(signal);

    // ── A. Fetch encrypted binary from streaming endpoint ──────────────────
    dispatch({ type: 'CHUNK_DOWNLOADING', index: chunkIndex });

    try {
      const response = await apiClient.get<ArrayBuffer>(
        `/v1/files/${fileId}/chunk/${chunkIndex}/stream`,
        {
          responseType: 'arraybuffer',
          signal,
          onDownloadProgress: (event) => {
            if (event.total && event.total > 0) {
              dispatch({
                type:          'CHUNK_PROGRESS',
                index:         chunkIndex,
                chunkProgress: Math.round((event.loaded / event.total) * 100),
                byteDelta:     event.bytes ?? 0,
              });
            }
          },
        }
      );

      const encryptedData = new Uint8Array(response.data);

      // ── B. Integrity verification (SHA-256 over the wire frame) ───────────
      //    Performed BEFORE decryption — reject tampered data early
      const integrityOk = await verifyChunkIntegrity(encryptedData, sha256Checksum);
      if (!integrityOk) {
        throw new IntegrityError(
          `Chunk ${chunkIndex}: SHA-256 mismatch — data may have been tampered with`
        );
      }

      // ── C. AES-256-GCM decrypt (IV extracted from wire-frame header) ───────
      //    decryptChunkBuffer reads bytes 0–11 as IV, decrypts bytes 12…
      //    WebCrypto verifies the GCM auth tag automatically — tamper → throw
      dispatch({ type: 'CHUNK_DECRYPTING', index: chunkIndex });

      const plaintext = await decryptChunkBuffer(encryptedData, dek);

      // ── D. Store decrypted bytes at the correct index for reassembly ───────
      if (stream) {
        await writeMutex.acquire();
        try {
          await stream.write({ type: 'write', position: offset, data: plaintext });
        } finally {
          writeMutex.release();
        }
      } else {
        decryptedParts[chunkIndex] = plaintext;
      }

      // ── E. Explicitly release the encrypted buffer reference ───────────────
      //    This hints the GC to reclaim encrypted bytes after decryption.
      //    If streaming, plaintext is also freed automatically since it's not saved to decryptedParts[].
      (response as unknown as { data: null }).data = null;

      dispatch({ type: 'CHUNK_DONE', index: chunkIndex });
      return; // Success

    } catch (err) {
      if (isAbortError(err)) throw err;
      if (err instanceof IntegrityError) throw err; // No retry on tampered data

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        dispatch({
          type:    'CHUNK_ERROR',
          index:   chunkIndex,
          error:   `Attempt ${attempt + 1} failed, retrying in ${delay}ms…`,
          retries: attempt + 1,
        });
        await sleep(delay);
      } else {
        const message = err instanceof Error ? err.message : `Chunk ${chunkIndex} download failed`;
        dispatch({
          type:    'CHUNK_ERROR',
          index:   chunkIndex,
          error:   message,
          retries: attempt,
        });
        throw new Error(`Chunk ${chunkIndex} failed after ${MAX_RETRIES} retries: ${message}`);
      }
    }
  }
}

// ── Browser Save Trigger ───────────────────────────────────────────────────

/**
 * Creates a temporary object URL for the assembled Blob, synthesises a
 * hidden <a download> element, triggers a click, then revokes the URL.
 *
 * The revoke is delayed by 100ms so the browser has time to start the download
 * before the URL becomes invalid.
 *
 * NOTE: For files >500MB, prefer the File System Access API pattern:
 *   const handle = await window.showSaveFilePicker({ suggestedName: fileName });
 *   const writable = await handle.createWritable();
 *   await writable.write(blob);
 *   await writable.close();
 * This streams directly to disk without materialising the Blob URL.
 */
function triggerBrowserDownload(blobUrl: string, fileName: string): void {
  const anchor      = document.createElement('a');
  anchor.href       = blobUrl;
  anchor.download   = fileName;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoke after 60 seconds — browser needs time to begin the download stream
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
}

// ── Custom Error Types ─────────────────────────────────────────────────────

class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
