/**
 * components/files/UploadProgressPanel.tsx
 *
 * Real-time upload progress UI driven by useUploader state.
 * Shows per-chunk status (pending/encrypting/uploading/done/error),
 * an animated overall progress bar, and upload speed estimation.
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2, XCircle, Loader2, Lock, Upload,
  AlertCircle, RefreshCw, Clock
} from 'lucide-react';
import { clsx } from 'clsx';
import { UploaderState, ChunkStatus, ChunkState } from '@/hooks/useUploader';

// ── Types ──────────────────────────────────────────────────────────────────

interface UploadProgressPanelProps {
  state:    UploaderState;
  fileName?: string;
  onCancel?: () => void;
  onReset?:  () => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function UploadProgressPanel({
  state,
  fileName,
  onCancel,
  onReset,
}: UploadProgressPanelProps) {
  const [uploadSpeed, setUploadSpeed] = useState<string>('—');
  const lastBytesRef   = useRef(0);
  const lastTimeRef    = useRef(Date.now());

  // ── Upload speed estimation ─────────────────────────────────────────────
  useEffect(() => {
    if (state.status !== 'uploading') return;
    const now       = Date.now();
    const elapsed   = (now - lastTimeRef.current) / 1000;
    const bytesDiff = state.bytesUploaded - lastBytesRef.current;

    if (elapsed > 0.5 && bytesDiff > 0) {
      const bytesPerSec = bytesDiff / elapsed;
      setUploadSpeed(formatSpeed(bytesPerSec));
      lastBytesRef.current = state.bytesUploaded;
      lastTimeRef.current  = now;
    }
  }, [state.bytesUploaded, state.status]);

  if (state.status === 'idle') return null;

  const statusConfig = {
    initiating: { label: 'Preparing upload…',    color: 'text-amber-400' },
    uploading:  { label: 'Encrypting & uploading', color: 'text-violet-400' },
    completing: { label: 'Finalizing…',           color: 'text-violet-400' },
    complete:   { label: 'Upload complete!',       color: 'text-emerald-400' },
    error:      { label: 'Upload failed',          color: 'text-red-400' },
    cancelled:  { label: 'Upload cancelled',       color: 'text-slate-400' },
  };
  const cfg = statusConfig[state.status as keyof typeof statusConfig]
           ?? { label: '…', color: 'text-white' };

  return (
    <div className="w-full rounded-2xl bg-white/5 border border-white/10 p-5 space-y-5 animate-fade-in">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <StatusIcon status={state.status} />
          <div>
            <p className={clsx('text-sm font-semibold', cfg.color)}>{cfg.label}</p>
            {fileName && (
              <p className="text-xs text-slate-500 truncate max-w-xs mt-0.5">{fileName}</p>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-white tabular-nums">
            {state.overallProgress}%
          </p>
          {state.status === 'uploading' && (
            <p className="text-xs text-slate-500 tabular-nums">{uploadSpeed}</p>
          )}
        </div>
      </div>

      {/* ── Overall Progress Bar ─────────────────────────────────────────── */}
      <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-700 ease-out',
            state.status === 'complete'  ? 'bg-emerald-500' :
            state.status === 'error'     ? 'bg-red-500'     :
            state.status === 'cancelled' ? 'bg-slate-500'   :
                                           'bg-violet-500'
          )}
          style={{ width: `${state.overallProgress}%` }}
        />
      </div>

      {/* ── Stats Row ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span>
          <span className="text-white font-medium">{formatBytes(state.bytesUploaded)}</span>
          {' / '}
          {formatBytes(state.totalBytes)}
        </span>
        <span>
          <span className="text-white font-medium">
            {state.chunks.filter(c => c.state === 'done').length}
          </span>
          {' / '}
          {state.totalChunks} chunks
        </span>
      </div>

      {/* ── Per-Chunk Status Grid ────────────────────────────────────────── */}
      {state.totalChunks > 0 && state.totalChunks <= 50 && (
        <ChunkGrid chunks={state.chunks} />
      )}

      {/* ── Error message ───────────────────────────────────────────────── */}
      {state.error && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10
                        border border-red-500/20 rounded-xl px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{state.error}</span>
        </div>
      )}

      {/* ── Action buttons ──────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {(state.status === 'uploading' || state.status === 'initiating') && onCancel && (
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-300
                       hover:text-white bg-white/5 hover:bg-white/10 rounded-lg
                       border border-white/10 transition-all duration-200"
          >
            Cancel
          </button>
        )}
        {(state.status === 'complete' || state.status === 'error' || state.status === 'cancelled')
          && onReset && (
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white
                       bg-violet-600 hover:bg-violet-700 rounded-lg transition-all duration-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Upload Another
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: UploaderState['status'] }) {
  const cls = 'h-5 w-5 shrink-0';
  if (status === 'complete')   return <CheckCircle2 className={clsx(cls, 'text-emerald-400')} />;
  if (status === 'error')      return <XCircle      className={clsx(cls, 'text-red-400')} />;
  if (status === 'cancelled')  return <XCircle      className={clsx(cls, 'text-slate-400')} />;
  if (status === 'initiating') return <Lock         className={clsx(cls, 'text-amber-400')} />;
  if (status === 'uploading')  return <Upload       className={clsx(cls, 'text-violet-400 animate-bounce')} />;
  return <Loader2 className={clsx(cls, 'text-violet-400 animate-spin')} />;
}

const CHUNK_STATE_CONFIG: Record<ChunkState, { bg: string; title: string }> = {
  pending:    { bg: 'bg-white/10',    title: 'Pending' },
  encrypting: { bg: 'bg-amber-500',   title: 'Encrypting' },
  uploading:  { bg: 'bg-violet-500',  title: 'Uploading' },
  done:       { bg: 'bg-emerald-500', title: 'Done' },
  error:      { bg: 'bg-red-500',     title: 'Error' },
};

function ChunkGrid({ chunks }: { chunks: ChunkStatus[] }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">Chunk status</p>
      <div className="flex flex-wrap gap-1.5">
        {chunks.map(chunk => {
          const cfg = CHUNK_STATE_CONFIG[chunk.state];
          return (
            <div
              key={chunk.index}
              title={`Chunk ${chunk.index}: ${cfg.title}${chunk.error ? ` — ${chunk.error}` : ''}`}
              className={clsx(
                'h-4 w-4 rounded-sm transition-colors duration-300',
                cfg.bg,
                chunk.state === 'uploading' && 'animate-pulse'
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Formatters ─────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0)          return '0 B';
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 ** 2)   return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3)   return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(Math.round(bytesPerSec))}/s`;
}
