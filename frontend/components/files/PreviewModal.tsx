/**
 * components/files/PreviewModal.tsx
 *
 * In-Browser Decryption Preview Modal
 * ═════════════════════════════════════
 *
 * Security guarantees:
 *   • Encrypted chunks are fetched from the streaming endpoint → decrypted
 *     entirely in-browser via the crypto Web Worker → assembled into an
 *     ephemeral Blob URL.
 *   • The Blob URL is revoked immediately on close ("Wipe Memory & Close").
 *   • No plaintext bytes are written to local disk (no Service Worker cache,
 *     no download triggered, no IndexedDB).
 *   • The DEK is unwrapped from the server's wrappedDek using the session KEK
 *     which only exists in RAM.
 *
 * Supported preview types:
 *   Images:    <img> with objectURL
 *   Video:     <video> with objectURL
 *   Audio:     <audio> with objectURL
 *   PDF:       <iframe sandbox> with objectURL
 *   Text/code: <pre> (TextDecoder on plaintext bytes)
 *   Other:     "Cannot preview — Decrypt & Download instead"
 */

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence }          from 'framer-motion';
import * as Dialog                          from '@radix-ui/react-dialog';
import * as VisuallyHidden                  from '@radix-ui/react-visually-hidden';
import {
  X, Shield, AlertTriangle, Download, Loader2, Lock,
  Image as ImageIcon, Film, FileText, Volume2, File
} from 'lucide-react';
import { useVaultStore }                    from '@/store/useVaultStore';
import { getGlobalCryptoWorker }            from '@/hooks/useCryptoWorker';
import { base64ToUint8 }                    from '@/lib/crypto/cipher';
import apiClient                            from '@/lib/api/client';
import type { VaultFile, ChunkManifestEntry } from '@/types/vault';

// ── Types ────────────────────────────────────────────────────────────────────

type PreviewState =
  | { phase: 'idle'        }
  | { phase: 'fetching'    }
  | { phase: 'decrypting'; progress: number; current: number; total: number }
  | { phase: 'ready';      blobUrl: string; mimeType: string }
  | { phase: 'text-ready'; text: string; mimeType: string }
  | { phase: 'error';      message: string }
  | { phase: 'unsupported'; mimeType: string };

// ── MIME helpers ──────────────────────────────────────────────────────────────

function getPreviewKind(mime: string | null): 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none' {
  if (!mime) return 'none';
  if (mime.startsWith('image/'))    return 'image';
  if (mime.startsWith('video/'))    return 'video';
  if (mime.startsWith('audio/'))    return 'audio';
  if (mime.includes('pdf'))         return 'pdf';
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml')) return 'text';
  return 'none';
}

// ── Integrity helpers ─────────────────────────────────────────────────────────
async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data as any);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Preview Renderer ──────────────────────────────────────────────────────────
function PreviewRenderer({ state }: { state: PreviewState }) {
  if (state.phase === 'idle')     return null;

  if (state.phase === 'fetching' || state.phase === 'decrypting') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="relative">
          <Loader2 className="h-10 w-10 text-violet-400 animate-spin" />
          <Lock className="absolute inset-0 m-auto h-4 w-4 text-violet-300" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-zinc-300">
            {state.phase === 'fetching' ? 'Fetching encrypted chunks…' : 'Decrypting in browser…'}
          </p>
          {state.phase === 'decrypting' && (
            <>
              <p className="text-xs text-zinc-500 mt-1">
                Chunk {state.current} of {state.total}
              </p>
              <div className="mt-3 h-1.5 w-48 rounded-full bg-white/10 overflow-hidden mx-auto">
                <motion.div
                  className="h-full rounded-full bg-violet-500"
                  animate={{ width: `${state.progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <AlertTriangle className="h-10 w-10 text-red-400" />
        <p className="text-sm text-zinc-300 font-medium">Decryption failed</p>
        <p className="text-xs text-zinc-500 max-w-xs">{state.message}</p>
      </div>
    );
  }

  if (state.phase === 'unsupported') {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <File className="h-10 w-10 text-zinc-600" />
        <p className="text-sm text-zinc-300 font-medium">Cannot preview this file type</p>
        <p className="text-xs text-zinc-500">{state.mimeType}</p>
        <p className="text-xs text-zinc-600 mt-1">Use "Decrypt & Download" to open locally</p>
      </div>
    );
  }

  if (state.phase === 'text-ready') {
    return (
      <pre className="overflow-auto p-4 text-xs text-zinc-300 font-mono rounded-xl
                      bg-white/[0.03] border border-white/[0.05] max-h-[60vh]
                      whitespace-pre-wrap break-words">
        {state.text}
      </pre>
    );
  }

  if (state.phase === 'ready') {
    const kind = getPreviewKind(state.mimeType);
    switch (kind) {
      case 'image':
        return (
          <img
            src={state.blobUrl}
            alt="Decrypted preview"
            className="max-h-[60vh] max-w-full object-contain mx-auto rounded-xl"
          />
        );
      case 'video':
        return (
          <video
            src={state.blobUrl}
            controls
            className="max-h-[60vh] max-w-full rounded-xl mx-auto"
          />
        );
      case 'audio':
        return (
          <div className="flex items-center justify-center py-8">
            <audio src={state.blobUrl} controls className="w-full max-w-md" />
          </div>
        );
      case 'pdf':
        return (
          <iframe
            src={state.blobUrl}
            title="PDF preview"
            className="w-full rounded-xl border border-white/8"
            style={{ height: '65vh' }}
            sandbox="allow-scripts allow-same-origin"
          />
        );
    }
  }

  return null;
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export function PreviewModal({ fileId, kek }: { fileId: string; kek: CryptoKey | null }) {
  const setPreviewFileId = useVaultStore(s => s.setPreviewFileId);
  const [file, setFile]  = useState<VaultFile | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>({ phase: 'idle' });
  const blobUrlRef       = useRef<string | null>(null);
  const workerRef        = useRef(getGlobalCryptoWorker());

  const close = useCallback(() => {
    // "Wipe Memory & Close" — immediately revoke the Blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setPreviewState({ phase: 'idle' });
    setPreviewFileId(null);
  }, [setPreviewFileId]);

  // ── Decrypt + preview on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!kek || !fileId) return;

    let cancelled = false;

    const run = async () => {
      setPreviewState({ phase: 'fetching' });

      // 1. Fetch file metadata + chunk manifest in parallel
      const [metaResp, chunksResp] = await Promise.all([
        apiClient.get<VaultFile>(`/v1/files/${fileId}`),
        apiClient.get<ChunkManifestEntry[]>(`/v1/files/${fileId}/chunks`),
      ]);
      if (cancelled) return;

      const meta   = metaResp.data;
      const chunks = chunksResp.data;
      setFile(meta);

      const kind = getPreviewKind(meta.mimeType);
      if (kind === 'none') {
        setPreviewState({ phase: 'unsupported', mimeType: meta.mimeType ?? 'unknown' });
        return;
      }

      if (meta.isPasswordProtected) {
        setPreviewState({ phase: 'error', message: 'Previewing password-protected files is not currently supported. Please use "Decrypt & Download" instead.' });
        return;
      }

      // 2. Unwrap DEK into worker memory
      const wrappedDekBuf = base64ToUint8(meta.wrappedDek).buffer as any;
      const ivBuf         = base64ToUint8(meta.ivWrappedDek).buffer as any;
      await workerRef.current.unwrapDek(fileId, wrappedDekBuf, ivBuf, kek);
      if (cancelled) return;

      // 3. Download + decrypt each chunk sequentially
      const decryptedParts = new Array<ArrayBuffer>(meta.totalChunks);

      for (let i = 0; i < meta.totalChunks; i++) {
        if (cancelled) return;

        setPreviewState({
          phase:    'decrypting',
          current:  i + 1,
          total:    meta.totalChunks,
          progress: Math.round(((i) / meta.totalChunks) * 100),
        });

        // Fetch encrypted chunk binary
        const chunkResp = await apiClient.get<ArrayBuffer>(
          `/v1/files/${fileId}/chunk/${i}/stream`,
          { responseType: 'arraybuffer' }
        );
        if (cancelled) return;

        const encryptedData = new Uint8Array(chunkResp.data);

        // Verify SHA-256 integrity before decryption
        const actualSha = await sha256Hex(encryptedData);
        if (actualSha !== chunks[i]?.sha256Checksum) {
          setPreviewState({ phase: 'error', message: `Chunk ${i} integrity check failed — data tampered` });
          await workerRef.current.purgeDek(fileId);
          return;
        }

        // Decrypt via worker (off UI thread)
        const { data: plain } = await workerRef.current.decryptChunk(
          fileId,
          encryptedData.buffer as any,
          i
        );

        decryptedParts[i] = plain;
      }

      if (cancelled) return;

      // 4. Purge DEK from worker memory
      await workerRef.current.purgeDek(fileId);

      // 5. Build ephemeral Blob URL
      const blob   = new Blob(decryptedParts, { type: meta.mimeType ?? 'application/octet-stream' });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;

      if (kind === 'text') {
        // Read text synchronously from the blob
        const text = await blob.text();
        if (!cancelled) setPreviewState({ phase: 'text-ready', text, mimeType: meta.mimeType ?? '' });
        URL.revokeObjectURL(blobUrl);
        blobUrlRef.current = null;
      } else {
        if (!cancelled) setPreviewState({ phase: 'ready', blobUrl, mimeType: meta.mimeType ?? '' });
      }
    };

    run().catch(err => {
      if (!cancelled) {
        setPreviewState({
          phase:   'error',
          message: err instanceof Error ? err.message : 'Unknown decryption error',
        });
        workerRef.current.purgeDek(fileId).catch(() => {});
      }
    });

    return () => {
      cancelled = true;
      // Revoke Blob URL if component unmounts mid-preview
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [fileId, kek]);

  const displayName = file?.filename ?? 'Encrypted File';
  const kind = getPreviewKind(file?.mimeType ?? null);
  const KindIcon = kind === 'image' ? ImageIcon : kind === 'video' ? Film :
                   kind === 'text'  ? FileText  : kind === 'audio' ? Volume2 : Lock;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md"
          />
        </Dialog.Overlay>

        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{   opacity: 0, scale: 0.96,  y: 8  }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          >
            <div className="w-full max-w-4xl rounded-2xl bg-zinc-900 border border-white/8
                            shadow-2xl shadow-black/80 overflow-hidden flex flex-col max-h-[90vh]">

              {/* Modal header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600/20">
                  <KindIcon className="h-4 w-4 text-violet-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-200 truncate">{displayName}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Shield className="h-3 w-3 text-emerald-500" />
                    <span className="text-[11px] text-emerald-600">
                      Decrypted in-browser • No disk write • AES-256-GCM
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {previewState.phase === 'ready' && (
                    <button
                      onClick={() => { /* trigger download */ }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                                 text-zinc-400 hover:text-white hover:bg-white/8
                                 border border-white/8 transition-all duration-150"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Save
                    </button>
                  )}
                  <button
                    onClick={close}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                               text-red-400 hover:text-red-300 hover:bg-red-500/10
                               border border-red-500/20 transition-all duration-150"
                  >
                    <X className="h-3.5 w-3.5" />
                    Wipe & Close
                  </button>
                </div>
              </div>

              {/* Preview area */}
              <div className="flex-1 overflow-auto p-5 min-h-0">
                <PreviewRenderer state={previewState} />
              </div>
            </div>

            <VisuallyHidden.Root>
              <Dialog.Title>{displayName}</Dialog.Title>
              <Dialog.Description>Decrypted file preview — AES-256-GCM</Dialog.Description>
            </VisuallyHidden.Root>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
