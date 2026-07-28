import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Lock, Upload, X } from 'lucide-react';
import { useVaultStore } from '@/store/useVaultStore';

export function UploadOptionsModal() {
  const filesToUpload = useVaultStore(s => s.filesToUpload);
  const clearFilesToUpload = useVaultStore(s => s.clearFilesToUpload);
  const addUpload = useVaultStore(s => s.addUpload);

  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);

  if (filesToUpload.length === 0) return null;

  const handleStart = () => {
    filesToUpload.forEach((file: File) => {
      const localId = crypto.randomUUID();
      addUpload({
        localId,
        file,
        fileId: null,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        totalChunks: Math.max(1, Math.ceil(file.size / (5 * 1024 * 1024))),
        phase: 'queued',
        currentChunk: 0,
        overallProgress: 0,
        encryptSpeedMBs: 0,
        uploadSpeedMBs: 0,
        etaSeconds: null,
        bytesProcessed: 0,
        startedAt: null,
        paused: false,
        abortController: new AbortController(),
        error: null,
        customPassword: usePassword && password.trim() ? password : undefined,
      });
    });
    
    // Reset state and close modal
    setPassword('');
    setUsePassword(false);
    clearFilesToUpload();
  };

  const handleCancel = () => {
    setPassword('');
    setUsePassword(false);
    clearFilesToUpload();
  };

  return (
    <Dialog.Root open={true} onOpenChange={(open) => !open && handleCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in" />
        <Dialog.Content className="glass-3d fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md bg-zinc-900/90 z-50 overflow-hidden outline-none animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/[0.02]">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Upload className="h-5 w-5 text-violet-400" />
              Upload Options
            </h2>
            <button
              onClick={handleCancel}
              className="p-1 text-zinc-400 hover:text-white rounded-md transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            <div className="text-sm text-zinc-400">
              You are about to upload {filesToUpload.length} file(s).
            </div>

            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative flex items-center justify-center w-5 h-5">
                  <input
                    type="checkbox"
                    checked={usePassword}
                    onChange={(e) => setUsePassword(e.target.checked)}
                    className="peer appearance-none w-5 h-5 border-2 border-zinc-600 rounded bg-zinc-800/50 checked:bg-violet-500 checked:border-violet-500 transition-all"
                  />
                  <CheckIcon className="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" />
                </div>
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-zinc-400 group-hover:text-violet-400 transition-colors" />
                  <span className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">
                    Add Custom Password
                  </span>
                </div>
              </label>

              {usePassword && (
                <div className="pl-8 animate-in slide-in-from-top-2 fade-in">
                  <input
                    type="password"
                    placeholder="Enter custom password..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-all"
                    autoFocus
                  />
                  <p className="mt-2 text-xs text-zinc-500">
                    If set, this password will be required to download or share the file. Do not lose it!
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 bg-zinc-950/50 border-t border-white/5">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleStart}
              disabled={usePassword && !password.trim()}
              className="btn-gloss px-5 py-2 text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Upload
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 14 14" fill="none" {...props}>
      <path
        d="M3 8L6 11L11 3.5"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        stroke="currentColor"
      />
    </svg>
  );
}
