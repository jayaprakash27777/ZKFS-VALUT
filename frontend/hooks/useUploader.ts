/**
 * hooks/useUploader.ts
 *
 * File Upload Orchestrator — Zero-Knowledge Chunked Upload State Machine
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Full upload pipeline:
 *   1. Generate DEK (AES-256-GCM, 256-bit, per-file random)
 *   2. Wrap DEK with user KEK → wrappedDEK + IV
 *   3. Encrypt filename with KEK → filenameEncrypted
 *   4. POST /v1/files/initiate → receive fileId
 *   5. For each chunk (concurrent, max 3):
 *      a. Read raw bytes from file (File.slice → arrayBuffer)
 *      b. AES-GCM encrypt with DEK → [IV || ciphertext+tag]
 *      c. POST /v1/files/{fileId}/chunk/{index} (multipart)
 *      d. Retry on transient failure (max 2 retries, exponential backoff)
 *   6. POST /v1/files/{fileId}/complete → server verifies chunk count
 *
 * State transitions:
 *   idle → initiating → uploading → complete
 *                    ↘ cancelled
 *             any state → error
 *
 * Concurrency: semaphore pattern limits simultaneous chunk uploads.
 * Cancellation: AbortController cancels in-flight XHR and stops the loop.
 */

'use client';

import { useCallback, useReducer, useRef } from 'react';
import apiClient                            from '@/lib/api/client';
import {
  encryptChunk,
  computeTotalChunks,
  DEFAULT_CHUNK_SIZE,
  uint8ToBase64,
  encryptFilenameForStorage,
} from '@/lib/crypto/cipher';
import { generateAndWrapDEK }               from '@/lib/crypto/keys';

// ── Constants ──────────────────────────────────────────────────────────────

const MAX_CONCURRENT_UPLOADS = 3;
const MAX_RETRIES            = 5;
const RETRY_BASE_DELAY_MS    = 1000;  // Exponential: 1000ms, 2000ms, 4000ms, etc.

// ── Types ──────────────────────────────────────────────────────────────────

export type UploaderStatus =
  | 'idle'
  | 'initiating'
  | 'uploading'
  | 'completing'
  | 'complete'
  | 'error'
  | 'cancelled';

export type ChunkState = 'pending' | 'encrypting' | 'uploading' | 'done' | 'error';

export interface ChunkStatus {
  index:    number;
  state:    ChunkState;
  /** Upload progress for this specific chunk (0–100) */
  progress: number;
  retries:  number;
  error?:   string;
}

export interface UploaderState {
  status:          UploaderStatus;
  fileId:          string | null;
  totalChunks:     number;
  chunks:          ChunkStatus[];
  /** Overall upload progress as 0–100 float */
  overallProgress: number;
  /** Total encrypted bytes uploaded */
  bytesUploaded:   number;
  /** Total encrypted bytes to upload (estimated) */
  totalBytes:      number;
  error:           string | null;
}

export interface UploadOptions {
  /** File to upload */
  file:        File;
  /** User's Key Encryption Key (from useAuth) */
  kek:         CryptoKey;
  /** Chunk size in bytes (default 5 MiB) */
  chunkSize?:  number;
  /** Called on every progress update */
  onProgress?: (progress: number, state: UploaderState) => void;
  /** Called when upload completes successfully */
  onComplete?: (fileId: string) => void;
  /** Called on unrecoverable error */
  onError?:    (error: string) => void;
}

// ── Request / Response DTOs ────────────────────────────────────────────────

interface InitiateUploadRequest {
  filenameEncrypted: string;
  mimeType?:         string;
  totalChunks:       number;
  totalSize:         number;
  wrappedDek:        string;
  ivWrappedDek:      string;
}

interface InitiateUploadResponse {
  fileId:  string;
  status:  string;
}

interface CompleteUploadResponse {
  fileId:      string;
  status:      string;
  totalChunks: number;
}

// ── Reducer ────────────────────────────────────────────────────────────────

type UploaderAction =
  | { type: 'INITIATE_START' }
  | { type: 'INITIATE_DONE'; fileId: string; totalChunks: number; totalBytes: number }
  | { type: 'CHUNK_ENCRYPTING'; index: number }
  | { type: 'CHUNK_UPLOADING';  index: number }
  | { type: 'CHUNK_PROGRESS';   index: number; byteDelta: number; chunkProgress: number }
  | { type: 'CHUNK_DONE';       index: number }
  | { type: 'CHUNK_ERROR';      index: number; error: string; retry: number }
  | { type: 'COMPLETE' }
  | { type: 'CANCEL' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' };

const makeInitialState = (): UploaderState => ({
  status:          'idle',
  fileId:          null,
  totalChunks:     0,
  chunks:          [],
  overallProgress: 0,
  bytesUploaded:   0,
  totalBytes:      0,
  error:           null,
});

function computeOverallProgress(chunks: ChunkStatus[], totalBytes: number, bytesUploaded: number): number {
  if (totalBytes === 0) return 0;
  return Math.min(100, Math.round((bytesUploaded / totalBytes) * 100));
}

function uploaderReducer(state: UploaderState, action: UploaderAction): UploaderState {
  switch (action.type) {

    case 'RESET':
      return makeInitialState();

    case 'INITIATE_START':
      return { ...state, status: 'initiating', error: null };

    case 'INITIATE_DONE': {
      const chunks: ChunkStatus[] = Array.from({ length: action.totalChunks }, (_, i) => ({
        index: i, state: 'pending', progress: 0, retries: 0,
      }));
      return {
        ...state,
        status:      'uploading',
        fileId:      action.fileId,
        totalChunks: action.totalChunks,
        chunks,
        totalBytes:  action.totalBytes,
      };
    }

    case 'CHUNK_ENCRYPTING':
      return updateChunk(state, action.index, { state: 'encrypting' });

    case 'CHUNK_UPLOADING':
      return updateChunk(state, action.index, { state: 'uploading' });

    case 'CHUNK_PROGRESS': {
      const next = updateChunk(state, action.index, { progress: action.chunkProgress });
      const bytesUploaded = state.bytesUploaded + action.byteDelta;
      return {
        ...next,
        bytesUploaded,
        overallProgress: computeOverallProgress(next.chunks, next.totalBytes, bytesUploaded),
      };
    }

    case 'CHUNK_DONE':
      return updateChunk(state, action.index, { state: 'done', progress: 100 });

    case 'CHUNK_ERROR':
      return updateChunk(state, action.index, {
        state:   'error',
        retries: action.retry,
        error:   action.error,
      });

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

function updateChunk(
  state:  UploaderState,
  index:  number,
  patch:  Partial<ChunkStatus>
): UploaderState {
  const chunks = state.chunks.map(c =>
    c.index === index ? { ...c, ...patch } : c
  );
  return { ...state, chunks };
}

// ── Semaphore ──────────────────────────────────────────────────────────────

/**
 * Simple counting semaphore for concurrency control.
 * Limits simultaneous chunk uploads without blocking the main thread.
 */
class Semaphore {
  private permits: number;
  private queue:   Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release(): void {
    if (this.queue.length > 0) {
      this.queue.shift()!();
    } else {
      this.permits++;
    }
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useUploader() {
  const [state, dispatch]    = useReducer(uploaderReducer, makeInitialState());
  const abortControllerRef   = useRef<AbortController | null>(null);

  // ── Cancel Handler ─────────────────────────────────────────────────────

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    dispatch({ type: 'CANCEL' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  // ── Main Upload Entry Point ────────────────────────────────────────────

  const upload = useCallback(async (opts: UploadOptions): Promise<void> => {
    const {
      file,
      kek,
      chunkSize  = DEFAULT_CHUNK_SIZE,
      onProgress,
      onComplete,
      onError,
    } = opts;

    // Create a fresh AbortController for this upload session
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const { signal } = abortController;

    try {
      // ── STEP 1: Compute file metadata ────────────────────────────────────
      dispatch({ type: 'INITIATE_START' });

      const totalChunks = computeTotalChunks(file.size, chunkSize);
      // Estimated total encrypted size: each chunk gains 12 (IV) + 16 (tag) bytes
      const estimatedTotalBytes = file.size + totalChunks * (12 + 16);

      // ── STEP 2: Generate & wrap DEK ──────────────────────────────────────
      const { dek, wrappedDEK } = await generateAndWrapDEK(kek);

      // ── STEP 3: Encrypt filename (combined [IV||ciphertext] wire format) ────
      const filenameEncrypted = await encryptFilenameForStorage(file.name, kek);

      // ── STEP 4: Initiate upload session on server ────────────────────────
      checkAborted(signal);

      const initiatePayload: InitiateUploadRequest = {
        filenameEncrypted,
        mimeType:    file.type || undefined,
        totalChunks,
        totalSize:   file.size,
        wrappedDek:  wrappedDEK.wrappedDekB64,
        ivWrappedDek: wrappedDEK.ivB64,
      };

      const { data: initiateResponse } =
        await apiClient.post<InitiateUploadResponse>('/v1/files/initiate', initiatePayload, { signal });

      const { fileId } = initiateResponse;

      dispatch({
        type:        'INITIATE_DONE',
        fileId,
        totalChunks,
        totalBytes:  estimatedTotalBytes,
      });

      // ── STEP 5: Encrypt + upload all chunks (concurrent, max 3) ──────────
      const semaphore = new Semaphore(MAX_CONCURRENT_UPLOADS);

      /**
       * Uploads a single chunk with retry logic.
       * Encryption always happens in the same call — no pre-encryption buffer.
       */
      const uploadSingleChunk = async (chunkIndex: number): Promise<void> => {
        await semaphore.acquire();
        try {
          await uploadChunkWithRetry({
            file,
            chunkIndex,
            chunkSize,
            dek,
            fileId,
            signal,
            dispatch,
            onProgress,
            state, // pass for context
          });
        } finally {
          semaphore.release();
        }
      };

      // Launch all chunk tasks — semaphore bounds concurrency
      const chunkTasks = Array.from({ length: totalChunks }, (_, i) =>
        uploadSingleChunk(i)
      );

      // Wait for all (any rejection propagates immediately)
      await Promise.all(chunkTasks);

      // ── STEP 6: Mark upload complete on server ───────────────────────────
      checkAborted(signal);
      dispatch({ type: 'COMPLETE' });

      const { data: completeResp } =
        await apiClient.post<CompleteUploadResponse>(`/v1/files/${fileId}/complete`, {}, { signal });

      dispatch({ type: 'COMPLETE' });
      onProgress?.(100, { ...state, status: 'complete', overallProgress: 100 });
      onComplete?.(completeResp.fileId);

    } catch (err) {
      if (isAbortError(err)) {
        dispatch({ type: 'CANCEL' });
        return;
      }
      const message = err instanceof Error ? err.message : 'Upload failed';
      dispatch({ type: 'ERROR', message });
      onError?.(message);
    }
  }, []);

  return {
    state,
    upload,
    cancel,
    reset,
    // Convenience derived values
    isUploading:   state.status === 'uploading' || state.status === 'initiating',
    isComplete:    state.status === 'complete',
    isCancelled:   state.status === 'cancelled',
    hasError:      state.status === 'error',
    progress:      state.overallProgress,
  };
}

// ── Chunk Upload with Retry ────────────────────────────────────────────────

interface ChunkUploadArgs {
  file:       File;
  chunkIndex: number;
  chunkSize:  number;
  dek:        CryptoKey;
  fileId:     string;
  signal:     AbortSignal;
  dispatch:   React.Dispatch<UploaderAction>;
  onProgress?: (progress: number, state: UploaderState) => void;
  state:      UploaderState;
}

async function uploadChunkWithRetry(args: ChunkUploadArgs): Promise<void> {
  const { file, chunkIndex, chunkSize, dek, fileId, signal, dispatch } = args;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    checkAborted(signal);

    // ── 5a. Encrypt chunk ──────────────────────────────────────────────────
    dispatch({ type: 'CHUNK_ENCRYPTING', index: chunkIndex });

    const encrypted = await encryptChunk(file, chunkIndex, chunkSize, dek);

    // ── 5b. Build multipart FormData ───────────────────────────────────────
    const formData = new FormData();
    formData.append(
      'chunk',
      new Blob([encrypted.encryptedData as any], { type: 'application/octet-stream' }),

      `chunk-${chunkIndex}.enc`
    );
    formData.append('sha256Checksum', encrypted.sha256Hex);
    formData.append('ivChunk',        encrypted.ivB64);

    // ── 5c. POST chunk to server with per-chunk progress tracking ──────────
    dispatch({ type: 'CHUNK_UPLOADING', index: chunkIndex });

    try {
      await apiClient.post(
        `/v1/files/${fileId}/chunk/${chunkIndex}`,
        formData,
        {
          signal,
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (event) => {
            if (event.total && event.total > 0) {
              const chunkProgress = Math.round((event.loaded / event.total) * 100);
              const byteDelta     = event.loaded - (event.loaded - (event.bytes ?? 0));
              dispatch({
                type:          'CHUNK_PROGRESS',
                index:         chunkIndex,
                chunkProgress,
                byteDelta:     event.bytes ?? 0,
              });
            }
          },
        }
      );

      dispatch({ type: 'CHUNK_DONE', index: chunkIndex });
      return; // Success — exit retry loop

    } catch (err) {
      if (isAbortError(err)) throw err; // Propagate cancellation immediately

      if (attempt < MAX_RETRIES) {
        // Exponential backoff before retry
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        dispatch({
          type:  'CHUNK_ERROR',
          index: chunkIndex,
          error: `Attempt ${attempt + 1} failed, retrying in ${delay}ms…`,
          retry: attempt + 1,
        });
        await sleep(delay);
      } else {
        // All retries exhausted — fail the whole upload
        const message = err instanceof Error ? err.message : `Chunk ${chunkIndex} failed`;
        dispatch({
          type:  'CHUNK_ERROR',
          index: chunkIndex,
          error: message,
          retry: attempt,
        });
        throw new Error(`Chunk ${chunkIndex} failed after ${MAX_RETRIES} retries: ${message}`);
      }
    }
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Upload cancelled', 'AbortError');
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
