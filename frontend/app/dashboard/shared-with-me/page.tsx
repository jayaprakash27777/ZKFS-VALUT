'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Download, File, FileText, Image, Film, Archive, AlertTriangle, Loader2
} from 'lucide-react';
import { filesApi } from '@/lib/api/files';
import { useVaultStore } from '@/store/useVaultStore';
import { DownloadPanel } from '@/components/files/DownloadPanel';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Lock } from 'lucide-react';

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

// ── Download Modal ────────────────────────────────────────────────────────────

function SharedDownloadModal({
  fileId, displayName, kek, wrappedDek, ivWrappedDek, onClose, privateKey
}: {
  fileId:      string;
  displayName: string;
  kek:         CryptoKey | null;
  wrappedDek:  string;
  ivWrappedDek:string;
  privateKey:  CryptoKey | null;
  onClose:     () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={v => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-full max-w-lg rounded-2xl border border-white/10
                     bg-zinc-900 p-6 shadow-2xl focus:outline-none"
        >
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-sm font-semibold text-white">
              Decrypt & Download Shared File
            </Dialog.Title>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/8 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!kek || !privateKey ? (
            <div className="text-center py-6 text-sm text-zinc-500">
              <Lock className="h-8 w-8 mx-auto mb-3 text-zinc-600" />
              <p>Keys not available.</p>
              <p className="mt-1 text-xs">Please re-authenticate to download files.</p>
            </div>
          ) : (
            <DownloadPanel
              fileId={fileId}
              kek={kek} // We use KEK to decrypt the filename inside DownloadPanel. Wait, the filename is encrypted with original DEK? Actually, the DownloadPanel will need the unwrapped DEK. For now, let's just pass the KEK and let DownloadPanel fetch it.
              // Actually, DownloadPanel fetches the file metadata which has wrappedDek encrypted with KEK?
              // No, for shared files, the wrappedDek returned by GET /v1/files/shared is encrypted with target's Public Key!
              // So DownloadPanel won't work out of the box because it tries to unwrap with KEK (AES).
              // Let's pass a custom dekOverride or we handle download here.
              // This is a bit complex, let's just do a placeholder or custom download.
              displayName={displayName}
              onComplete={onClose}
              isSharedWithMe={true}
              sharedWrappedDek={wrappedDek}
              sharedIv={ivWrappedDek}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function SharedWithMePage() {
  const [shares, setShares] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [downloadTarget, setDownloadTarget] = useState<any | null>(null);

  const kek = useVaultStore(s => s.kek);
  const privateKey = useVaultStore(s => s.privateKey);

  const fetchShares = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await filesApi.getSharedFiles();
      setShares(data);
    } catch (err: any) {
      console.error('Failed to load shared files:', err);
      setError(err.message || 'Failed to load shared files');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchShares();
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
            <Users className="h-5 w-5 text-indigo-400" />
            Shared With Me
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Files securely shared with you by other users.
          </p>
        </div>
        <button
          onClick={fetchShares}
          disabled={isLoading}
          className="btn-2d-glass px-4 py-2 text-xs flex items-center gap-2"
        >
          {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-sm text-red-300 flex-1">{error}</div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
        </div>
      ) : shares.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 border border-dashed border-white/[0.05] rounded-2xl bg-white/[0.01]">
          <div className="h-12 w-12 rounded-full bg-white/[0.02] flex items-center justify-center mb-3">
            <Users className="h-5 w-5 text-zinc-600" />
          </div>
          <h3 className="text-sm font-medium text-white">No shared files yet</h3>
          <p className="text-xs text-zinc-500 mt-1">Files shared with you will appear here.</p>
        </div>
      ) : (
        <div className="bg-black/20 border border-white/[0.06] rounded-2xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="px-6 py-4 text-xs font-medium text-zinc-500 w-[50%]">File</th>
                <th className="px-6 py-4 text-xs font-medium text-zinc-500 w-[15%]">Size</th>
                <th className="px-6 py-4 text-xs font-medium text-zinc-500 w-[20%]">Shared By</th>
                <th className="px-6 py-4 text-xs font-medium text-zinc-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {shares.map((share) => {
                  const Icon = getMimeIcon(share.file.mimeType);
                  return (
                    <motion.tr
                      key={share.id}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors group"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded bg-white/[0.04] flex items-center justify-center flex-shrink-0">
                            <Icon className="h-4 w-4 text-zinc-400" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-zinc-200 truncate">
                              Encrypted File
                            </div>
                            <div className="text-[10px] text-zinc-600 flex items-center gap-1.5 mt-0.5">
                              <Lock className="h-2.5 w-2.5" /> E2EE
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-zinc-400">{formatBytes(share.file.totalSize)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-zinc-400">{share.sharedByEmail}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setDownloadTarget(share)}
                          className="p-2 text-zinc-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors inline-flex items-center gap-1.5"
                          title="Decrypt & Download"
                        >
                          <Download className="h-4 w-4" />
                          <span className="text-xs font-medium">Download</span>
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      {downloadTarget && (
        <SharedDownloadModal
          fileId={downloadTarget.file.id}
          displayName={"Encrypted File"}
          kek={kek}
          privateKey={privateKey}
          wrappedDek={downloadTarget.wrappedDek}
          ivWrappedDek={downloadTarget.file.ivWrappedDek}
          onClose={() => setDownloadTarget(null)}
        />
      )}
    </div>
  );
}
