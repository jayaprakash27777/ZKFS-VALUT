/**
 * app/dashboard/layout.tsx
 *
 * ZK Vault Dashboard Shell
 * Provides: dark theme, noise background, sticky header, global
 * drag-and-drop backdrop, and TanStack Query provider.
 */

'use client';

import React, { useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence }    from 'framer-motion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Shield, Lock, HardDriveIcon, LogOut, Settings, Command, Download } from 'lucide-react';
import { useVaultStore }              from '@/store/useVaultStore';
import { useAuth }                    from '@/hooks/useAuth';
import { CommandPalette }             from '@/components/ui/CommandPalette';
import { Sidebar }                    from '@/components/layout/Sidebar';

// ── Query client (singleton) ────────────────────────────────────────────────
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // Files data fresh for 30s
      gcTime:    5 * 60_000,      // Keep in cache for 5 min
      refetchOnWindowFocus: false, // Don't refetch on tab switch
      retry: 1,
    },
  },
});

// ── Storage Bar ─────────────────────────────────────────────────────────────
function StorageBar() {
  const { used, total } = useVaultStore(s => s.storageQuota);
  const pct  = Math.min(100, (used / total) * 100);
  const usedGB = (used  / 1024 ** 3).toFixed(1);
  const totGB  = (total / 1024 ** 3).toFixed(0);

  return (
    <div className="flex items-center gap-3 select-none">
      <div className="hidden sm:flex items-center gap-1.5 text-xs text-zinc-500">
        <HardDriveIcon className="h-3.5 w-3.5" />
        <span className="text-zinc-400 font-medium tabular-nums">{usedGB} GB</span>
        <span>/ {totGB} GB</span>
      </div>
      <div className="w-24 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#8b5cf6' }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ── Crypto Status Badge ─────────────────────────────────────────────────────
function CryptoStatusBadge() {
  const kek = useVaultStore(s => s.kek);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium
        ${kek
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border-zinc-700/50 bg-zinc-800/50 text-zinc-500'
        }`}
    >
      {kek ? (
        <>
          {/* Animated green glow pulse */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <Shield className="h-3 w-3" />
          <span>E2EE Active</span>
          <span className="text-emerald-600">•</span>
          <span className="text-emerald-600/80">KEK in RAM</span>
        </>
      ) : (
        <>
          <span className="h-2 w-2 rounded-full bg-zinc-600" />
          <Lock className="h-3 w-3" />
          <span>Not Authenticated</span>
        </>
      )}
    </motion.div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────
function DashboardHeader({ onCommandOpen }: { onCommandOpen: () => void }) {
  const email      = useVaultStore(s => s.userEmail);
  const { logout } = useAuth();


  return (
    <header className="sticky top-0 z-40 h-14 flex items-center px-4 sm:px-6 gap-4
                       border-b border-white/[0.06] bg-black/60 backdrop-blur-xl">
      {/* Logo */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600">
          <Lock className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="text-sm font-semibold text-white tracking-tight">ZK Vault</span>
      </div>

      <div className="flex-1" />

      {/* Center cluster */}
      <div className="flex items-center gap-3">
        <CryptoStatusBadge />
        <StorageBar />
      </div>

      <div className="flex-1" />

      {/* Right cluster */}
      <div className="flex items-center gap-2">
        {/* Command palette trigger */}
        <button
          onClick={onCommandOpen}
          className="btn-2d-glass flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-300
                     hover:text-white"
          aria-label="Open command palette"
        >
          <Command className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden sm:inline px-1 py-0.5 text-[10px] rounded bg-white/10
                          text-zinc-400 font-mono ml-1">⌘K</kbd>
        </button>

        {/* Offline Decryptor */}
        <a
          href="/zkfs_decrypt.py"
          download
          className="btn-2d-glass flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-300
                     hover:text-violet-200"
          title="Download Offline Decryptor Script"
        >
          <Download className="h-3.5 w-3.5 text-violet-400" />
          <span className="hidden lg:inline">Decryptor</span>
        </a>

        {/* User initials + logout */}
        <div className="flex items-center gap-1">
          <div className="h-6 w-6 rounded-full bg-violet-700 flex items-center justify-center text-[10px]
                          font-semibold text-white uppercase select-none">
            {email?.[0] ?? '?'}
          </div>
          <span className="hidden sm:block text-xs text-zinc-400 max-w-[100px] truncate">
            {email ?? 'Guest'}
          </span>
          <button
            onClick={() => logout()}
            title="Sign out"
            className="ml-1 p-1.5 rounded-lg text-zinc-500 hover:text-red-400
                       hover:bg-red-500/10 transition-all duration-150"
            aria-label="Logout"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}

// ── Global Drag Backdrop ─────────────────────────────────────────────────────
function GlobalDragBackdrop({ onDrop }: { onDrop: (files: File[]) => void }) {
  const isDragOver  = useVaultStore(s => s.isDragOver);
  const setDragOver = useVaultStore(s => s.setDragOver);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes('Files')) setDragOver(true);
  }, [setDragOver]);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, [setDragOver]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) onDrop(files);
  }, [setDragOver, onDrop]);

  useEffect(() => {
    const el = document.documentElement;
    el.addEventListener('dragenter', handleDragEnter);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('dragover',  handleDragOver);
    el.addEventListener('drop',      handleDrop);
    return () => {
      el.removeEventListener('dragenter', handleDragEnter);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('dragover',  handleDragOver);
      el.removeEventListener('drop',      handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return (
    <AnimatePresence>
      {isDragOver && (
        <motion.div
          key="drop-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 pointer-events-none"
        >
          {/* Dimmed overlay */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

          {/* Animated border + drop zone */}
          <motion.div
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1,    opacity: 1 }}
            exit={{ scale: 0.97,    opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute inset-6 rounded-2xl border-2 border-dashed border-violet-500/70
                       flex flex-col items-center justify-center gap-4"
          >
            {/* Glowing ring */}
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-violet-500/30 scale-150" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-full
                              bg-violet-600/20 border border-violet-500/50">
                <Lock className="h-9 w-9 text-violet-400" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-white">Drop to Encrypt & Upload</p>
              <p className="text-sm text-zinc-400 mt-1">
                Files are encrypted with AES-256-GCM in your browser before upload
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const setCommandOpen = useVaultStore(s => s.setCommandOpen);
  const addUpload      = useVaultStore(s => s.addUpload);

  const handleFileDrop = useCallback((files: File[]) => {
    files.forEach(file => {
      const localId = crypto.randomUUID();
      addUpload({
        localId,
        file,                        // ← actual File object for encryption
        fileId:          null,
        fileName:        file.name,
        mimeType:        file.type,
        fileSize:        file.size,
        totalChunks:     Math.ceil(file.size / (5 * 1024 * 1024)),
        phase:           'queued',
        currentChunk:    0,
        overallProgress: 0,
        encryptSpeedMBs: 0,
        uploadSpeedMBs:  0,
        etaSeconds:      null,
        bytesProcessed:  0,
        startedAt:       null,
        paused:          false,
        abortController: new AbortController(),
        error:           null,
      });
    });
  }, [addUpload]);


  // Global Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setCommandOpen]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Noise-textured dark background */}
      <div
        className="min-h-screen bg-[#09090b] text-zinc-100"
        style={{
          backgroundImage: `
            radial-gradient(ellipse at 20% 50%, rgba(124,58,237,0.08) 0%, transparent 60%),
            radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.06) 0%, transparent 50%)
          `,
        }}
      >
        {/* Subtle noise overlay */}
        <div
          className="fixed inset-0 pointer-events-none z-0 opacity-[0.025]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'repeat',
            backgroundSize: '128px 128px',
          }}
        />

        <div className="relative z-10 flex flex-col min-h-screen">
          <DashboardHeader onCommandOpen={() => setCommandOpen(true)} />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-hidden">
              {children}
            </main>
          </div>
        </div>

        {/* Global overlays */}
        <GlobalDragBackdrop onDrop={handleFileDrop} />
        <CommandPalette />
      </div>
    </QueryClientProvider>
  );
}
