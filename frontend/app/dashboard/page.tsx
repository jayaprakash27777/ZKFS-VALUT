/**
 * app/dashboard/page.tsx
 *
 * ZK Vault — Main Dashboard Page
 */

'use client';

import React, { useRef, useCallback }   from 'react';
import { motion }                        from 'framer-motion';
import { Upload, Grid3X3, List, SortAsc, FolderPlus } from 'lucide-react';
import { useVaultStore }                 from '@/store/useVaultStore';
import { FileExplorer }                  from '@/components/files/FileExplorer';
import { UploadHUD }                     from '@/components/files/UploadHUD';
import { PreviewModal }                  from '@/components/files/PreviewModal';
import { UploadOrchestrator }            from '@/components/files/UploadOrchestrator';
import { CreateFolderModal }             from '@/components/files/CreateFolderModal';

// ── Mime Filter Pills ────────────────────────────────────────────────────────
const MIME_FILTERS = [
  { key: 'all',       label: 'All Files' },
  { key: 'images',    label: 'Images'    },
  { key: 'documents', label: 'Documents' },
  { key: 'videos',    label: 'Videos'    },
  { key: 'archives',  label: 'Archives'  },
] as const;

// ── View Toggle ──────────────────────────────────────────────────────────────
function ViewToggle() {
  const viewMode    = useVaultStore(s => s.viewMode);
  const setViewMode = useVaultStore(s => s.setViewMode);

  return (
    <div className="flex rounded-lg border border-white/8 overflow-hidden">
      {([['grid', Grid3X3], ['list', List]] as const).map(([mode, Icon]) => (
        <button
          key={mode}
          onClick={() => setViewMode(mode)}
          className={`p-2 transition-all duration-150
            ${viewMode === mode
              ? 'bg-violet-600 text-white'
              : 'bg-transparent text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
            }`}
          aria-label={`${mode} view`}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────
function DashboardToolbar({ 
  onUploadClick, 
  onCreateFolderClick 
}: { 
  onUploadClick: () => void;
  onCreateFolderClick: () => void;
}) {
  const { mimeFilter, setMimeFilter, sortField, setSortField, sortOrder, setSortOrder } =
    useVaultStore(s => ({
      mimeFilter:    s.mimeFilter,
      setMimeFilter: s.setMimeFilter,
      sortField:     s.sortField,
      setSortField:  s.setSortField,
      sortOrder:     s.sortOrder,
      setSortOrder:  s.setSortOrder,
    }));

  return (
    <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-white/[0.06]
                    overflow-x-auto scrollbar-none">
      <div className="flex items-center gap-1.5 shrink-0">
        {MIME_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMimeFilter(key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all duration-150 whitespace-nowrap
              ${mimeFilter === key
                ? 'bg-violet-600/20 text-violet-400 border border-violet-500/40'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5 border border-transparent'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0" />

      <button
        onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-zinc-500
                   hover:text-zinc-300 hover:bg-white/5 transition-all duration-150"
      >
        <SortAsc className={`h-3.5 w-3.5 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />
        <select
          value={sortField}
          onChange={e => setSortField(e.target.value as typeof sortField)}
          onClick={e => e.stopPropagation()}
          className="bg-transparent text-xs text-zinc-400 outline-none cursor-pointer"
        >
          <option value="date">Date</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
          <option value="type">Type</option>
        </select>
      </button>

      <ViewToggle />

      <button
        onClick={onCreateFolderClick}
        className="btn-2d-glass flex items-center gap-2 px-4 py-2 
                   text-zinc-200 text-sm shrink-0"
      >
        <FolderPlus className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">New Folder</span>
      </button>

      <button
        onClick={onUploadClick}
        className="btn-neon flex items-center gap-2 px-5 py-2 
                   text-white text-sm shrink-0"
      >
        <Upload className="h-3.5 w-3.5 drop-shadow-md" />
        <span className="drop-shadow-md">Upload</span>
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = React.useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setFilesToUpload = useVaultStore(s => s.setFilesToUpload);
  const previewId    = useVaultStore(s => s.previewFileId);
  const kek          = useVaultStore(s => s.kek);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setFilesToUpload(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [setFilesToUpload]);

  const openFilePicker = () => fileInputRef.current?.click();

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <DashboardToolbar 
        onUploadClick={openFilePicker} 
        onCreateFolderClick={() => setIsCreateFolderModalOpen(true)}
      />

      <div className="flex-1 min-h-0">
        <FileExplorer onUploadClick={openFilePicker} />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        aria-hidden="true"
        onChange={handleFileInputChange}
      />

      {/* Floating upload HUD */}
      <UploadHUD />

      {/* Upload Orchestrator — drives the actual encrypt + upload pipeline */}
      <UploadOrchestrator />

      {/* Preview modal */}
      {previewId && <PreviewModal fileId={previewId} kek={kek} />}

      {/* Create Folder modal */}
      <CreateFolderModal 
        open={isCreateFolderModalOpen} 
        onClose={() => setIsCreateFolderModalOpen(false)} 
      />
    </div>
  );
}
