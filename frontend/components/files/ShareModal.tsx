/**
 * components/files/ShareModal.tsx
 *
 * Zero-Knowledge Secure Share Modal
 * ══════════════════════════════════
 *
 * Cryptographic protocol (entirely client-side):
 *   1. User enters a share password + optional settings
 *   2. Frontend generates a random Argon2id salt (16 bytes)
 *   3. Frontend derives shareKEK = Argon2id(password, salt)
 *   4. Frontend fetches file metadata → unwraps DEK with session KEK
 *   5. Frontend re-wraps DEK with shareKEK  → shareWrappedDek
 *   6. Frontend encrypts plaintext filename  → shareEncFilename
 *   7. POST /v1/share → server returns shareToken
 *   8. Share URL shown to user: /share/{shareToken}
 *
 * The share password never reaches the server.
 */

'use client';

import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock, Shield, Link2, Copy, Check, X, Loader2,
  Eye, EyeOff, Clock, Download, AlertCircle, Share2,
} from 'lucide-react';
import { useVaultStore } from '@/store/useVaultStore';
import { shareApi }      from '@/lib/api/share';
import apiClient         from '@/lib/api/client';
import {
  generateArgon2Salt,
  deriveKEKBytes,
  importKEKAsCryptoKey,
} from '@/lib/crypto/argon2';
import { bufferToBase64, base64ToBuffer } from '@/lib/crypto/index';
import {
  encryptFilenameForStorage,
  decryptFilenameFromStorage,
  unwrapDEKForDownload,
} from '@/lib/crypto/cipher';
import { wrapDEK } from '@/lib/crypto/keys';

// ── Types ────────────────────────────────────────────────────────────────────

interface ShareModalProps {
  open:        boolean;
  onClose:     () => void;
  targetId:    string;
  displayName: string;  // decrypted filename/foldername for display
  isFolder?:   boolean;
}


// ── Password strength ────────────────────────────────────────────────────────

function strengthScore(pw: string): number {
  let s = 0;
  if (pw.length >= 8)          s++;
  if (pw.length >= 14)         s++;
  if (/[A-Z]/.test(pw))        s++;
  if (/\d/.test(pw))           s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
const STRENGTH_COLORS = ['', '#ef4444', '#f59e0b', '#a78bfa', '#10b981', '#06b6d4'];

// ── Share Link Display ────────────────────────────────────────────────────────

function ShareLinkCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [url]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Success header */}
      <div className="flex flex-col items-center text-center gap-3 py-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-full
                        bg-emerald-500/15 border border-emerald-500/30">
          <Shield className="h-7 w-7 text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Share link created!</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Anyone with this link AND your password can download the file.
          </p>
        </div>
      </div>

      {/* Link box */}
      <div className="flex items-center gap-2 p-3 rounded-xl
                      bg-black/40 border border-white/10">
        <Link2 className="h-4 w-4 text-zinc-500 shrink-0" />
        <span className="flex-1 text-xs text-zinc-300 truncate font-mono">{url}</span>
        <button
          onClick={copy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                     btn-gloss"
        >
          {copied
            ? <><Check className="h-3 w-3" /> Copied!</>
            : <><Copy className="h-3 w-3" /> Copy</>
          }
        </button>
      </div>

      {/* Security notice */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl
                      bg-amber-500/8 border border-amber-500/20">
        <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-300/80 leading-relaxed">
          Share your password separately from this link (e.g. via a different channel).
          Never send them together — that defeats the security.
        </p>
      </div>
    </motion.div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export function ShareModal({ open, onClose, targetId, displayName, isFolder = false }: ShareModalProps) {
  const kek = useVaultStore(s => s.kek);

  const [password,    setPassword]    = useState('');
  const [showPass,    setShowPass]    = useState(false);
  const [expiresHours, setExpiresHours] = useState<number>(24);
  const [maxDownloads, setMaxDownloads] = useState<number>(0);

  const [status,   setStatus]   = useState<'idle' | 'creating' | 'done' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState<string>('');
  const [error,    setError]    = useState<string | null>(null);

  const score  = strengthScore(password);
  const isPending = status === 'creating';

  const reset = useCallback(() => {
    setPassword('');
    setShowPass(false);
    setExpiresHours(24);
    setMaxDownloads(0);
    setStatus('idle');
    setShareUrl('');
    setError(null);
  }, []);

  const handleClose = () => { reset(); onClose(); };

  const handleCreate = useCallback(async () => {
    if (!kek) { setError('Session key unavailable. Please re-login.'); return; }
    if (password.length < 6) { setError('Share password must be at least 6 characters.'); return; }

    setStatus('creating');
    setError(null);

    try {


      // ── 4. Generate a new random Argon2id salt for this share
      const shareSalt = generateArgon2Salt();
      const shareSaltB64 = bufferToBase64(shareSalt);

      // ── 5. Derive shareKEK from the share password + new salt
      const shareKEKBytes = await deriveKEKBytes(password, shareSalt);
      const shareKEK = await importKEKAsCryptoKey(shareKEKBytes);

      // ── 3. Handle DEK wrapping
      let shareWrappedDekB64 = "";
      let shareIvDekB64 = "";
      
      if (!isFolder) {
          const metaResp = await apiClient.get<{ wrappedDek: string, ivWrappedDek: string }>(`/v1/files/${targetId}`);
          const fileMeta = metaResp.data;

          const dek = await unwrapDEKForDownload(
            fileMeta.wrappedDek,
            fileMeta.ivWrappedDek,
            kek
          );

          const { wrappedDekB64, ivB64 } = await wrapDEK(dek, shareKEK);
          shareWrappedDekB64 = wrappedDekB64;
          shareIvDekB64      = ivB64;
      } else {
          // For folders, we generate a dummy DEK as they don't have one in the vault
          const dummyDek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
          const { wrappedDekB64, ivB64 } = await wrapDEK(dummyDek, shareKEK);
          shareWrappedDekB64 = wrappedDekB64;
          shareIvDekB64      = ivB64;
      }

      // ── 4. Encrypt the filename/foldername with the shareKEK
      const combinedFilenameB64 = await encryptFilenameForStorage(displayName, shareKEK);
      const filenamePayload = new Uint8Array(base64ToBuffer(combinedFilenameB64));
      const shareIvFilename = bufferToBase64(filenamePayload.slice(0, 12));
      const shareEncFilename = bufferToBase64(filenamePayload.slice(12));

      // ── 5. Create the share on the server
      const response = await shareApi.createShare({
        fileId: isFolder ? undefined : targetId,
        folderId: isFolder ? targetId : undefined,
        shareSaltB64,
        shareWrappedDek: shareWrappedDekB64,
        shareIvDek: shareIvDekB64,
        shareEncFilename,
        shareIvFilename,
        expiresHours: expiresHours || undefined,
        maxDownloads: maxDownloads || undefined,
      });

      // ── 9. Build the full share URL
      const origin = window.location.origin;
      setShareUrl(`${origin}/share/${response.shareToken}`);
      setStatus('done');

    } catch (err: any) {
      setError(err?.message ?? 'Failed to create share. Please try again.');
      setStatus('error');
    }
  }, [kek, password, targetId, isFolder, expiresHours, maxDownloads, displayName]);


  return (
    <Dialog.Root open={open} onOpenChange={v => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm" />
        <Dialog.Content
          className="glass-3d fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-full max-w-md bg-zinc-900/90 focus:outline-none"
        >
          {/* Top accent stripe */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-violet-500/60 to-transparent" />

          <div className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl
                                bg-violet-600/20 border border-violet-500/30">
                  <Share2 className="h-4 w-4 text-violet-400" />
                </div>
                <div>
                  <Dialog.Title className="text-sm font-semibold text-white">
                    Secure Share
                  </Dialog.Title>
                  <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-[220px]">
                    {displayName}
                  </p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-zinc-500 hover:text-white
                           hover:bg-white/8 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <AnimatePresence mode="wait">
              {status === 'done' ? (
                <ShareLinkCard key="done" url={shareUrl} />
              ) : (
                <motion.div
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {/* ZK info */}
                  <div className="flex items-start gap-2.5 p-3 rounded-xl
                                  bg-violet-500/8 border border-violet-500/20">
                    <Lock className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-violet-300/80 leading-relaxed">
                      The file stays encrypted. Recipients need this password to decrypt —
                      the server never sees it.
                    </p>
                  </div>

                  {/* Share password */}
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
                        placeholder="Strong password for recipients"
                        disabled={isPending}
                        className="w-full px-4 py-2.5 pr-10 rounded-xl
                                   bg-black/50 border border-white/[0.09] text-white text-sm
                                   placeholder-zinc-600
                                   focus:outline-none focus:border-violet-500/60 focus:ring-1
                                   focus:ring-violet-500/20 transition-all disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(p => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2
                                   text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Strength bar */}
                    {password && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex gap-1 flex-1">
                          {[1,2,3,4,5].map(i => (
                            <div
                              key={i}
                              className="h-1 flex-1 rounded-full transition-all duration-300"
                              style={{ backgroundColor: i <= score ? STRENGTH_COLORS[score] : '#27272a' }}
                            />
                          ))}
                        </div>
                        <span
                          className="text-[10px] font-medium w-16 text-right"
                          style={{ color: STRENGTH_COLORS[score] }}
                        >
                          {STRENGTH_LABELS[score]}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Expiry + Download limit */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400
                                        uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Expires
                      </label>
                      <select
                        value={expiresHours}
                        onChange={e => setExpiresHours(Number(e.target.value))}
                        disabled={isPending}
                        className="w-full px-3 py-2.5 rounded-xl bg-black/50 border border-white/[0.09]
                                   text-white text-sm focus:outline-none focus:border-violet-500/60
                                   transition-all disabled:opacity-50 appearance-none"
                      >
                        <option value={0}>Never</option>
                        <option value={1}>1 hour</option>
                        <option value={24}>24 hours</option>
                        <option value={72}>3 days</option>
                        <option value={168}>7 days</option>
                        <option value={720}>30 days</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400
                                        uppercase tracking-wider mb-1.5 flex items-center gap-1">
                        <Download className="h-3 w-3" /> Max downloads
                      </label>
                      <select
                        value={maxDownloads}
                        onChange={e => setMaxDownloads(Number(e.target.value))}
                        disabled={isPending}
                        className="w-full px-3 py-2.5 rounded-xl bg-black/50 border border-white/[0.09]
                                   text-white text-sm focus:outline-none focus:border-violet-500/60
                                   transition-all disabled:opacity-50 appearance-none"
                      >
                        <option value={0}>Unlimited</option>
                        <option value={1}>1</option>
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                  </div>

                  {/* Error */}
                  {(status === 'error' || error) && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-2.5 p-3 rounded-xl
                                 bg-red-500/10 border border-red-500/25 text-red-400 text-xs"
                    >
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </motion.div>
                  )}

                  {/* Create button */}
                  <button
                    onClick={handleCreate}
                    disabled={isPending || password.length < 6}
                    className="btn-gloss w-full flex items-center justify-center gap-2 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Creating secure link…</>
                    ) : (
                      <><Share2 className="h-4 w-4" /> Generate Share Link</>
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.05] to-transparent" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
