/**
 * app/dashboard/shared/page.tsx
 *
 * My Shared Links Page
 * Displays active zero-knowledge share links created by the user.
 */

'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Share2, Trash2, Copy, Check, ExternalLink, Shield, AlertTriangle,
  Loader2, File, FileText, Image, Film, Archive, Clock, Download
} from 'lucide-react';
import { shareApi, type ShareMetadata } from '@/lib/api/share';
import { useVaultStore } from '@/store/useVaultStore';

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

export default function SharedLinksPage() {
  const [shares, setShares] = useState<ShareMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  const fetchShares = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await shareApi.listMyShares();
      setShares(data);
    } catch (err: any) {
      console.error('Failed to load shares:', err);
      setError(err.message || 'Failed to load shared links');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchShares();
  }, []);

  const handleCopy = (token: string) => {
    const url = `${window.location.origin}/share/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleRevoke = async (token: string) => {
    if (!confirm('Are you sure you want to revoke this share link? It will become permanently inaccessible.')) {
      return;
    }
    setRevokingToken(token);
    try {
      await shareApi.revokeShare(token);
      setShares(s => s.filter(x => x.shareToken !== token));
    } catch (err: any) {
      alert(err.message || 'Failed to revoke share');
    } finally {
      setRevokingToken(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2.5">
            <Share2 className="h-5 w-5 text-violet-400" />
            Shared Links
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage your active end-to-end encrypted file shares
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
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500 space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
          <p className="text-sm">Loading shared links...</p>
        </div>
      ) : shares.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-12 text-center"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/10 border border-violet-500/20 mx-auto mb-4">
            <Share2 className="h-8 w-8 text-violet-400" />
          </div>
          <h3 className="text-base font-semibold text-white">No active shared links</h3>
          <p className="text-sm text-zinc-500 mt-1 max-w-sm mx-auto">
            When you create a secure link to share files or folders, it will appear here so you can track downloads or revoke access.
          </p>
        </motion.div>
      ) : (
        <div className="grid gap-4">
          <AnimatePresence>
            {shares.map((share) => {
              const Icon = getMimeIcon(share.mimeType);
              const isCopied = copiedToken === share.shareToken;
              const isRevoking = revokingToken === share.shareToken;

              return (
                <motion.div
                  key={share.shareToken}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="rounded-2xl border border-white/[0.08] bg-zinc-900/60 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-white/[0.12] transition-colors"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-400">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-white">
                          {share.isFolder ? 'Encrypted Folder Share' : 'Encrypted File Share'}
                        </h4>
                        <span className="text-[10px] bg-white/[0.06] text-zinc-400 px-2 py-0.5 rounded-full font-mono">
                          {share.shareToken.slice(0, 8)}...
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 mt-1.5">
                        <span>{formatBytes(share.totalSize)}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Download className="h-3 w-3" />
                          {share.downloadCount} {share.maxDownloads ? `/ ${share.maxDownloads}` : ''} downloads
                        </span>
                        {share.expiresAt && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1 text-amber-400/80">
                              <Clock className="h-3 w-3" />
                              Expires {new Date(share.expiresAt).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    <button
                      onClick={() => handleCopy(share.shareToken)}
                      className="btn-2d-glass px-3 py-2 text-xs flex items-center gap-1.5"
                      title="Copy Share URL"
                    >
                      {isCopied ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                          <span className="text-emerald-400 font-medium">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5 text-zinc-400" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>
                    <a
                      href={`/share/${share.shareToken}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-2 rounded-xl bg-white/5 border border-white/10 text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                      title="Open Share Link"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <button
                      onClick={() => handleRevoke(share.shareToken)}
                      disabled={isRevoking}
                      className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      title="Revoke Share"
                    >
                      {isRevoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
