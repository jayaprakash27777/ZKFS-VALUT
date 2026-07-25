/**
 * hooks/useCryptoWorker.ts
 *
 * Type-safe React hook that wraps the AES-GCM crypto Web Worker.
 * ══════════════════════════════════════════════════════════════
 *
 * Creates a single Worker instance per hook mount (typically once per
 * dashboard session). All operations are queued as request/response
 * pairs tracked by `taskId` UUID, so multiple concurrent operations
 * are safe.
 *
 * Usage:
 *   const { api, isReady } = useCryptoWorker();
 *   const { wrappedDekBuffer, ivBuffer } = await api.generateAndWrapDek(fileId, kek);
 *   const encrypted = await api.encryptChunk(fileId, chunk, 0, onProgress);
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CryptoWorkerAPI,
  DekReadyPayload,
  ChunkEncryptedPayload,
  ChunkDecryptedPayload,
  ProgressPayload,
  WorkerErrorPayload,
} from '@/types/vault';

// ── Types for the internal pending-request registry ────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject:  (reason: Error) => void;
}

interface ProgressCallback {
  callback: (p: ProgressPayload) => void;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useCryptoWorker(): { api: CryptoWorkerAPI; isReady: boolean } {
  const workerRef           = useRef<Worker | null>(null);
  const pendingRef          = useRef<Map<string, PendingRequest>>(new Map());
  const progressRef         = useRef<Map<string, ProgressCallback>>(new Map());
  const [isReady, setReady] = useState(false);

  // ── Worker creation ────────────────────────────────────────────────────────
  useEffect(() => {
    // Web Workers are client-only
    if (typeof window === 'undefined') return;

    const worker = new Worker(
      new URL('@/lib/workers/crypto.worker', import.meta.url)
    );

    worker.addEventListener('message', (event: MessageEvent) => {
      const { taskId, type, payload } = event.data as {
        taskId: string;
        type:   string;
        payload: unknown;
      };

      // ── Worker ready signal ──────────────────────────────────────────────
      if (type === 'WORKER_READY') {
        setReady(true);
        return;
      }

      // ── Progress events ──────────────────────────────────────────────────
      if (type === 'PROGRESS') {
        progressRef.current.get(taskId)?.callback(payload as ProgressPayload);
        return;  // Do NOT resolve the pending request — it's still processing
      }

      // ── Terminal events ──────────────────────────────────────────────────
      const pending = pendingRef.current.get(taskId);
      if (!pending) return;
      pendingRef.current.delete(taskId);

      if (type === 'ERROR') {
        pending.reject(new Error((payload as WorkerErrorPayload).message));
      } else {
        pending.resolve(payload);
      }
    });

    worker.addEventListener('error', (event: ErrorEvent) => {
      console.error('[CryptoWorker] Uncaught error:', event.message);
      // Reject ALL pending requests on fatal worker error
      pendingRef.current.forEach(({ reject }) =>
        reject(new Error(`Worker crashed: ${event.message}`))
      );
      pendingRef.current.clear();
    });

    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
      setReady(false);
    };
  }, []);

  // ── Internal send helper ───────────────────────────────────────────────────
  const send = useCallback(<T>(
    fileId:      string,
    type:        string,
    payload:     object,
    transferable: Transferable[] = [],
    onProgress?:  (p: ProgressPayload) => void
  ): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const taskId  = crypto.randomUUID();
      const worker  = workerRef.current;
      if (!worker) { reject(new Error('CryptoWorker is not initialized')); return; }

      pendingRef.current.set(taskId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });

      if (onProgress) {
        progressRef.current.set(taskId, { callback: onProgress });
      }

      worker.postMessage({ taskId, fileId, type, payload }, transferable);
    });
  }, []);

  // ── Public API (stable object reference — memoised via useCallback) ────────
  const api: CryptoWorkerAPI = {
    isReady,

    generateAndWrapDek: (fileId, kek) =>
      send<DekReadyPayload>(fileId, 'GENERATE_WRAP_DEK', { kek }),

    unwrapDek: async (fileId, wrappedDek, iv, kek) => {
      await send<void>(fileId, 'UNWRAP_DEK', { wrappedDek, iv, kek }, [
        wrappedDek,
        iv,
      ]);
    },

    encryptChunk: (fileId, chunk, chunkIndex, onProgress) =>
      send<ChunkEncryptedPayload>(
        fileId,
        'ENCRYPT_CHUNK',
        { chunk, chunkIndex },
        [chunk],   // Transfer ownership (zero-copy) to worker
        onProgress
      ),

    decryptChunk: (fileId, encryptedData, chunkIndex) =>
      send<ChunkDecryptedPayload>(
        fileId,
        'DECRYPT_CHUNK',
        { encryptedData, chunkIndex },
        [encryptedData]
      ),

    purgeDek: (fileId) =>
      send<void>(fileId, 'PURGE_DEK', {}),

    terminate: () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      setReady(false);
    },
  };

  return { api, isReady };
}

// ── Singleton accessor (for non-hook contexts like upload queue managers) ──

let _workerInstance: Worker | null = null;
let _ready = false;
const _pending = new Map<string, PendingRequest>();
const _progress = new Map<string, ProgressCallback>();

/**
 * Returns a singleton CryptoWorker API suitable for use outside React hooks.
 * Used by the upload queue manager which runs outside the React component tree.
 */
export function getGlobalCryptoWorker(): CryptoWorkerAPI {
  if (typeof window === 'undefined') {
    throw new Error('getGlobalCryptoWorker must be called in a browser context');
  }

  if (!_workerInstance) {
    _workerInstance = new Worker(
      new URL('@/lib/workers/crypto.worker', import.meta.url)
    );
    _workerInstance.addEventListener('message', (e: MessageEvent) => {
      const { taskId, type, payload } = e.data;
      if (type === 'WORKER_READY') { _ready = true; return; }
      if (type === 'PROGRESS') { _progress.get(taskId)?.callback(payload); return; }
      const p = _pending.get(taskId);
      if (!p) return;
      _pending.delete(taskId);
      type === 'ERROR' ? p.reject(new Error(payload.message)) : p.resolve(payload);
    });
  }

  const send = <T>(
    fileId: string, type: string, payload: object,
    transferable: Transferable[] = [],
    onProgress?: (p: ProgressPayload) => void
  ): Promise<T> => new Promise<T>((resolve, reject) => {
    const taskId = crypto.randomUUID();
    if (!_workerInstance) { reject(new Error('Worker unavailable')); return; }
    _pending.set(taskId, { resolve: resolve as (v: unknown) => void, reject });
    if (onProgress) _progress.set(taskId, { callback: onProgress });
    _workerInstance.postMessage({ taskId, fileId, type, payload }, transferable);
  });

  return {
    isReady: _ready,
    generateAndWrapDek: (f, k) => send<DekReadyPayload>(f, 'GENERATE_WRAP_DEK', { kek: k }),
    unwrapDek: async (f, wd, iv, k) => { await send(f, 'UNWRAP_DEK', { wrappedDek: wd, iv, kek: k }, [wd, iv]); },
    encryptChunk: (f, c, i, p) => send<ChunkEncryptedPayload>(f, 'ENCRYPT_CHUNK', { chunk: c, chunkIndex: i }, [c], p),
    decryptChunk: (f, d, i) => send<ChunkDecryptedPayload>(f, 'DECRYPT_CHUNK', { encryptedData: d, chunkIndex: i }, [d]),
    purgeDek: (f) => send(f, 'PURGE_DEK', {}),
    terminate: () => { _workerInstance?.terminate(); _workerInstance = null; _ready = false; },
  };
}
