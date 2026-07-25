import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, File, Image, Film, FileText, Archive, Calendar, HardDrive, Hash, CheckCircle2, Clock } from 'lucide-react';
import { VaultFile } from '@/types/vault';

interface FileInfoDrawerProps {
  open: boolean;
  onClose: () => void;
  file: VaultFile | null;
}

function formatBytes(b: number): string {
  if (b < 1024)       return `${b} B`;
  if (b < 1024 ** 2)  return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)  return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
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

export function FileInfoDrawer({ open, onClose, file }: FileInfoDrawerProps) {
  if (!file) return null;

  const Icon = getMimeIcon(file.mimeType);

  return (
    <Dialog.Root open={open} onOpenChange={v => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity" />
        <Dialog.Content
          className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-[#09090b] border-l border-white/10
                     p-6 shadow-2xl focus:outline-none animate-in slide-in-from-right-full duration-300
                     flex flex-col h-full overflow-y-auto"
        >
          <div className="flex items-center justify-between mb-8">
            <Dialog.Title className="text-lg font-semibold text-white tracking-tight">
              File Details
            </Dialog.Title>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4">
              <Icon className="h-10 w-10 text-violet-400" />
            </div>
            <h3 className="text-base font-medium text-white text-center break-all w-full truncate px-4" title={file.filename || 'Encrypted File'}>
              {file.filename || <span className="italic text-zinc-500">Encrypted File</span>}
            </h3>
            <p className="text-sm text-zinc-500 mt-1">{file.mimeType || 'Unknown format'}</p>
          </div>

          <div className="space-y-6 flex-1">
            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-zinc-400">
                  <HardDrive className="w-4 h-4" />
                  <span>Size</span>
                </div>
                <span className="text-zinc-200 font-medium">{formatBytes(file.totalSize)}</span>
              </div>
              
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Hash className="w-4 h-4" />
                  <span>Chunks</span>
                </div>
                <span className="text-zinc-200 font-medium">{file.totalChunks}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Calendar className="w-4 h-4" />
                  <span>Created</span>
                </div>
                <span className="text-zinc-200 font-medium">
                  {new Date(file.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4">
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Security & Status</h4>
              
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Upload Status</span>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    {file.uploadStatus === 'COMPLETE' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5 text-amber-400" />}
                    <span className="font-medium capitalize">{file.uploadStatus.toLowerCase()}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Encryption</span>
                  <span className="text-zinc-200 font-medium text-xs font-mono bg-white/5 px-2 py-0.5 rounded">AES-256-GCM</span>
                </div>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
