/**
 * hooks/useFileUpload.ts
 *
 * Zero-Knowledge File Upload Orchestrator
 * ========================================
 * 1. Generate a fresh AES-256-GCM DEK for this file
 * 2. Wrap the DEK with the user's session KEK (AES-GCM wrap)
 * 3. Encrypt the filename with the KEK
 * 4. Initiate upload session on the server (POST /files)
 * 5. Encrypt each chunk sequentially using the DEK (cipher.ts)
 * 6. POST each encrypted chunk to the server
 * 7. Mark upload complete (PATCH /files/{id}/complete)
 *
 * Uses the canonical cipher.ts API:
 *   encryptChunk(file, chunkIndex, chunkSize, dek) → EncryptedChunk
 */

'use client';

import { useCallback, useState } from 'react';
import { filesApi }              from '@/lib/api/files';
import { generateDEK, wrapDEK } from '@/lib/crypto';
import { encryptChunk, encryptFilenameForStorage, DEFAULT_CHUNK_SIZE }
  from '@/lib/crypto/cipher';

// ── Types ──────────────────────────────────────────────────────────────────

export type UploadStatus = 'idle' | 'encrypting' | 'uploading' | 'complete' | 'error';

export interface UploadProgress {
  status:          UploadStatus;
  currentChunk:    number;
  totalChunks:     number;
  percentComplete: number;
  error?:          string;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useFileUpload(kek: CryptoKey | null) {
  const [progress, setProgress] = useState<UploadProgress>({
    status:          'idle',
    currentChunk:    0,
    totalChunks:     0,
    percentComplete: 0,
  });

  const uploadFile = useCallback(async (file: File): Promise<void> => {
    if (!kek) {
      throw new Error('KEK not available — please re-authenticate.');
    }

    try {
      // ── 1. Generate DEK ─────────────────────────────────────────────────
      setProgress({ status: 'encrypting', currentChunk: 0, totalChunks: 0, percentComplete: 0 });

      const dek = await generateDEK();

      // ── 2. Wrap DEK with session KEK ────────────────────────────────────
      const { wrappedDekB64, ivB64: ivWrappedDek } = await wrapDEK(dek, kek);

      // ── 3. Encrypt filename using KEK (self-contained Base64 wire format) ─
      const filenameEncrypted = await encryptFilenameForStorage(file.name, kek);

      // ── 4. Compute total chunk count ────────────────────────────────────
      const totalChunks = Math.max(1, Math.ceil(file.size / DEFAULT_CHUNK_SIZE));
      setProgress({ status: 'encrypting', currentChunk: 0, totalChunks, percentComplete: 0 });

      // ── 5. Initiate upload — register file metadata on server ───────────
      const fileMetadata = await filesApi.initiateUpload({
        filenameEncrypted,
        mimeType:     file.type || undefined,
        totalChunks,
        totalSize:    file.size,
        wrappedDek:   wrappedDekB64,
        ivWrappedDek,
      });

      setProgress({ status: 'uploading', currentChunk: 0, totalChunks, percentComplete: 0 });

      // ── 6. Encrypt and upload each chunk sequentially ───────────────────
      for (let i = 0; i < totalChunks; i++) {
        // Encrypt this chunk (cipher.ts reads the File slice internally)
        const encrypted = await encryptChunk(file, i, DEFAULT_CHUNK_SIZE, dek);

        let chunkUploaded = false;
        let attempt = 0;
        const MAX_RETRIES = 5;

        while (!chunkUploaded && attempt <= MAX_RETRIES) {
          try {
            // POST binary blob + metadata to the server
            await filesApi.uploadChunk(
              fileMetadata.fileId,                           // ← use fileId (not .id)
              i,
              encrypted.encryptedData.buffer as ArrayBuffer, // underlying ArrayBuffer
              encrypted.ivB64,                               // Base64 IV for this chunk
              encrypted.sha256Hex,                           // SHA-256 of the wire frame
            );
            chunkUploaded = true;
          } catch (err) {
            attempt++;
            if (attempt > MAX_RETRIES) {
              if (typeof navigator !== 'undefined' && !navigator.onLine) {
                throw new Error(`Upload paused: You are offline. Failed at chunk ${i + 1}.`);
              }
              throw new Error(`Failed to upload chunk ${i + 1} after ${MAX_RETRIES} retries. Please check your connection.`);
            }
            // Exponential backoff: 1s, 2s, 4s...
            await new Promise(res => setTimeout(res, 1000 * Math.pow(2, attempt - 1)));
          }
        }

        const pct = Math.round(((i + 1) / totalChunks) * 100);
        setProgress({
          status:          'uploading',
          currentChunk:    i + 1,
          totalChunks,
          percentComplete: pct,
        });
      }

      // ── 7. Mark upload complete ──────────────────────────────────────────
      await filesApi.completeUpload(fileMetadata.fileId);   // ← use fileId


      setProgress({ status: 'complete', currentChunk: totalChunks, totalChunks, percentComplete: 100 });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      setProgress(prev => ({ ...prev, status: 'error', error: message }));
      throw error;
    }
  }, [kek]);

  const resetProgress = useCallback(() => {
    setProgress({ status: 'idle', currentChunk: 0, totalChunks: 0, percentComplete: 0 });
  }, []);

  return { progress, uploadFile, resetProgress };
}
