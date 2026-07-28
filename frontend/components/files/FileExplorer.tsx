/**
 * components/files/FileExplorer.tsx
 *
 * Virtualized, Multi-Select File Explorer with full action wiring:
 * • Download  → useDownloader state machine + DownloadModal overlay
 * • Delete    → confirm dialog + filesApi.deleteFile + TanStack Query invalidation
 * • Preview   → sets previewFileId in Zustand (opens PreviewModal)
 * • Info      → inline toast (TODO: expand to drawer)
 * • Multi-select: Click, Cmd+Click, Shift+Click, Escape to clear
 */

'use client';

import React, { useRef, useCallback, useMemo, memo, useState } from 'react';
import { motion, AnimatePresence }          from 'framer-motion';
import { useVirtualizer }                   from '@tanstack/react-virtual';
import { useQuery, useQueryClient }         from '@tanstack/react-query';
import * as ContextMenu                     from '@radix-ui/react-context-menu';
import * as Dialog                          from '@radix-ui/react-dialog';
import {
  Lock, FileText, Image, Film, Archive, File,
  Download, Eye, Info, Trash2, Share2, Upload,
  MoreHorizontal, AlertTriangle, X, Loader2, FolderOpen, Users,
} from 'lucide-react';
import { useVaultStore, selectActiveUploads, selectSelectedIds } from '@/store/useVaultStore';
import { useDownloader }                    from '@/hooks/useDownloader';
import { filesApi }                         from '@/lib/api/files';
import { foldersApi, type Folder }          from '@/lib/api/folders';
import dynamic from 'next/dynamic';

const DownloadPanel = dynamic(() => import('@/components/files/DownloadPanel').then(mod => mod.DownloadPanel), { ssr: false });
const ShareModal = dynamic(() => import('@/components/files/ShareModal').then(mod => mod.ShareModal), { ssr: false });
const ShareUserModal = dynamic(() => import('@/components/files/ShareUserModal').then(mod => mod.ShareUserModal), { ssr: false });
const FileInfoDrawer = dynamic(() => import('@/components/files/FileInfoDrawer').then(mod => mod.FileInfoDrawer), { ssr: false });
import { EmptyVaultAnimation }              from '@/components/ui/EmptyVaultAnimation';
import { EmptyTrashAnimation }              from '@/components/ui/EmptyTrashAnimation';
import { TiltCard }                         from '@/components/ui/TiltCard';
import type { VaultFile }                   from '@/types/vault';
import apiClient                            from '@/lib/api/client';

// ── Constants ────────────────────────────────────────────────────────────────

const GRID_CARD_HEIGHT = 160;
const LIST_ROW_HEIGHT  = 52;
const GRID_COLS        = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024)       return `${b} B`;
  if (b < 1024 ** 2)  return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)  return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  const d    = new Date(iso);
  const now  = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7)   return `${diff}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getMimeIcon(mime: string | null) {
  if (!mime) return File;
  if (mime.startsWith('image/'))  return Image;
  if (mime.startsWith('video/'))  return Film;
  if (mime.startsWith('text/'))   return FileText;
  if (mime.includes('pdf'))       return FileText;
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gz')) return Archive;
  return File;
}

function getMimeColor(mime: string | null): string {
  if (!mime)                       return 'text-zinc-500';
  if (mime.startsWith('image/'))   return 'text-pink-400';
  if (mime.startsWith('video/'))   return 'text-blue-400';
  if (mime.startsWith('text/'))    return 'text-amber-400';
  if (mime.includes('pdf'))        return 'text-red-400';
  if (mime.includes('zip') || mime.includes('tar')) return 'text-orange-400';
  return 'text-zinc-400';
}

// ── Shimmer Skeletons ─────────────────────────────────────────────────────────

function ShimmerCard() {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] overflow-hidden animate-pulse">
      <div className="h-24 bg-white/[0.04]" />
      <div className="p-3 space-y-2">
        <div className="h-3 w-3/4 rounded bg-white/[0.06]" />
        <div className="h-2 w-1/2 rounded bg-white/[0.04]" />
      </div>
    </div>
  );
}

function ShimmerRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 animate-pulse">
      <div className="h-8 w-8 rounded-lg bg-white/[0.06]" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-1/3 rounded bg-white/[0.06]" />
        <div className="h-2 w-1/5 rounded bg-white/[0.04]" />
      </div>
      <div className="h-2 w-12 rounded bg-white/[0.04]" />
    </div>
  );
}

// ── Delete Confirm Dialog ─────────────────────────────────────────────────────

function DeleteConfirmDialog({
  open, fileName, onConfirm, onCancel, isDeleting,
}: {
  open:       boolean;
  fileName:   string;
  onConfirm:  () => void;
  onCancel:   () => void;
  isDeleting: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={v => !v && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-full max-w-sm rounded-2xl border border-white/10
                     bg-zinc-900 p-6 shadow-2xl focus:outline-none"
        >
          <div className="flex flex-col items-center text-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15 border border-red-500/30">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <Dialog.Title className="text-base font-semibold text-white">
                Permanently delete file?
              </Dialog.Title>
              <Dialog.Description className="text-sm text-zinc-400 mt-1.5">
                <span className="text-zinc-300 font-medium break-all">
                  {fileName || 'This encrypted file'}
                </span>{' '}
                and all its chunks will be permanently deleted from the server.
                This action cannot be undone.
              </Dialog.Description>
            </div>
            <div className="flex gap-3 w-full mt-1">
              <button
                onClick={onCancel}
                disabled={isDeleting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-sm text-zinc-300
                           hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={isDeleting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700
                           text-sm font-medium text-white transition-colors disabled:opacity-50
                           flex items-center justify-center gap-2"
              >
                {isDeleting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>
                  : 'Delete Forever'
                }
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Download Modal ────────────────────────────────────────────────────────────

function DownloadModal({
  fileId, displayName, kek, offline, isPasswordProtected, onClose,
}: {
  fileId:      string;
  displayName: string;
  kek:         CryptoKey | null;
  offline?:    boolean;
  isPasswordProtected?: boolean;
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
              {offline ? 'Download Offline Encrypted File' : 'Decrypt & Download'}
            </Dialog.Title>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/8 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!kek ? (
            <div className="text-center py-6 text-sm text-zinc-500">
              <Lock className="h-8 w-8 mx-auto mb-3 text-zinc-600" />
              <p>Session key not available.</p>
              <p className="mt-1 text-xs">Please re-authenticate to download files.</p>
            </div>
          ) : (
            <DownloadPanel
              fileId={fileId}
              kek={kek}
              displayName={displayName}
              offline={offline}
              isPasswordProtected={isPasswordProtected}
              onComplete={onClose}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Context Menu ─────────────────────────────────────────────────────────────

function FileContextMenu({
  children, file, onPreview, onDownload, onDownloadOffline, onShare, onShareUser, onInfo, onDelete, onRestore,
}: {
  children:   React.ReactNode;
  file:       VaultFile;
  onPreview:  (id: string) => void;
  onDownload: (id: string) => void;
  onDownloadOffline?: (id: string) => void;
  onShare:    (id: string) => void;
  onShareUser: (id: string) => void;
  onInfo:     (id: string) => void;
  onDelete:   (id: string) => void;
  onRestore?: (id: string) => void;
}) {
  const currentView = useVaultStore(s => s.currentView);
  
  const standardActions = [
    { icon: Eye,      label: 'Preview',           action: () => onPreview(file.id)  },
    { icon: Download, label: 'Decrypt & Download', action: () => onDownload(file.id) },
    { icon: Lock,     label: 'Download Encrypted (.zkfs)', action: () => onDownloadOffline?.(file.id) },
    { icon: Share2,   label: 'Secure Link Share',  action: () => onShare(file.id)   },
    { icon: Users,    label: 'Share with User',    action: () => onShareUser(file.id) },
    { icon: Info,     label: 'File Information',   action: () => onInfo(file.id)    },
  ];

  const trashActions = [
    { icon: FolderOpen, label: 'Restore File', action: () => onRestore?.(file.id) },
  ];

  const actions = currentView === 'trash' ? trashActions : standardActions;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 min-w-[180px] rounded-xl bg-zinc-900 border border-white/10
                     shadow-2xl shadow-black/60 p-1.5 overflow-hidden"
        >
          {actions.map(({ icon: Icon, label, action }) => (
            <ContextMenu.Item
              key={label}
              onSelect={action}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-300
                         hover:bg-white/8 hover:text-white cursor-pointer outline-none
                         transition-colors duration-100"
            >
              <Icon className="h-3.5 w-3.5 text-zinc-500" />
              {label}
            </ContextMenu.Item>
          ))}

          <ContextMenu.Separator className="my-1 border-t border-white/[0.06]" />

          <ContextMenu.Item
            onSelect={() => onDelete(file.id)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-400
                       hover:bg-red-500/15 cursor-pointer outline-none transition-colors duration-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {currentView === 'trash' ? 'Permanent Delete' : 'Move to Trash'}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// ── Folder Context Menu ──────────────────────────────────────────────────────

function FolderContextMenu({
  children, folder, onDelete, onRestore, onShare
}: {
  children:   React.ReactNode;
  folder:     Folder & { name?: string };
  onDelete:   (id: string) => void;
  onRestore?: (id: string) => void;
  onShare?:   (id: string) => void;
}) {
  const currentView = useVaultStore(s => s.currentView);
  
  if (currentView === 'trash') {
    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            className="z-50 min-w-[180px] rounded-xl bg-zinc-900 border border-white/10
                       shadow-2xl shadow-black/60 p-1.5 overflow-hidden"
          >
            <ContextMenu.Item
              onSelect={() => onRestore?.(folder.id)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-300
                         hover:bg-white/8 hover:text-white cursor-pointer outline-none transition-colors duration-100"
            >
              <FolderOpen className="h-3.5 w-3.5 text-zinc-500" />
              Restore Folder
            </ContextMenu.Item>
            <ContextMenu.Separator className="my-1 border-t border-white/[0.06]" />
            <ContextMenu.Item
              onSelect={() => onDelete(folder.id)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-400
                         hover:bg-red-500/15 cursor-pointer outline-none transition-colors duration-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Permanent Delete
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="z-50 min-w-[180px] rounded-xl bg-zinc-900 border border-white/10
                     shadow-2xl shadow-black/60 p-1.5 overflow-hidden"
        >
          {onShare && (
            <ContextMenu.Item
              onSelect={() => onShare(folder.id)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-300
                         hover:bg-white/8 hover:text-white cursor-pointer outline-none transition-colors duration-100"
            >
              <Share2 className="h-3.5 w-3.5 text-zinc-500" />
              Secure Share
            </ContextMenu.Item>
          )}

          <ContextMenu.Separator className="my-1 border-t border-white/[0.06]" />
          <ContextMenu.Item
            onSelect={() => onDelete(folder.id)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-400
                       hover:bg-red-500/15 cursor-pointer outline-none transition-colors duration-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Move to Trash
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

// ── Folder Card (Grid View) ───────────────────────────────────────────────────

const FolderCard = memo(({
  folder, onClick, onNavigate, onDelete, onRestore
}: {
  folder:     Folder & { name?: string };
  onClick:    (e: React.MouseEvent) => void;
  onNavigate: (id: string, name: string) => void;
  onDelete:   (id: string) => void;
  onRestore?: (id: string) => void;
}) => {
  return (
    <FolderContextMenu folder={folder} onDelete={onDelete} onRestore={onRestore}>
    <motion.div
      layout
      onClick={onClick}
      onDoubleClick={() => onNavigate(folder.id, folder.name || 'Encrypted folder')}
      whileHover={{ y: -8, rotateX: 5, rotateY: -5, scale: 1.05 }}
      whileTap={{ scale: 0.96, rotateX: 0, rotateY: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className={`glass-3d cursor-pointer select-none group border-white/[0.06]`}
    >
      <div className={`flex items-center justify-center h-24 relative bg-white/[0.02] overflow-hidden`}>
        {/* Glow behind the icon on hover */}
        <div className="absolute inset-0 bg-violet-500/20 opacity-0 group-hover:opacity-100 blur-2xl transition-opacity duration-500" />
        <div className={`relative flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10 transition-transform duration-300 group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(139,92,246,0.3)]`}>
          <FolderOpen className="h-6 w-6 text-violet-400 transition-colors duration-300 group-hover:text-violet-300" />
        </div>
      </div>
      <div className="p-3">
        <p className="text-xs font-medium text-zinc-200 truncate" title={folder.name ?? '…'}>
          {folder.name ?? <span className="italic text-zinc-500">Encrypted folder</span>}
        </p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[10px] text-zinc-600">Folder</span>
        </div>
      </div>
    </motion.div>
    </FolderContextMenu>
  );
});
FolderCard.displayName = 'FolderCard';

// ── Folder Row (List View) ────────────────────────────────────────────────────

const FolderRow = memo(({
  folder, onClick, onNavigate, onDelete, onRestore
}: {
  folder:     Folder & { name?: string };
  onClick:    (e: React.MouseEvent) => void;
  onNavigate: (id: string, name: string) => void;
  onDelete:   (id: string) => void;
  onRestore?: (id: string) => void;
}) => {
  return (
    <FolderContextMenu folder={folder} onDelete={onDelete} onRestore={onRestore}>
    <motion.div
      layout
      onClick={onClick}
      onDoubleClick={() => onNavigate(folder.id, folder.name || 'Encrypted folder')}
      className={`flex items-center gap-4 px-4 h-[52px] border-b border-white/[0.02] 
        cursor-pointer transition-colors hover:bg-white/[0.04]`}
    >
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10`}>
        <FolderOpen className="h-4 w-4 text-violet-400" />
      </div>
      <div className="flex-1 truncate">
        <span className="text-sm font-medium text-zinc-200">
          {folder.name ?? <span className="italic text-zinc-500">Encrypted folder</span>}
        </span>
      </div>
      <div className="w-24 shrink-0 text-xs text-zinc-500">Folder</div>
      <div className="w-24 shrink-0 text-xs text-zinc-500">-</div>
    </motion.div>
    </FolderContextMenu>
  );
});
FolderRow.displayName = 'FolderRow';

const FileCard = memo(({
  file, isSelected, onClick, onPreview, onDownload, onDownloadOffline, onShare, onShareUser, onInfo, onDelete, onRestore
}: {
  file:       VaultFile;
  isSelected: boolean;
  onClick:    (e: React.MouseEvent) => void;
  onPreview:  (id: string) => void;
  onDownload: (id: string) => void;
  onDownloadOffline?: (id: string) => void;
  onShare:    (id: string) => void;
  onShareUser: (id: string) => void;
  onInfo:     (id: string) => void;
  onDelete:   (id: string) => void;
  onRestore?: (id: string) => void;
}) => {
  const Icon  = getMimeIcon(file.mimeType);
  const color = getMimeColor(file.mimeType);

  return (
    <FileContextMenu file={file} onPreview={onPreview} onDownload={onDownload} onDownloadOffline={onDownloadOffline}
                     onShare={onShare} onShareUser={onShareUser} onInfo={onInfo} onDelete={onDelete} onRestore={onRestore}>
      <TiltCard maxTilt={15}>
      <motion.div
        layout
        onClick={onClick}
        whileHover={{ y: -8, rotateX: 5, rotateY: -5, scale: 1.05 }}
        whileTap={{ scale: 0.96, rotateX: 0, rotateY: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        className={`glass-3d cursor-pointer select-none group
          ${isSelected
            ? 'border-violet-500/60 shadow-[0_0_30px_rgba(139,92,246,0.3)] z-10'
            : 'border-white/[0.06]'
          }`}
      >
        {isSelected && (
          <div className="absolute top-2 right-2 z-10 h-5 w-5 rounded-full bg-violet-600
                          flex items-center justify-center">
            <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}

        <div className={`flex items-center justify-center h-24 relative overflow-hidden
          ${isSelected ? 'bg-violet-500/10' : 'bg-white/[0.02]'}`}>
          <div className="absolute inset-0 bg-violet-500/10 opacity-0 group-hover:opacity-100 blur-2xl transition-opacity duration-500" />
          {file.thumbnail ? (
            <img src={file.thumbnail} alt={file.filename} className="relative z-10 w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all duration-500 group-hover:scale-105" />
          ) : (
            <div className={`relative z-10 flex h-12 w-12 items-center justify-center rounded-xl
              bg-white/[0.04] transition-transform duration-300 group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(139,92,246,0.15)] ${color}`}>
              <Icon className="h-6 w-6 transition-transform duration-300" />
            </div>
          )}
          <div className="absolute bottom-2 left-2 flex items-center gap-1 px-1.5 py-0.5
                          rounded-md bg-black/40 border border-white/10">
            <Lock className="h-2.5 w-2.5 text-violet-400" />
            <span className="text-[9px] text-violet-400 font-medium">E2EE</span>
          </div>
        </div>

        <div className="p-3">
          <p className="text-xs font-medium text-zinc-200 truncate" title={file.filename ?? '…'}>
            {file.filename ?? (
              <span className="italic text-zinc-500">Encrypted filename</span>
            )}
          </p>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-zinc-600">{formatBytes(file.totalSize)}</span>
            <span className="text-[10px] text-zinc-600">{formatDate(file.createdAt)}</span>
          </div>
        </div>
      </motion.div>
      </TiltCard>
    </FileContextMenu>
  );
});
FileCard.displayName = 'FileCard';

// ── File Row (List View) ──────────────────────────────────────────────────────

const FileRow = memo(({
  file, isSelected, onClick, onPreview, onDownload, onDownloadOffline, onShare, onShareUser, onInfo, onDelete, onRestore
}: {
  file:       VaultFile;
  isSelected: boolean;
  onClick:    (e: React.MouseEvent) => void;
  onPreview:  (id: string) => void;
  onDownload: (id: string) => void;
  onDownloadOffline?: (id: string) => void;
  onShare:    (id: string) => void;
  onShareUser: (id: string) => void;
  onInfo:     (id: string) => void;
  onDelete:   (id: string) => void;
  onRestore?: (id: string) => void;
}) => {
  const Icon  = getMimeIcon(file.mimeType);
  const color = getMimeColor(file.mimeType);

  return (
    <FileContextMenu file={file} onPreview={onPreview} onDownload={onDownload} onDownloadOffline={onDownloadOffline}
                     onShare={onShare} onShareUser={onShareUser} onInfo={onInfo} onDelete={onDelete} onRestore={onRestore}>
      <motion.div
        layout
        onClick={onClick}
        className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none mb-1 rounded-xl
                    border border-white/[0.04] transition-all duration-300 group hover:-translate-y-[1px] hover:shadow-lg
          ${isSelected ? 'bg-violet-500/20 border-violet-500/50' : 'bg-white/[0.02] hover:bg-white/[0.06] hover:border-violet-500/30'}`}
      >
        {file.thumbnail ? (
          <img src={file.thumbnail} alt={file.filename} className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg object-cover bg-white/[0.04]" />
        ) : (
          <div className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-lg
                           bg-white/[0.04] ${color}`}>
            <Icon className="h-4 w-4" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Lock className="h-2.5 w-2.5 text-violet-400 shrink-0" />
            <p className="text-sm text-zinc-200 truncate" title={file.filename ?? '…'}>
              {file.filename ?? <span className="italic text-zinc-500 text-xs">Encrypted</span>}
            </p>
          </div>
          <p className="text-[11px] text-zinc-600 mt-0.5">
            {file.totalChunks} chunk{file.totalChunks !== 1 ? 's' : ''} • {file.mimeType ?? 'unknown'}
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-6 text-xs text-zinc-500 shrink-0">
          <span className="w-16 text-right tabular-nums">{formatBytes(file.totalSize)}</span>
          <span className="w-20 text-right">{formatDate(file.createdAt)}</span>
        </div>

        <button
          className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100
                     hover:bg-white/10 text-zinc-500 hover:text-zinc-300
                     transition-all duration-150"
          onClick={e => { e.stopPropagation(); onDownload(file.id); }}
          title="Decrypt & Download"
        >
          <Download className="h-4 w-4" />
        </button>
      </motion.div>
    </FileContextMenu>
  );
});
FileRow.displayName = 'FileRow';

// ── Main Explorer ─────────────────────────────────────────────────────────────

export function FileExplorer({ onUploadClick }: { onUploadClick: () => void }) {
  const scrollRef    = useRef<HTMLDivElement>(null);
  const lastClickRef = useRef<{ id: string; index: number } | null>(null);
  const queryClient  = useQueryClient();

  const {
    viewMode, selectedIds, filterQuery, mimeFilter, sortField, sortOrder, kek,
    currentView, currentFolderId, folderBreadcrumbs,
    selectFile, toggleFile, rangeSelect, clearSelection, setPreviewFileId,
    pushFolder, navigateToBreadcrumb,
  } = useVaultStore(s => ({
    viewMode:         s.viewMode,
    selectedIds:      s.selectedIds,
    filterQuery:      s.filterQuery,
    currentView:      s.currentView,
    mimeFilter:       s.mimeFilter,
    sortField:        s.sortField,
    sortOrder:        s.sortOrder,
    kek:              s.kek,
    selectFile:       s.selectFile,
    toggleFile:       s.toggleFile,
    rangeSelect:      s.rangeSelect,
    clearSelection:   s.clearSelection,
    setPreviewFileId: s.setPreviewFileId,
    currentFolderId:  s.currentFolderId,
    folderBreadcrumbs:s.folderBreadcrumbs,
    pushFolder:       s.pushFolder,
    navigateToBreadcrumb: s.navigateToBreadcrumb,
  }));

  // ── Local overlay state ────────────────────────────────────────────────────
  const [downloadTarget, setDownloadTarget] = useState<{ id: string; name: string, offline?: boolean, isPasswordProtected?: boolean } | null>(null);
  const [shareTarget,    setShareTarget]    = useState<{ id: string; name: string, isFolder?: boolean } | null>(null);
  const [shareUserTarget, setShareUserTarget] = useState<VaultFile | null>(null);
  const [deleteTargets,  setDeleteTargets]  = useState<{ id: string; name: string; isFolder?: boolean }[] | null>(null);
  const [infoTarget,     setInfoTarget]     = useState<VaultFile | null>(null);
  const [isDeleting,     setIsDeleting]     = useState(false);

  // ── Server data ────────────────────────────────────────────────────────────
  const { data: serverFiles = [], isLoading: isLoadingFiles } = useQuery<VaultFile[]>({
    queryKey: ['files', currentFolderId, currentView, !!kek],
    queryFn: async () => {
      const resp = await filesApi.listFiles(0, 200, currentFolderId || undefined, currentView === 'trash');
      const items = resp.content as VaultFile[];
      if (!kek) return items;

      const { decryptFilenameFromStorage, unwrapDEKForDownload } = await import('@/lib/crypto/cipher');
      return Promise.all(items.map(async f => {
        try {
          if (f.isPasswordProtected) {
            f.filename = await decryptFilenameFromStorage(f.filenameEncrypted, kek);
          } else {
            let keyToUse = kek;
            if (f.wrappedDek && f.ivWrappedDek) {
              try {
                keyToUse = await unwrapDEKForDownload(f.wrappedDek, f.ivWrappedDek, kek);
              } catch (e) {
                // Ignore, will fallback to kek
              }
            }
            try {
              f.filename = await decryptFilenameFromStorage(f.filenameEncrypted, keyToUse);
            } catch (e) {
              if (keyToUse !== kek) {
                // Try fallback to kek for backwards compat
                f.filename = await decryptFilenameFromStorage(f.filenameEncrypted, kek);
              } else {
                throw e;
              }
            }
          }
          if (f.thumbnailEncrypted) {
            f.thumbnail = await decryptFilenameFromStorage(f.thumbnailEncrypted, kek);
          }
        } catch (e) {
          f.filename = (f.wrappedDek && !f.isPasswordProtected) ? 'Shared File (Encrypted)' : 'Decryption error';
        }
        return f;
      }));
    },
    refetchInterval: 3000, // Real-time polling
  });

  const { data: serverFolders = [], isLoading: isLoadingFolders } = useQuery<(Folder & { name?: string })[]>({
    queryKey: ['folders', currentFolderId, currentView, !!kek],
    queryFn: async () => {
      const items = await foldersApi.listFolders(currentFolderId || undefined, currentView === 'trash');
      const folders = items as (Folder & { name?: string })[];
      if (!kek) return folders;

      const { decryptFilenameFromStorage } = await import('@/lib/crypto/cipher');
      return Promise.all(folders.map(async f => {
        try {
          // Folders use the same filename encryption logic but pass the iv inside the combined string
          // Wait, encryptFilenameForStorage handles both. Actually, folder has nameEncrypted (combined b64) and iv (from old schema?).
          // Let's assume folder.nameEncrypted is combined Base64 just like files.
          f.name = await decryptFilenameFromStorage(f.nameEncrypted, kek);
        } catch (e) {
          f.name = 'Decryption error';
        }
        return f;
      }));
    },
    refetchInterval: 3000,
  });

  const isLoading = isLoadingFiles || isLoadingFolders;

  // Optimistic uploads from store
  const pendingUploads = useVaultStore(selectActiveUploads);

  // ── Filtered / sorted list ──────────────────────────────────────────────────
  const items = useMemo(() => {
    let fList = [...serverFiles];
    let dList = [...serverFolders];
    
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      fList = fList.filter(f => f.filename?.toLowerCase().includes(q) || f.mimeType?.includes(q));
      dList = dList.filter(d => d.name?.toLowerCase().includes(q));
    }
    if (mimeFilter !== 'all') {
      const map: Record<string, string[]> = {
        images:    ['image/'],
        videos:    ['video/'],
        documents: ['application/pdf', 'text/', 'application/msword'],
        archives:  ['application/zip', 'application/x-tar', 'application/gzip'],
      };
      const prefixes = map[mimeFilter] ?? [];
      fList = fList.filter(f => prefixes.some(p => f.mimeType?.includes(p)));
      // Folders do not match mime filters unless "all"
      dList = [];
    }
    fList.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      else if (sortField === 'size') cmp = a.totalSize - b.totalSize;
      else if (sortField === 'name') cmp = (a.filename ?? '').localeCompare(b.filename ?? '');
      return sortOrder === 'desc' ? -cmp : cmp;
    });
    
    dList.sort((a, b) => {
      let cmp = (a.name ?? '').localeCompare(b.name ?? '');
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return [...dList, ...fList];
  }, [serverFiles, serverFolders, filterQuery, mimeFilter, sortField, sortOrder]);

  // ── Click selection ────────────────────────────────────────────────────────
  const handleItemClick = useCallback((item: any, index: number, e: React.MouseEvent) => {
    const { metaKey, ctrlKey, shiftKey } = e;
    if (metaKey || ctrlKey) {
      toggleFile(item.id);
    } else if (shiftKey && lastClickRef.current) {
      const start = Math.min(lastClickRef.current.index, index);
      const end   = Math.max(lastClickRef.current.index, index);
      rangeSelect(items.slice(start, end + 1).map(f => f.id));
    } else {
      selectFile(item.id);
    }
    lastClickRef.current = { id: item.id, index };
  }, [items, toggleFile, rangeSelect, selectFile]);

  // Escape clears selection
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') clearSelection(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [clearSelection]);

  // ── Global Command Listeners (Cmd+K palette) ───────────────────────────────
  React.useEffect(() => {
    const handleDownloadSelected = () => {
      if (selectedIds.size > 0) {
        const firstId = Array.from(selectedIds)[0];
        const file = serverFiles.find(f => f.id === firstId);
        if (file) setDownloadTarget({ id: firstId, name: file.filename || 'unknown', isPasswordProtected: file.isPasswordProtected });
      }
    };
    
    const handleDeleteSelected = () => {
      if (selectedIds.size > 0) {
        const targets: { id: string; name: string; isFolder?: boolean }[] = [];
        Array.from(selectedIds).forEach(id => {
          const file = serverFiles.find(f => f.id === id);
          if (file) targets.push({ id, name: file.filename || 'unknown', isFolder: false });
          const folder = serverFolders.find(f => f.id === id);
          if (folder) targets.push({ id, name: folder.name || 'unknown folder', isFolder: true });
        });
        if (targets.length > 0) setDeleteTargets(targets);
      }
    };

    window.addEventListener('cmd:download-selected', handleDownloadSelected as EventListener);
    window.addEventListener('cmd:delete-selected', handleDeleteSelected as EventListener);
    
    return () => {
      window.removeEventListener('cmd:download-selected', handleDownloadSelected as EventListener);
      window.removeEventListener('cmd:delete-selected', handleDeleteSelected as EventListener);
    };
  }, [selectedIds, serverFiles, serverFolders]);

  // ── Action handlers ────────────────────────────────────────────────────────

  const handlePreview = useCallback((id: string) => setPreviewFileId(id), [setPreviewFileId]);

  const handleDownload = useCallback((id: string) => {
    const file = serverFiles.find(f => f.id === id);
    setDownloadTarget({ id, name: file?.filename ?? 'Encrypted file', isPasswordProtected: file?.isPasswordProtected });
  }, [serverFiles]);

  const handleInfo = useCallback((id: string) => {
    const file = serverFiles.find(f => f.id === id);
    if (!file) return;
    setInfoTarget(file);
  }, [serverFiles]);

  const handleShare = (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const isFolder = 'nameEncrypted' in item;
    if (isFolder) {
      setShareTarget({ id, name: (item as any).name || 'Unknown Folder', isFolder: true });
    } else {
      setShareTarget({ id, name: (item as VaultFile).filename || 'Unknown File', isFolder: false });
    }
  };

  const handleShareUser = (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    setShareUserTarget(item as VaultFile);
  };

  const handleDelete = useCallback((id: string) => {
    const file = serverFiles.find(f => f.id === id);
    setDeleteTargets([{ id, name: file?.filename ?? 'Encrypted file', isFolder: false }]);
  }, [serverFiles]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTargets || deleteTargets.length === 0) return;
    setIsDeleting(true);
    
    try {
      await Promise.allSettled(deleteTargets.map(async (target) => {
        if (currentView === 'trash') {
          if (target.isFolder) await foldersApi.hardDeleteFolder(target.id);
          else await filesApi.hardDeleteFile(target.id);
        } else {
          if (target.isFolder) await foldersApi.deleteFolder(target.id);
          else await filesApi.deleteFile(target.id);
        }
      }));
      
      // Invalidate both caches to be safe for mixed selections
      await queryClient.invalidateQueries({ queryKey: ['folders'] });
      await queryClient.invalidateQueries({ queryKey: ['files'] });
      
      setDeleteTargets(null);
      clearSelection();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTargets, queryClient, currentView, clearSelection]);

  const handleRestore = useCallback(async (id: string) => {
    try {
      await filesApi.restoreFile(id);
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    } catch (err) {
      console.error('Restore failed:', err);
    }
  }, [queryClient]);

  const handleFolderRestore = useCallback(async (id: string) => {
    try {
      await foldersApi.restoreFolder(id);
      await queryClient.invalidateQueries({ queryKey: ['folders'] });
    } catch (err) {
      console.error('Folder restore failed:', err);
    }
  }, [queryClient]);

  const handleFolderDelete = useCallback((id: string) => {
    const folder = serverFolders.find(f => f.id === id);
    setDeleteTargets([{ id, name: folder?.name ?? 'Encrypted folder', isFolder: true }]);
  }, [serverFolders]);

  const handleNavigateFolder = useCallback((id: string, name: string) => {
    pushFolder(id, name);
    clearSelection();
  }, [pushFolder, clearSelection]);

  // ── Virtualizer ────────────────────────────────────────────────────────────
  const itemHeight   = viewMode === 'grid' ? GRID_CARD_HEIGHT : LIST_ROW_HEIGHT;
  const virtualItems = items.length > 0
    ? Math.ceil(viewMode === 'grid' ? items.length / GRID_COLS : items.length)
    : 0;

  const virtualizer = useVirtualizer({
    count:            virtualItems,
    getScrollElement: () => scrollRef.current,
    estimateSize:     () => itemHeight,
    overscan:         5,
  });

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-4">
        {viewMode === 'grid' ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {Array.from({ length: 15 }).map((_, i) => <ShimmerCard key={i} />)}
          </div>
        ) : (
          <div>{Array.from({ length: 12 }).map((_, i) => <ShimmerRow key={i} />)}</div>
        )}
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!items.length && !pendingUploads.length) {
    return (
      <div className="relative flex items-center justify-center h-full w-full overflow-hidden">
        {/* Animated Background Mesh */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <motion.div
            animate={{ scale: [1, 1.2, 1], opacity: [0.1, 0.2, 0.1] }}
            transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full bg-violet-600/20 blur-[80px]"
          />
        </div>

        <motion.div
          initial="hidden"
          animate="visible"
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { staggerChildren: 0.15 } }
          }}
          className="relative z-10 flex flex-col items-center text-center max-w-sm"
        >
          {/* 3D Animated Vector Vault / Trash */}
          <motion.div 
            variants={{
              hidden: { opacity: 0, scale: 0.8, y: 10 },
              visible: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', damping: 20 } }
            }}
            className="mb-6"
          >
            {currentView === 'trash' ? <EmptyTrashAnimation /> : <EmptyVaultAnimation />}
          </motion.div>

          <motion.h3 
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0 }
            }}
            className="text-lg font-bold font-outfit text-white tracking-tight mb-2"
          >
            {currentView === 'trash' ? 'Trash is empty' : 'Your vault is empty'}
          </motion.h3>

          <motion.p 
            variants={{
              hidden: { opacity: 0, y: 10 },
              visible: { opacity: 1, y: 0 }
            }}
            className="text-zinc-400 text-sm leading-relaxed mb-8"
          >
            {currentView === 'trash' 
              ? 'Files you delete will appear here before they are permanently erased.'
              : 'Securely upload your files. They will be encrypted locally before leaving this device.'}
          </motion.p>

          {currentView !== 'trash' && (
            <motion.button
              variants={{
                hidden: { opacity: 0, y: 10, scale: 0.95 },
                visible: { opacity: 1, y: 0, scale: 1 }
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onUploadClick}
              className="btn-gloss flex items-center gap-2 px-6 py-3"
            >
              <Upload className="h-4 w-4 drop-shadow-md" /> Upload First File
            </motion.button>
          )}
        </motion.div>
      </div>
    );
  }

  // ── Grid View ──────────────────────────────────────────────────────────────
  const renderGrid = () => (
    <div ref={scrollRef} className="h-full overflow-y-auto p-4">
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        <AnimatePresence>
          {items.map((item, i) => {
            const isFolder = 'nameEncrypted' in item;
            if (isFolder) {
              return (
                <FolderCard
                  key={item.id}
                  folder={item}
                  onClick={e => handleItemClick(item, i, e)}
                  onNavigate={handleNavigateFolder}
                  onDelete={handleFolderDelete}
                  onRestore={handleFolderRestore}
                />
              );
            }
            return (
              <FileCard
                key={item.id}
                file={item as VaultFile}
                isSelected={selectedIds.has(item.id)}
                onClick={e => handleItemClick(item, i, e)}
                onPreview={handlePreview}
                onDownload={handleDownload}
                onShare={handleShare}
                onShareUser={handleShareUser}
                onInfo={handleInfo}
                onDelete={handleDelete}
                onRestore={handleRestore}
              />
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );

  // ── List View (Virtualised) ────────────────────────────────────────────────
  const renderList = () => (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      {/* Column headers */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/[0.04]
                      text-[11px] text-zinc-600 font-medium sticky top-0 bg-[#09090b]/80
                      backdrop-blur-sm z-10">
        <div className="w-8 shrink-0" />
        <span className="flex-1">Name</span>
        <span className="hidden sm:block w-16 text-right">Size</span>
        <span className="hidden sm:block w-20 text-right">Modified</span>
        <div className="w-8 shrink-0" />
      </div>

      {/* Virtualised rows */}
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map(vRow => {
          const item = items[vRow.index];
          if (!item) return null;
          
          const isFolder = 'nameEncrypted' in item;
          
          return (
            <div
              key={vRow.index}
              style={{
                position: 'absolute',
                top:    `${vRow.start}px`,
                width:  '100%',
                height: `${vRow.size}px`,
              }}
            >
              {isFolder ? (
                <FolderRow
                  folder={item}
                  onClick={e => handleItemClick(item, vRow.index, e)}
                  onNavigate={handleNavigateFolder}
                  onDelete={handleFolderDelete}
                  onRestore={handleFolderRestore}
                />
              ) : (
                <FileRow
                  file={item as VaultFile}
                  isSelected={selectedIds.has(item.id)}
                  onClick={(e) => handleItemClick(item, vRow.index, e)}
                  onPreview={() => setPreviewFileId(item.id)}
                  onDownload={() => setDownloadTarget({ id: item.id, name: item.filename || 'unknown', isPasswordProtected: item.isPasswordProtected })}
                  onDownloadOffline={() => setDownloadTarget({ id: item.id, name: item.filename || 'unknown', offline: true, isPasswordProtected: item.isPasswordProtected })}
                  onShare={() => setShareTarget({ id: item.id, name: item.filename || 'unknown' })}
                  onShareUser={() => setShareUserTarget(item as VaultFile)}
                  onInfo={() => handleInfo(item.id)}
                  onDelete={() => setDeleteTargets([{ id: item.id, name: item.filename || 'unknown', isFolder: false }])}
                  onRestore={handleRestore}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Multi-select status bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 px-4 py-2 rounded-full bg-zinc-900 border
                       border-white/10 shadow-2xl text-sm text-zinc-300"
          >
            <span className="font-medium text-white">{selectedIds.size} selected</span>
            <button
              onClick={() => {
                const first = [...selectedIds][0];
                if (first) handleDownload(first);
              }}
              className="text-xs text-zinc-500 hover:text-white transition-colors"
            >
              Download
            </button>
            <button
              onClick={() => {
                const targets: { id: string; name: string; isFolder?: boolean }[] = [];
                Array.from(selectedIds).forEach(id => {
                  const file = serverFiles.find(f => f.id === id);
                  if (file) targets.push({ id, name: file.filename || 'unknown', isFolder: false });
                  const folder = serverFolders.find(f => f.id === id);
                  if (folder) targets.push({ id, name: folder.name || 'unknown folder', isFolder: true });
                });
                if (targets.length > 0) setDeleteTargets(targets);
              }}
              className="text-xs text-red-500 hover:text-red-400 transition-colors ml-2"
            >
              Delete
            </button>
            <button
              onClick={clearSelection}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              Clear
            </button>
          </motion.div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb Navigation */}
      <div className="px-4 py-2 border-b border-white/[0.04] bg-[#09090b]/80 backdrop-blur-sm z-10 flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={() => navigateToBreadcrumb(-1)}
          className={`hover:text-white transition-colors ${currentFolderId === null ? 'text-white font-medium' : 'text-zinc-500'}`}
        >
          Root
        </button>
        {folderBreadcrumbs.map((crumb, idx) => (
          <React.Fragment key={crumb.id}>
            <span className="text-zinc-600">/</span>
            <button
              onClick={() => navigateToBreadcrumb(idx)}
              className={`hover:text-white transition-colors ${idx === folderBreadcrumbs.length - 1 ? 'text-white font-medium' : 'text-zinc-500'}`}
            >
              {crumb.name}
            </button>
          </React.Fragment>
        ))}
      </div>

      <div className="flex-1 min-h-0 relative">
        {viewMode === 'grid' ? renderGrid() : renderList()}
      </div>

      {/* Download Modal */}
      {downloadTarget && (
        <DownloadModal
          fileId={downloadTarget.id} 
          displayName={downloadTarget.name}
          kek={kek}
          offline={downloadTarget.offline}
          isPasswordProtected={downloadTarget.isPasswordProtected}
          onClose={() => setDownloadTarget(null)} 
        />
      )}

      {/* Share Modal */}
      <ShareModal
        open={!!shareTarget}
        targetId={shareTarget?.id ?? ''}
        displayName={shareTarget?.name ?? ''}
        isFolder={shareTarget?.isFolder ?? false}
        onClose={() => setShareTarget(null)}
      />

      {/* Share with User Modal */}
      {shareUserTarget && (
        <ShareUserModal
          open={!!shareUserTarget}
          targetId={shareUserTarget.id}
          displayName={shareUserTarget.filename || 'Unknown File'}
          wrappedDek={shareUserTarget.wrappedDek}
          ivWrappedDek={shareUserTarget.ivWrappedDek}
          onClose={() => setShareUserTarget(null)}
        />
      )}

      {/* Delete Confirm */}
      <DeleteConfirmDialog
        open={!!deleteTargets}
        fileName={deleteTargets?.length === 1 ? deleteTargets[0].name : `${deleteTargets?.length} items`}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTargets(null)}
        isDeleting={isDeleting}
      />

      {/* File Info Drawer */}
      <FileInfoDrawer
        open={!!infoTarget}
        file={infoTarget}
        onClose={() => setInfoTarget(null)}
      />
    </div>
  );
}
