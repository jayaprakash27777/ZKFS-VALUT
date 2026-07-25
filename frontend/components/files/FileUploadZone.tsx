/**
 * components/files/FileUploadZone.tsx
 *
 * Drag-and-drop file upload zone that triggers the ZK encryption + upload flow.
 */

'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Upload, File, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { clsx }        from 'clsx';
import { Button }      from '@/components/ui/Button';
import { useFileUpload, UploadProgress } from '@/hooks/useFileUpload';

interface FileUploadZoneProps {
  kek: CryptoKey | null;
  onUploadComplete?: () => void;
}

export function FileUploadZone({ kek, onUploadComplete }: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { progress, uploadFile, resetProgress } = useFileUpload(kek);

  // ── Drag events ────────────────────────────────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  }, []);

  // ── Upload handler ─────────────────────────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    try {
      await uploadFile(selectedFile);
      onUploadComplete?.();
    } catch {
      // Error state is handled inside the hook
    }
  }, [selectedFile, uploadFile, onUploadComplete]);

  const handleReset = useCallback(() => {
    setSelectedFile(null);
    resetProgress();
    if (inputRef.current) inputRef.current.value = '';
  }, [resetProgress]);

  const isActive = progress.status !== 'idle';

  return (
    <div className="w-full max-w-xl mx-auto space-y-4">
      {/* ── Drop Zone ─────────────────────────────────────────────────────── */}
      <div
        onDragEnter={handleDragEnter}
        onDragOver={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isActive && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="File upload drop zone"
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
        className={clsx(
          'relative flex flex-col items-center justify-center',
          'w-full rounded-2xl border-2 border-dashed p-10 cursor-pointer',
          'transition-all duration-300',
          isDragging
            ? 'border-violet-400 bg-violet-500/10 scale-[1.02]'
            : 'border-white/20 bg-white/5 hover:border-violet-500/50 hover:bg-white/8',
          isActive && 'pointer-events-none'
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) setSelectedFile(file);
          }}
          aria-hidden="true"
        />

        {/* Icon */}
        <div className={clsx(
          'p-4 rounded-2xl mb-4 transition-colors duration-300',
          isDragging ? 'bg-violet-500/30' : 'bg-white/10'
        )}>
          <Upload className={clsx(
            'h-8 w-8 transition-colors duration-300',
            isDragging ? 'text-violet-300' : 'text-slate-400'
          )} />
        </div>

        {selectedFile ? (
          <div className="text-center space-y-1">
            <div className="flex items-center gap-2 text-white font-medium">
              <File className="h-4 w-4 text-violet-400" />
              <span className="truncate max-w-xs">{selectedFile.name}</span>
            </div>
            <p className="text-sm text-slate-400">
              {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          </div>
        ) : (
          <div className="text-center space-y-1">
            <p className="text-white font-medium">Drop your file here</p>
            <p className="text-sm text-slate-400">
              or <span className="text-violet-400">click to browse</span>
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Files are encrypted in your browser before upload
            </p>
          </div>
        )}
      </div>

      {/* ── Progress Bar ───────────────────────────────────────────────────── */}
      {progress.status !== 'idle' && (
        <ProgressCard progress={progress} />
      )}

      {/* ── Action Buttons ─────────────────────────────────────────────────── */}
      <div className="flex gap-3">
        {selectedFile && progress.status === 'idle' && (
          <>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleUpload}
              leftIcon={<Upload className="h-4 w-4" />}
            >
              Encrypt &amp; Upload
            </Button>
            <Button variant="ghost" size="md" onClick={handleReset}>
              <X className="h-4 w-4" />
            </Button>
          </>
        )}
        {progress.status === 'complete' && (
          <Button variant="secondary" className="flex-1" onClick={handleReset}>
            Upload Another File
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Progress Card Sub-component ────────────────────────────────────────────

function ProgressCard({ progress }: { progress: UploadProgress }) {
  const statusConfig = {
    encrypting: { color: 'bg-amber-500',  label: 'Encrypting…',    icon: null },
    uploading:  { color: 'bg-violet-500', label: 'Uploading…',     icon: null },
    complete:   { color: 'bg-emerald-500',label: 'Upload Complete', icon: CheckCircle2 },
    error:      { color: 'bg-red-500',    label: 'Upload Failed',   icon: AlertCircle },
    idle:       { color: 'bg-slate-500',  label: '',                icon: null },
  };

  const cfg    = statusConfig[progress.status];
  const Icon   = cfg.icon;

  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 font-medium text-white">
          {Icon && <Icon className={clsx(
            'h-4 w-4',
            progress.status === 'complete' ? 'text-emerald-400' : 'text-red-400'
          )} />}
          <span>{cfg.label}</span>
        </div>
        <span className="text-slate-400 tabular-nums">
          {progress.status === 'uploading'
            ? `${progress.currentChunk} / ${progress.totalChunks} chunks`
            : `${progress.percentComplete}%`}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-500', cfg.color)}
          style={{ width: `${progress.percentComplete}%` }}
        />
      </div>

      {progress.error && (
        <p className="text-xs text-red-400">{progress.error}</p>
      )}
    </div>
  );
}
