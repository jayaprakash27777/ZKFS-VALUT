import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, FolderPlus, Loader2 } from 'lucide-react';
import { foldersApi } from '@/lib/api/folders';
import { useVaultStore } from '@/store/useVaultStore';
import { encryptFilenameForStorage } from '@/lib/crypto/cipher';
import { bufferToBase64 } from '@/lib/crypto/index';
import { useQueryClient } from '@tanstack/react-query';

export function CreateFolderModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [folderName, setFolderName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { currentFolderId, kek } = useVaultStore();
  const queryClient = useQueryClient();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderName.trim() || !kek || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const nameEncrypted = await encryptFilenameForStorage(folderName, kek);
      
      // The backend Folder entity requires a 12-byte Base64 IV for legacy reasons, 
      // even though the IV is actually prepended to nameEncrypted for decryption.
      // We generate a dummy IV to satisfy the validation.
      const dummyIv = new Uint8Array(12);
      crypto.getRandomValues(dummyIv);
      const ivB64 = bufferToBase64(dummyIv);

      await foldersApi.createFolder({
        nameEncrypted,
        iv: ivB64,
        parentId: currentFolderId || null
      });
      
      await queryClient.invalidateQueries({ queryKey: ['folders'] });
      setFolderName('');
      onClose();
    } catch (err) {
      console.error('Failed to create folder:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     w-full max-w-sm rounded-2xl border border-white/10
                     bg-zinc-900 p-6 shadow-2xl focus:outline-none"
        >
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-base font-semibold text-white flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-violet-400" />
              Create Folder
            </Dialog.Title>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/8 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <form onSubmit={handleCreate}>
            <div className="mb-5">
              <label htmlFor="folderName" className="block text-sm font-medium text-zinc-300 mb-2">
                Folder Name
              </label>
              <input
                id="folderName"
                type="text"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="e.g. Work Documents"
                className="w-full px-4 py-2.5 rounded-xl bg-black/40 border border-white/10
                           text-white placeholder:text-zinc-600 focus:outline-none focus:border-violet-500
                           focus:ring-1 focus:ring-violet-500 transition-all"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-sm font-medium
                           text-zinc-300 hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!folderName.trim() || isSubmitting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700
                           text-sm font-medium text-white transition-colors disabled:opacity-50
                           flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Create'
                )}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
