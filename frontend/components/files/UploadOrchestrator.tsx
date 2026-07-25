/**
 * components/files/UploadOrchestrator.tsx
 *
 * Upload Orchestrator — Drives the ZK Encrypt-Then-Upload Pipeline
 * ════════════════════════════════════════════════════════════════════
 *
 * This component watches the Zustand upload store for files in 'queued' phase
 * and orchestrates the full zero-knowledge pipeline:
 *
 *   queued → deriving-key → initiating → [encrypting → uploading] per chunk → completing → done
 *
 * Why this component exists:
 *   dashboard/page.tsx adds PendingUpload entries with phase='queued' when the user
 *   picks files. This component is the bridge that actually starts the crypto work.
 *
 * Concurrency: processes up to MAX_PARALLEL files simultaneously.
 * Renders nothing — purely a side-effect component.
 */

'use client';

import { useEffect, useRef }      from 'react';
import { useQueryClient }         from '@tanstack/react-query';
import { useVaultStore }          from '@/store/useVaultStore';
import { generateAndWrapDEK }     from '@/lib/crypto/keys';
import { generateImageThumbnail } from '@/lib/utils/thumbnail';
import {
  encryptChunk,
  encryptFilenameForStorage,
  computeTotalChunks,
  DEFAULT_CHUNK_SIZE,
} from '@/lib/crypto/cipher';
import { filesApi }               from '@/lib/api/files';
import type { PendingUpload }     from '@/types/vault';

const MAX_PARALLEL = 2;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Per-file upload runner ─────────────────────────────────────────────────

async function runUpload(
  upload:     PendingUpload,
  kek:        CryptoKey,
  file:       File,
  invalidate: () => void,
): Promise<void> {
  const { localId } = upload;
  const signal = upload.abortController?.signal;
  const get    = () => useVaultStore.getState();

  try {
    // ── Step 1: Generate DEK + wrap with KEK ───────────────────────────
    get().setUploadPhase(localId, 'deriving-key');

    const { dek, wrappedDEK } = await generateAndWrapDEK(kek);

    // ── Step 2: Encrypt filename and thumbnail ─────────────────────────
    const filenameEncrypted = await encryptFilenameForStorage(file.name, kek);
    const thumbnailDataUri = await generateImageThumbnail(file);
    let thumbnailEncrypted = undefined;
    if (thumbnailDataUri) {
      thumbnailEncrypted = await encryptFilenameForStorage(thumbnailDataUri, kek);
    }

    // ── Step 3: Initiate upload on server ─────────────────────────────
    get().setUploadPhase(localId, 'initiating');
    if (signal?.aborted) return;

    const totalChunks = computeTotalChunks(file.size, DEFAULT_CHUNK_SIZE);

    const initiated = await filesApi.initiateUpload({
      filenameEncrypted,
      mimeType:     file.type || undefined,
      thumbnailEncrypted,
      totalChunks,
      totalSize:    file.size,
      wrappedDek:   wrappedDEK.wrappedDekB64,
      ivWrappedDek: wrappedDEK.ivB64,
      folderId:     get().currentFolderId || undefined,
    });

    const fileId = initiated.fileId;   // backend returns "fileId" not "id"
    get().updateUpload(localId, { fileId, totalChunks });

    // ── Step 4: Encrypt + upload each chunk ───────────────────────────
    const startTime = Date.now();

    for (let i = 0; i < totalChunks; i++) {
      if (signal?.aborted) return;

      // Encrypt
      get().setUploadPhase(localId, 'encrypting');
      const t0        = performance.now();
      const encrypted = await encryptChunk(file, i, DEFAULT_CHUNK_SIZE, dek);
      const encryptMs = performance.now() - t0;
      const chunkMB   = encrypted.plainSize / (1024 * 1024);
      const encMBs    = chunkMB / Math.max(encryptMs / 1000, 0.001);

      if (signal?.aborted) return;

      // Upload with retry
      get().setUploadPhase(localId, 'uploading');
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          await filesApi.uploadChunk(
            fileId,
            i,
            encrypted.encryptedData.buffer as ArrayBuffer,
            encrypted.ivB64,
            encrypted.sha256Hex,
          );
          break;
        } catch (err) {
          if (attempt < 2) await sleep(800 * Math.pow(2, attempt));
          else throw err;
        }
      }

      // Progress update
      const done    = i + 1;
      const pct     = Math.round((done / totalChunks) * 100);
      const elapsed = (Date.now() - startTime) / 1000;
      const eta     = elapsed > 0 ? (elapsed / done) * (totalChunks - done) : null;
      get().advanceChunk(localId, done, pct);
      get().setUploadMetrics(localId, encMBs, 0, eta);
    }

    // ── Step 5: Complete upload ────────────────────────────────────────
    get().setUploadPhase(localId, 'completing');
    await filesApi.completeUpload(fileId);

    get().setUploadPhase(localId, 'done');
    get().advanceChunk(localId, totalChunks, 100);

    // Refresh file list
    invalidate();

    // Remove File reference to free memory, then remove from HUD after 3s
    get().updateUpload(localId, { file: null });
    setTimeout(() => get().removeUpload(localId), 3000);

  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      get().removeUpload(localId);
      return;
    }
    const message = err instanceof Error ? err.message : 'Upload failed';
    get().updateUpload(localId, { phase: 'error', error: message, file: null });
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export function UploadOrchestrator() {
  const queryClient = useQueryClient();
  const inFlight    = useRef<Set<string>>(new Set());

  useEffect(() => {
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: ['files'] });

    const unsub = useVaultStore.subscribe(state => {
      const { uploads, kek } = state;
      if (!kek) return;

      for (const [localId, upload] of uploads) {
        if (upload.phase !== 'queued') continue;
        if (inFlight.current.has(localId)) continue;
        if (inFlight.current.size >= MAX_PARALLEL) continue;
        if (!upload.file) continue;  // No File object = can't encrypt

        inFlight.current.add(localId);
        runUpload(upload, kek, upload.file, invalidate).finally(() => {
          inFlight.current.delete(localId);
        });
      }
    });

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient]);

  return null;
}
