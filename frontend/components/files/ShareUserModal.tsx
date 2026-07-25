'use client';

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, X, Loader2, Check, Share2, Search, AlertCircle } from 'lucide-react';
import { useVaultStore } from '@/store/useVaultStore';
import { filesApi }      from '@/lib/api/files';
import { usersApi }      from '@/lib/api/users';
import { unwrapDEKForDownload } from '@/lib/crypto/cipher';
import { importPublicKey, encryptWithPublicKey } from '@/lib/crypto/asymmetric';

interface ShareUserModalProps {
  open:        boolean;
  onClose:     () => void;
  targetId:    string;
  displayName: string;
  wrappedDek:  string;
  ivWrappedDek:string;
}

export function ShareUserModal({
  open, onClose, targetId, displayName, wrappedDek, ivWrappedDek
}: ShareUserModalProps) {
  const [email, setEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kek = useVaultStore(s => s.kek);

  const handleShare = async () => {
    if (!email.trim() || !kek) return;
    setIsSearching(true);
    setError(null);
    setSuccess(false);

    try {
      // 1. Fetch user's public key
      const { publicKey } = await usersApi.getPublicKey(email);
      
      // 2. Unwrap DEK using our KEK
      setIsSharing(true);
      const dekKey = await unwrapDEKForDownload(wrappedDek, ivWrappedDek, kek);
      const dekBuffer = await window.crypto.subtle.exportKey('raw', dekKey);
      const dekBytes = new Uint8Array(dekBuffer);
      
      // 3. Encrypt DEK with target's Public Key
      const importedPubKey = await importPublicKey(publicKey);
      const newWrappedDek = await encryptWithPublicKey(importedPubKey, dekBytes);
      
      // 4. Send to server
      await filesApi.shareFileWithUser(targetId, email, newWrappedDek);
      setSuccess(true);
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setError("User not found or has not setup sharing keys.");
      } else {
        setError(err.message || "Failed to share file");
      }
    } finally {
      setIsSearching(false);
      setIsSharing(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={v => !v && onClose()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="fixed z-[60] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md"
              >
                <div className="bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
                  {/* Header */}
                  <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-zinc-900/50">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        <Users className="h-5 w-5" />
                      </div>
                      <div>
                        <Dialog.Title className="text-base font-medium text-white">Share with User</Dialog.Title>
                        <p className="text-xs text-zinc-400 mt-0.5 truncate max-w-[200px]">
                          {displayName || 'Encrypted File'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={onClose}
                      className="text-zinc-500 hover:text-white transition-colors p-2 -mr-2 rounded-lg hover:bg-white/5"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Body */}
                  <div className="p-6 flex flex-col gap-5">
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-300 ml-1">
                          User's Email Address
                        </label>
                        <div className="relative">
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="bob@example.com"
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 pl-11
                                     text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50"
                          />
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                        </div>
                      </div>

                      {error && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <p>{error}</p>
                        </div>
                      )}
                    </div>
                    
                    <button
                      onClick={handleShare}
                      disabled={isSearching || isSharing || !email.trim() || success}
                      className="w-full relative overflow-hidden group rounded-xl bg-indigo-500 px-4 py-3 
                               text-sm font-medium text-white shadow-[0_0_20px_rgba(99,102,241,0.3)]
                               hover:shadow-[0_0_25px_rgba(99,102,241,0.5)] hover:bg-indigo-400
                               transition-all active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2"
                    >
                      {success ? (
                        <><Check className="h-4 w-4" /> Shared successfully</>
                      ) : isSharing ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Encrypting...</>
                      ) : isSearching ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Searching...</>
                      ) : (
                        <><Share2 className="h-4 w-4" /> Share File</>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
