/**
 * app/share/[token]/page.tsx
 *
 * Public Zero-Knowledge File Download Page
 * =========================================
 * No login required. The share token + password together grant access.
 *
 * Pipeline:
 *   1. Load share metadata from server (GET /v1/share/{token})
 *   2. User enters the share password
 *   3. Derive shareKEK = Argon2id(password, shareSaltB64)
 *   4. Unwrap DEK using shareKEK (AES-GCM unwrap)
 *   5. Decrypt filename using shareKEK
 *   6. Download + decrypt each chunk via /v1/share/{token}/chunk/{i}/stream
 *   7. Assemble Blob and trigger browser file save
 */

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence }  from 'framer-motion';
import axios                        from 'axios';
import {
  Lock, Shield, Download, Eye, EyeOff, AlertCircle,
  Loader2, CheckCircle2, File, FileText, Image, Film, Archive,
} from 'lucide-react';
import {
  deriveKEKBytes,
  importKEKAsCryptoKey,
} from '@/lib/crypto/argon2';
import { base64ToBuffer, bufferToBase64 } from '@/lib/crypto/index';
import type { ShareMetadata }             from '@/lib/api/share';

const PUBLIC_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/api';
const GCM_TAG_BYTES = 16;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024)       return `${b} B`;
  if (b < 1024 ** 2)  return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)  return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function getMimeIcon(mime: string | null) {
  if (!mime)                       return File;
  if (mime.startsWith('image/'))   return Image;
  if (mime.startsWith('video/'))   return Film;
  if (mime.startsWith('text/'))    return FileText;
  if (mime.includes('pdf'))        return FileText;
  if (mime.includes('zip') || mime.includes('tar')) return Archive;
  return File;
}

async function deriveShareKEK(password: string, saltB64: string): Promise<CryptoKey> {
  const saltBin  = atob(saltB64);
  const saltBytes = new Uint8Array(saltBin.length);
  for (let i = 0; i < saltBin.length; i++) saltBytes[i] = saltBin.charCodeAt(i);
  const kekBytes = await deriveKEKBytes(password, saltBytes);
  return importKEKAsCryptoKey(kekBytes);
}

async function unwrapShareDEK(
  shareWrappedDek: string,
  shareIvDek: string,
  shareKEK: CryptoKey
): Promise<CryptoKey> {
  const wrappedDek = base64ToBuffer(shareWrappedDek);
  const iv         = base64ToBuffer(shareIvDek);
  return crypto.subtle.unwrapKey(
    'raw', wrappedDek, shareKEK,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function decryptShareFilename(
  shareEncFilename: string,
  shareIvFilename: string,
  shareKEK: CryptoKey
): Promise<string> {
  const ciphertext  = base64ToBuffer(shareEncFilename);
  const iv          = base64ToBuffer(shareIvFilename);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    shareKEK,
    ciphertext
  );
  return new TextDecoder('utf-8').decode(plainBuffer);
}

async function downloadAndDecryptChunks(
  token: string,
  totalChunks: number,
  dek: CryptoKey,
  mimeType: string | null,
  onProgress: (pct: number) => void
): Promise<Blob> {
  const parts: ArrayBuffer[] = new Array(totalChunks);

  for (let i = 0; i < totalChunks; i++) {
    const url = `${PUBLIC_BASE}/v1/share/${token}/chunk/${i}/stream`;
    const resp = await axios.get(url, { responseType: 'arraybuffer' });

    const wireFrame = resp.data as ArrayBuffer;

    // Strip the 12-byte IV header
    const iv         = wireFrame.slice(0, 12);
    const ciphertext = wireFrame.slice(12);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) as any },
      dek,
      ciphertext
    );

    parts[i] = plaintext;
    onProgress(Math.round(((i + 1) / totalChunks) * 100));
  }

  return new Blob(parts, { type: mimeType ?? 'application/octet-stream' });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ShareDownloadPage({ params }: { params: { token: string } }) {
  const { token } = params;

  const [meta,     setMeta]     = useState<ShareMetadata | null>(null);
  const [metaErr,  setMetaErr]  = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const [phase,    setPhase]    = useState<
    'idle' | 'deriving' | 'downloading' | 'done' | 'error'
  >('idle');
  const [progress, setProgress] = useState(0);
  const [filename, setFilename] = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  // Load share metadata on mount
  useEffect(() => {
    if (!token) return;
    axios.get<ShareMetadata>(`${PUBLIC_BASE}/v1/share/${token}`, {
      headers: { 'Accept': 'application/json' },
    }).then(r => setMeta(r.data))
      .catch(err => {
        const status = err?.response?.status;
        if (status === 404) setMetaErr('This share link does not exist or has expired.');
        else if (status === 410) setMetaErr('This share link has reached its download limit or has expired.');
        else setMetaErr('Could not load share information. Please check the link.');
      });
  }, [token]);

  const handleDownload = useCallback(async () => {
    if (!meta || password.length < 1) return;

    setPhase('deriving');
    setError(null);
    setProgress(0);

    try {
      // 1. Derive shareKEK
      const shareKEK = await deriveShareKEK(password, meta.shareSaltB64);

      // 2. Unwrap DEK
      let dek: CryptoKey;
      try {
        dek = await unwrapShareDEK(meta.shareWrappedDek, meta.shareIvDek, shareKEK);
      } catch {
        throw new Error('Wrong password. The file could not be decrypted.');
      }

      // 3. Decrypt filename
      let plainFilename = 'downloaded-file';
      try {
        plainFilename = await decryptShareFilename(
          meta.shareEncFilename, meta.shareIvFilename, shareKEK
        );
      } catch { /* keep default name */ }

      setFilename(plainFilename);
      setPhase('downloading');

      // 4. Download + decrypt chunks
      const blob = await downloadAndDecryptChunks(
        token, meta.totalChunks, dek, meta.mimeType, setProgress
      );

      // 5. Trigger save
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = plainFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);

      setPhase('done');

    } catch (err: any) {
      setError(err?.message ?? 'Download failed. Please check your password and try again.');
      setPhase('error');
    }
  }, [meta, password, token]);

  const MimeIcon = getMimeIcon(meta?.mimeType ?? null);
  const isFolder = meta?.isFolder ?? false;

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
         style={{ background: 'radial-gradient(ellipse 120% 80% at 50% -20%, #1e0533 0%, #09090b 60%)' }}>

      {/* Animated background blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[30%] w-[600px] h-[600px] rounded-full
                        bg-violet-600/8 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[20%] w-[400px] h-[400px] rounded-full
                        bg-indigo-600/6 blur-[100px] animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl
                        shadow-2xl overflow-hidden">
          {/* Top gradient stripe */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-violet-500/60 to-transparent" />

          <div className="p-8">
            {/* Logo */}
            <div className="flex items-center justify-center gap-2.5 mb-8">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl
                              bg-gradient-to-br from-violet-600 to-indigo-700
                              shadow-lg shadow-violet-900/40">
                <Shield className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-bold text-white tracking-tight">ZK Vault</span>
            </div>

            <AnimatePresence mode="wait">

              {/* Loading state */}
              {!meta && !metaErr && (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-center py-8">
                  <Loader2 className="h-8 w-8 text-violet-400 animate-spin mx-auto mb-3" />
                  <p className="text-sm text-zinc-500">Loading share information…</p>
                </motion.div>
              )}

              {/* Error loading meta */}
              {metaErr && (
                <motion.div key="metaerr" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="text-center py-8">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full
                                  bg-red-500/15 border border-red-500/30 mx-auto mb-4">
                    <AlertCircle className="h-7 w-7 text-red-400" />
                  </div>
                  <p className="text-sm text-red-400 font-medium">{metaErr}</p>
                </motion.div>
              )}

              {/* Password entry */}
              {meta && !metaErr && phase === 'idle' && (
                <motion.div key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="space-y-5">
                  
                  {isFolder ? (
                    <div className="flex flex-col items-center gap-3 text-center mb-6">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl
                                      bg-white/[0.04] border border-white/[0.08]">
                        <Archive className="h-7 w-7 text-violet-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">Secure Encrypted Folder</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          This folder and its contents are securely encrypted.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-center mb-6">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl
                                      bg-white/[0.04] border border-white/[0.08]">
                        <MimeIcon className="h-7 w-7 text-violet-400" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">Secure Encrypted File</p>
                        <p className="text-xs text-zinc-500 mt-0.5">
                          {meta.totalChunks} chunk{meta.totalChunks !== 1 ? 's' : ''} •{' '}
                          {formatBytes(meta.totalSize)}
                          {meta.mimeType ? ` • ${meta.mimeType}` : ''}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ZK notice */}
                  <div className="flex items-start gap-2.5 p-3 rounded-xl
                                  bg-violet-500/8 border border-violet-500/20">
                    <Lock className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-violet-300/80 leading-relaxed">
                      {isFolder 
                        ? "This folder is end-to-end encrypted. Enter the password provided by the sender."
                        : "This file is end-to-end encrypted. Enter the password provided by the sender — it never leaves your device."}
                    </p>
                  </div>

                  {isFolder ? (
                    <div className="bg-[#030303] border border-white/10 rounded-xl p-4 text-left mt-4 shadow-inner">
                      <p className="text-xs font-semibold text-white mb-2 uppercase tracking-wider">
                        How to download this folder:
                      </p>
                      <p className="text-[11px] text-zinc-400 leading-relaxed mb-3">
                        Due to the size and encryption limits of modern web browsers, 
                        shared folders must be downloaded and decrypted locally using the official ZKFS CLI tool.
                      </p>
                      <code className="block w-full overflow-x-auto text-[10px] text-violet-300 font-mono bg-black/50 p-2 rounded border border-white/[0.05]">
                        python zkfs_cli.py download-folder {token}
                      </code>
                      <p className="text-[10px] text-zinc-500 mt-3">
                        When prompted, enter the Share Password provided by the sender.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Password input */}
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-400
                                          uppercase tracking-wider mb-1.5">
                          Share Password
                        </label>
                        <div className="relative">
                          <input
                            type={showPass ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && password && handleDownload()}
                            placeholder="Enter the password from the sender"
                            className="w-full px-4 py-3 pr-10 rounded-xl
                                       bg-black/50 border border-white/[0.09] text-white text-sm
                                       placeholder-zinc-600
                                       focus:outline-none focus:border-violet-500/60 focus:ring-1
                                       focus:ring-violet-500/20 transition-all"
                          />
                          <button type="button" onClick={() => setShowPass(p => !p)}
                            className="absolute right-3 top-1/2 -translate-y-1/2
                                       text-zinc-500 hover:text-zinc-300 transition-colors">
                            {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    </>
                  )}



                  {error && (
                    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2.5 p-3 rounded-xl
                                 bg-red-500/10 border border-red-500/25 text-red-400 text-xs">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </motion.div>
                  )}

                  {!isFolder && (
                    <button
                      onClick={handleDownload}
                      disabled={!password}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
                                 bg-gradient-to-r from-violet-600 to-violet-700
                                 hover:from-violet-500 hover:to-violet-600
                                 disabled:opacity-50 disabled:cursor-not-allowed
                                 text-white text-sm font-semibold
                                 shadow-lg shadow-violet-900/40 transition-all duration-200"
                    >
                      <Download className="h-4 w-4" />
                      Decrypt & Download
                    </button>
                  )}
                </motion.div>
              )}

              {/* Error state (retry) */}
              {meta && phase === 'error' && (
                <motion.div key="error" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="space-y-5">
                  <div className="flex items-start gap-2.5 p-4 rounded-xl
                                  bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
                    <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                  <button onClick={() => { setPhase('idle'); setError(null); }}
                    className="w-full py-3 rounded-xl border border-white/10 text-sm text-zinc-300
                               hover:bg-white/5 transition-colors">
                    Try Again
                  </button>
                </motion.div>
              )}

              {/* Progress */}
              {meta && (phase === 'deriving' || phase === 'downloading') && (
                <motion.div key="progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-center space-y-5 py-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full
                                  bg-violet-500/15 border border-violet-500/30 mx-auto">
                    <Loader2 className="h-7 w-7 text-violet-400 animate-spin" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white mb-1">
                      {phase === 'deriving' ? 'Deriving decryption key…' : 'Downloading & decrypting…'}
                    </p>
                    {phase === 'downloading' && (
                      <>
                        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden mt-3">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.3 }}
                          />
                        </div>
                        <p className="text-xs text-zinc-500 mt-2">{progress}%</p>
                      </>
                    )}
                  </div>
                </motion.div>
              )}

              {/* Done */}
              {phase === 'done' && (
                <motion.div key="done" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="text-center space-y-4 py-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full
                                  bg-emerald-500/15 border border-emerald-500/30 mx-auto">
                    <CheckCircle2 className="h-7 w-7 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">File downloaded!</p>
                    {filename && (
                      <p className="text-xs text-zinc-400 mt-1 break-all">{filename}</p>
                    )}
                    <p className="text-xs text-zinc-600 mt-2">
                      Check your browser's Downloads folder.
                    </p>
                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
          <div className="px-8 py-3 text-center">
            <p className="text-[11px] text-zinc-600">
              🔒 End-to-end encrypted · Zero-knowledge · ZK Vault
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
