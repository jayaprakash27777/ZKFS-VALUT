/**
 * components/files/UploadHUD.tsx
 *
 * Floating Upload HUD — Real-time per-file encryption & upload metrics
 * ═════════════════════════════════════════════════════════════════════
 *
 * Features:
 *  • Framer Motion AnimatePresence: smooth slide-in from bottom-right
 *  • Per-file row: chunk progress bar, encryption speed (MB/s), ETA
 *  • "Chunk N of M" status line (e.g., "Encrypting Chunk 4 of 12")
 *  • Mini chunk dot-grid showing per-chunk state
 *  • Pause / Resume / Cancel controls
 *  • Collapsible minimised state (just a badge count)
 *  • All state read from Zustand — zero local useState for upload data
 */

'use client';

import React, { memo, useCallback, useMemo } from 'react';
import { motion, AnimatePresence }  from 'framer-motion';
import {
  Upload, X, Pause, Play, ChevronDown, ChevronUp,
  Lock, Zap, Clock, AlertCircle, CheckCircle2
} from 'lucide-react';
import { useVaultStore, selectActiveUploads } from '@/store/useVaultStore';
import type { PendingUpload, UploadPhase }    from '@/types/vault';

// ── Formatters ──────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024)       return `${b} B`;
  if (b < 1024 ** 2)  return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)  return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function formatEta(s: number | null): string {
  if (s === null || s <= 0) return '—';
  if (s < 60)   return `~${Math.ceil(s)}s`;
  if (s < 3600) return `~${Math.ceil(s / 60)}m`;
  return `~${(s / 3600).toFixed(1)}h`;
}

function formatSpeed(mbs: number): string {
  if (mbs <= 0) return '—';
  if (mbs < 1)  return `${(mbs * 1024).toFixed(0)} KB/s`;
  return `${mbs.toFixed(0)} MB/s`;
}

// ── Phase Metadata ───────────────────────────────────────────────────────────

const PHASE_LABEL: Record<UploadPhase, string> = {
  queued:       'Queued',
  'deriving-key': 'Deriving key…',
  initiating:   'Initiating…',
  encrypting:   'Encrypting',
  uploading:    'Uploading',
  completing:   'Finalising…',
  done:         'Complete',
  error:        'Error',
  paused:       'Paused',
};

// ── Chunk Dot Progress ───────────────────────────────────────────────────────
const ChunkDots = memo(({ total, current, phase }: {
  total:   number;
  current: number;
  phase:   UploadPhase;
}) => {
  const dots = Math.min(total, 20);   // cap visual dots at 20
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {Array.from({ length: dots }).map((_, i) => {
        const isDone    = i < current;
        const isActive  = i === current && (phase === 'encrypting' || phase === 'uploading');
        const isError   = phase === 'error' && i >= current;
        return (
          <div
            key={i}
            className={`h-2.5 w-2.5 rounded-sm transition-colors duration-300
              ${isDone   ? 'bg-emerald-500' :
                isActive ? 'bg-violet-400 animate-pulse' :
                isError  ? 'bg-red-800/50' :
                           'bg-white/10'}`}
          />
        );
      })}
      {total > dots && (
        <span className="text-[10px] text-zinc-600 self-center ml-0.5">+{total - dots}</span>
      )}
    </div>
  );
});
ChunkDots.displayName = 'ChunkDots';

// ── Single Upload Row ────────────────────────────────────────────────────────
const UploadRow = memo(({ upload }: { upload: PendingUpload }) => {
  const { pauseUpload, resumeUpload, cancelUpload } = useVaultStore(s => ({
    pauseUpload:  s.pauseUpload,
    resumeUpload: s.resumeUpload,
    cancelUpload: s.cancelUpload,
  }));

  const { localId, fileName, fileSize, totalChunks, currentChunk,
          overallProgress, encryptSpeedMBs, etaSeconds, phase, error } = upload;

  const canPause  = phase === 'encrypting' || phase === 'uploading';
  const canResume = phase === 'paused';
  const isDone    = phase === 'done';
  const isError   = phase === 'error';

  const progressBarColor = isDone   ? 'bg-emerald-500' :
                           isError  ? 'bg-red-500'     :
                           canResume ? 'bg-amber-500'  :
                                       'bg-violet-500';

  const phaseLabel = phase === 'encrypting'
    ? `Encrypting chunk ${currentChunk + 1} of ${totalChunks}`
    : PHASE_LABEL[phase];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20, height: 0 }}
      className="group"
    >
      {/* Header row: icon + name + controls */}
      <div className="flex items-start gap-2.5 mb-2">
        {/* File type icon */}
        <div className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-lg mt-0.5
          ${isDone  ? 'bg-emerald-500/15' :
            isError ? 'bg-red-500/15'     :
                      'bg-violet-500/15'}`}
        >
          {isDone  ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> :
           isError ? <AlertCircle  className="h-4 w-4 text-red-400"     /> :
                     <Lock        className="h-4 w-4 text-violet-400"   />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-zinc-200 truncate max-w-[140px]" title={fileName}>
              {fileName}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              {canPause && (
                <button
                  onClick={() => pauseUpload(localId)}
                  className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-amber-400
                             transition-colors"
                  title="Pause"
                >
                  <Pause className="h-3 w-3" />
                </button>
              )}
              {canResume && (
                <button
                  onClick={() => resumeUpload(localId)}
                  className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-emerald-400
                             transition-colors"
                  title="Resume"
                >
                  <Play className="h-3 w-3" />
                </button>
              )}
              <button
                onClick={() => cancelUpload(localId)}
                className="p-1 rounded hover:bg-white/10 text-zinc-600 hover:text-red-400
                           transition-colors"
                title="Cancel"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-1.5 h-1 w-full rounded-full bg-white/10 overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${progressBarColor}`}
              initial={{ width: '0%' }}
              animate={{ width: `${overallProgress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Overall % */}
        <span className={`shrink-0 text-xs font-bold tabular-nums
          ${isDone ? 'text-emerald-400' : isError ? 'text-red-400' : 'text-zinc-300'}`}>
          {isDone ? '✓' : `${overallProgress}%`}
        </span>
      </div>

      {/* Metrics row */}
      {!isDone && !isError && (
        <div className="flex items-center gap-3 text-[11px] text-zinc-500 pl-10">
          <span className="text-zinc-300 truncate max-w-[140px]">{phaseLabel}</span>
          <span className="flex items-center gap-1 shrink-0">
            <Zap className="h-3 w-3 text-violet-500" />
            {formatSpeed(encryptSpeedMBs)}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            <Clock className="h-3 w-3 text-zinc-600" />
            {formatEta(etaSeconds)}
          </span>
        </div>
      )}

      {isError && (
        <p className="text-[11px] text-red-400 pl-10 truncate">{error ?? 'Upload failed'}</p>
      )}

      {/* Chunk dot grid */}
      {!isDone && !isError && phase !== 'queued' && totalChunks > 1 && (
        <div className="pl-10">
          <ChunkDots total={totalChunks} current={currentChunk} phase={phase} />
        </div>
      )}

      {/* Separator */}
      <div className="mt-3 border-b border-white/[0.05]" />
    </motion.div>
  );
});
UploadRow.displayName = 'UploadRow';

// ── Main HUD ─────────────────────────────────────────────────────────────────
export function UploadHUD() {
  const uploads      = useVaultStore(selectActiveUploads);
  const isMinimised  = useVaultStore(s => s.isHUDMinimised);
  const toggleMin    = useVaultStore(s => s.toggleHUDMinimised);

  const count     = uploads.length;
  const doneCount = uploads.filter(u => u.phase === 'done').length;
  const hasActive = count > 0;

  // Overall aggregate progress across all active uploads
  const avgProgress = useMemo(() => {
    if (!count) return 0;
    return Math.round(uploads.reduce((s, u) => s + u.overallProgress, 0) / count);
  }, [uploads, count]);

  return (
    <AnimatePresence>
      {hasActive && (
        <motion.div
          key="upload-hud"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0,  scale: 1    }}
          exit={{   opacity: 0, y: 24,  scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          className="fixed bottom-5 right-5 z-50 w-80 panel-floating !m-0"
          style={{ maxHeight: '85vh' }}
        >
          {/* HUD header */}
          <div
            className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.06]
                        cursor-pointer select-none"
            onClick={toggleMin}
          >
            <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600/20">
              <Upload className="h-3.5 w-3.5 text-violet-400" />
              {/* Pinging dot when active */}
              {doneCount < count && (
                <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500" />
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-zinc-200">
                {doneCount < count
                  ? `Encrypting ${count - doneCount} file${count - doneCount > 1 ? 's' : ''}`
                  : `${doneCount} file${doneCount > 1 ? 's' : ''} uploaded`}
              </p>
              {/* Aggregate progress bar */}
              <div className="mt-1 h-0.5 w-full rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-violet-500"
                  animate={{ width: `${avgProgress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>

            <span className="shrink-0 text-xs font-bold text-zinc-400 tabular-nums">
              {avgProgress}%
            </span>

            <button
              className="shrink-0 p-1 rounded hover:bg-white/10 text-zinc-600
                         hover:text-zinc-300 transition-colors"
              onClick={e => { e.stopPropagation(); toggleMin(); }}
              aria-label={isMinimised ? 'Expand HUD' : 'Minimise HUD'}
            >
              {isMinimised
                ? <ChevronUp   className="h-3.5 w-3.5" />
                : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Upload rows (collapsible) */}
          <AnimatePresence initial={false}>
            {!isMinimised && (
              <motion.div
                key="hud-body"
                initial={{ height: 0,    opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{    height: 0,    opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-y-auto"
                style={{ maxHeight: '60vh' }}
              >
                <div className="px-4 py-3 space-y-0">
                  <AnimatePresence mode="popLayout">
                    {uploads.map(upload => (
                      <UploadRow key={upload.localId} upload={upload} />
                    ))}
                  </AnimatePresence>
                </div>

                {/* Security note */}
                <div className="flex items-center gap-1.5 px-4 pb-3 text-[10px] text-zinc-600">
                  <Lock className="h-2.5 w-2.5" />
                  <span>AES-256-GCM encrypted in browser — server sees only ciphertext</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
