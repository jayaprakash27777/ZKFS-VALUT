/**
 * components/files/DownloadPanel.tsx
 *
 * Secure Download UI — driven by useDownloader state machine.
 *
 * Visualises each phase of the download pipeline:
 *   fetching-metadata → Fetching file info
 *   unwrapping-key    → Decrypting key material
 *   downloading       → Parallel chunk download + integrity check
 *   assembling        → Building decrypted Blob
 *   complete          → Download triggered
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Download, Shield, Lock, CheckCircle2, XCircle,
  Loader2, AlertTriangle, RefreshCw, FileDown
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  DownloaderState, DownloadChunkState, useDownloader
} from '@/hooks/useDownloader';

// ── Types ──────────────────────────────────────────────────────────────────

interface DownloadPanelProps {
  /** The fileId to download */
  fileId:      string;
  /** Session KEK from useAuth */
  kek:         CryptoKey | null;
  /** Optional display name if filename is not yet decrypted */
  displayName?: string;
  /** Called when download completes */
  onComplete?: (decryptedFileName: string) => void;
  /** Offline download toggle */
  offline?: boolean;
  /** Whether the file is password protected */
  isPasswordProtected?: boolean;
}

// ── Pipeline Step Definitions ──────────────────────────────────────────────

const PIPELINE_STEPS = [
  {
    key:   'fetching-metadata' as const,
    label: 'Fetching metadata',
    icon:  FileDown,
    desc:  'Retrieving file info and chunk manifest',
  },
  {
    key:   'unwrapping-key' as const,
    label: 'Decrypting keys',
    icon:  Lock,
    desc:  'Unwrapping DEK with your session key',
  },
  {
    key:   'downloading' as const,
    label: 'Downloading & verifying',
    icon:  Shield,
    desc:  'Encrypted chunks + SHA-256 integrity checks',
  },
  {
    key:   'assembling' as const,
    label: 'Assembling file',
    icon:  Download,
    desc:  'Decrypting and building secure Blob',
  },
] as const;

// ── Component ──────────────────────────────────────────────────────────────

export function DownloadPanel({ fileId, kek, displayName, onComplete, offline, onClose, isSharedWithMe, sharedWrappedDek, sharedIv, privateKey, isPasswordProtected }: DownloadPanelProps & { onClose?: () => void, isSharedWithMe?: boolean, sharedWrappedDek?: string, sharedIv?: string, privateKey?: CryptoKey | null }) {
  const { state, download, cancel, reset } = useDownloader();
  const [downloadSpeed, setDownloadSpeed]  = useState<string>('—');
  const [customPassword, setCustomPassword] = useState('');
  const lastBytesRef = useRef(0);
  const lastTimeRef  = useRef(Date.now());

  // Speed estimation
  useEffect(() => {
    if (state.status !== 'downloading') return;
    const now     = Date.now();
    const elapsed = (now - lastTimeRef.current) / 1000;
    const delta   = state.bytesDownloaded - lastBytesRef.current;
    if (elapsed > 0.5 && delta > 0) {
      setDownloadSpeed(formatSpeed(delta / elapsed));
      lastBytesRef.current = state.bytesDownloaded;
      lastTimeRef.current  = now;
    }
  }, [state.bytesDownloaded, state.status]);

  const handleDownload = async () => {
    if (!kek) return;
    await download({
      fileId,
      kek,
      offline,
      isSharedWithMe,
      sharedWrappedDek,
      sharedIv,
      privateKey,
      customPassword: customPassword.trim() || undefined,
    }).then(() => {
      onComplete?.(displayName || 'file');
    }).catch(err => {});
  };

  // ── Idle state — show download button ─────────────────────────────────────

  if (state.status === 'idle') {
    return (
      <div className="flex flex-col gap-3 w-full">
        {isPasswordProtected && (
          <div className="flex flex-col gap-1.5 animate-in fade-in slide-in-from-top-2">
            <label className="text-xs font-medium text-zinc-400 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              File Password Required
            </label>
            <input
              type="password"
              placeholder="Enter password..."
              value={customPassword}
              onChange={(e) => setCustomPassword(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-violet-500/50"
            />
          </div>
        )}
        <button
          onClick={handleDownload}
          disabled={!kek || (isPasswordProtected && !customPassword.trim())}
          className={clsx(
            'flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-xl',
            'transition-all duration-200 w-full',
            kek && (!isPasswordProtected || customPassword.trim())
              ? 'btn-gloss'
              : 'bg-white/5 text-slate-500 cursor-not-allowed border border-white/10'
          )}
          title={!kek ? 'Re-authenticate to download (session key required)' : undefined}
        >
          <Download className="h-4 w-4" />
          {displayName ?? 'Download'} {offline && '(Offline .zkfs)'}
        </button>
      </div>
    );
  }

  // ── Active / complete state — full panel ──────────────────────────────────

  const currentStepIndex = PIPELINE_STEPS.findIndex(s => s.key === state.status);
  const isActive         = !['complete', 'error', 'cancelled'].includes(state.status);

  return (
    <div className="w-full rounded-2xl bg-white/5 border border-white/10 p-5 space-y-5 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <HeaderIcon status={state.status} />
          <div>
            <p className="text-sm font-semibold text-white">
              {state.status === 'complete'   ? `Downloaded: ${state.fileName}` :
               state.status === 'error'      ? 'Download failed'               :
               state.status === 'cancelled'  ? 'Download cancelled'            :
               state.status === 'assembling' ? 'Building secure file…'         :
                                               'Secure download in progress'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {state.status === 'downloading' ? `${downloadSpeed} · SHA-256 verified per chunk` :
               state.status === 'assembling'  ? 'AES-256-GCM decrypting…'                       :
               state.status === 'complete'    ? 'All chunks verified & decrypted'               :
                                               ''}
            </p>
          </div>
        </div>

        {/* Overall progress */}
        <div className="text-right">
          <p className="text-lg font-bold text-white tabular-nums">{state.overallProgress}%</p>
          {state.status === 'downloading' && (
            <p className="text-xs text-slate-500 tabular-nums">
              {formatBytes(state.bytesDownloaded)} / {formatBytes(state.totalBytes)}
            </p>
          )}
        </div>
      </div>

      {/* ── Overall progress bar ────────────────────────────────────────────── */}
      <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500 ease-out',
            state.status === 'complete'  ? 'bg-emerald-500' :
            state.status === 'error'     ? 'bg-red-500'     :
            state.status === 'cancelled' ? 'bg-slate-500'   :
                                           'bg-violet-500'
          )}
          style={{ width: `${state.overallProgress}%` }}
        />
      </div>

      {/* ── Pipeline steps ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        {PIPELINE_STEPS.map((step, i) => {
          const StepIcon = step.icon;
          const isDone   = currentStepIndex > i || state.status === 'complete';
          const isCurrent = currentStepIndex === i && isActive;
          return (
            <div
              key={step.key}
              className={clsx(
                'flex flex-col items-center gap-1.5 p-3 rounded-xl text-center',
                'transition-all duration-300',
                isDone    ? 'bg-violet-500/20 border border-violet-500/30' :
                isCurrent ? 'bg-white/10 border border-violet-500/50'      :
                            'bg-white/3 border border-white/5'
              )}
              title={step.desc}
            >
              <div className={clsx(
                'flex h-7 w-7 items-center justify-center rounded-full',
                isDone    ? 'bg-violet-600 text-white'   :
                isCurrent ? 'bg-white/20 text-violet-400' :
                            'bg-white/5 text-slate-600'
              )}>
                {isDone
                  ? <CheckCircle2 className="h-3.5 w-3.5" />
                  : <StepIcon    className={clsx('h-3.5 w-3.5', isCurrent && 'animate-pulse')} />}
              </div>
              <span className={clsx(
                'text-[10px] font-medium leading-tight',
                isDone    ? 'text-violet-300' :
                isCurrent ? 'text-white'       :
                            'text-slate-600'
              )}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── Chunk grid (only during download) ──────────────────────────────── */}
      {state.status === 'downloading' && state.totalChunks > 0 && state.totalChunks <= 64 && (
        <ChunkDownloadGrid chunks={state.chunks} />
      )}

      {/* ── Error message ───────────────────────────────────────────────────── */}
      {state.error && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10
                        border border-red-500/20 rounded-xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{state.error}</span>
        </div>
      )}

      {/* ── Security note ───────────────────────────────────────────────────── */}
      {state.status === 'complete' && (
        <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10
                        border border-emerald-500/20 rounded-xl px-4 py-2.5">
          <Shield className="h-3.5 w-3.5 shrink-0" />
          <span>
            File decrypted in-browser · Server never saw your content · {state.totalChunks} chunks verified
          </span>
        </div>
      )}

      {/* ── Action buttons ──────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {isActive && (
          <button
            onClick={cancel}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white
                       bg-white/5 hover:bg-white/10 rounded-lg border border-white/10
                       transition-all duration-200"
          >
            Cancel
          </button>
        )}
        {!isActive && state.status !== 'complete' && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white
                       bg-violet-600 hover:bg-violet-700 rounded-lg transition-all duration-200"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function HeaderIcon({ status }: { status: DownloaderState['status'] }) {
  const cls = 'h-5 w-5 shrink-0';
  if (status === 'complete')          return <CheckCircle2 className={clsx(cls, 'text-emerald-400')} />;
  if (status === 'error')             return <XCircle      className={clsx(cls, 'text-red-400')} />;
  if (status === 'cancelled')         return <XCircle      className={clsx(cls, 'text-slate-400')} />;
  if (status === 'fetching-metadata') return <FileDown     className={clsx(cls, 'text-amber-400')} />;
  if (status === 'unwrapping-key')    return <Lock         className={clsx(cls, 'text-violet-400 animate-pulse')} />;
  if (status === 'downloading')       return <Shield       className={clsx(cls, 'text-violet-400')} />;
  if (status === 'assembling')        return <Loader2      className={clsx(cls, 'text-violet-400 animate-spin')} />;
  return <Download className={cls} />;
}

const CHUNK_DL_STATE_CONFIG: Record<DownloadChunkState, { bg: string; title: string }> = {
  pending:     { bg: 'bg-white/10',    title: 'Pending' },
  downloading: { bg: 'bg-amber-500',   title: 'Downloading' },
  decrypting:  { bg: 'bg-violet-500',  title: 'Decrypting' },
  done:        { bg: 'bg-emerald-500', title: 'Done' },
  error:       { bg: 'bg-red-500',     title: 'Error' },
};

function ChunkDownloadGrid({ chunks }: { chunks: DownloaderState['chunks'] }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">Chunk status</p>
      <div className="flex flex-wrap gap-1.5">
        {chunks.map(c => {
          const cfg = CHUNK_DL_STATE_CONFIG[c.state];
          return (
            <div
              key={c.index}
              title={`Chunk ${c.index}: ${cfg.title}${c.error ? ` — ${c.error}` : ''}`}
              className={clsx(
                'h-4 w-4 rounded-sm transition-colors duration-300',
                cfg.bg,
                c.state === 'downloading' && 'animate-pulse'
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Formatters ─────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b === 0)         return '0 B';
  if (b < 1024)        return `${b} B`;
  if (b < 1024 ** 2)  return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3)  return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
function formatSpeed(bps: number): string { return `${formatBytes(Math.round(bps))}/s`; }
