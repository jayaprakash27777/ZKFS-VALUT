/**
 * components/ui/CommandPalette.tsx
 *
 * Cmd+K Global Command Palette — powered by cmdk
 * ═════════════════════════════════════════════
 *
 * Groups:
 *   Navigation:  Go to Dashboard, Settings, Audit Log
 *   Files:       Upload New, Download Selected, Delete Selected
 *   View:        Switch to Grid, Switch to List
 *   Security:    Lock Vault (clear KEK), View Crypto Status
 *
 * Features:
 *   • Instant fuzzy search over all commands
 *   • Keyboard navigation: ↑↓ arrows, Enter to select, Escape to close
 *   • Recent commands remembered in component state (extensible to localStorage)
 *   • Smooth fade+scale entry via Framer Motion
 *   • Status badge shows active E2EE state
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Command }                from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import * as Dialog                from '@radix-ui/react-dialog';
import * as VisuallyHidden        from '@radix-ui/react-visually-hidden';
import {
  LayoutGrid, List as ListIcon, Upload, Download, Trash2,
  Lock, Shield, Settings, FileText, Search, Clock,
  Command as CommandIcon, X
} from 'lucide-react';
import { useVaultStore }          from '@/store/useVaultStore';
import { useRouter }              from 'next/navigation';

// ── Command Definitions ───────────────────────────────────────────────────────

interface VaultCommand {
  id:      string;
  label:   string;
  icon:    React.ElementType;
  group:   'Navigation' | 'Files' | 'View' | 'Security';
  shortcut?: string;
  action:  () => void;
  danger?: boolean;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CommandItem({ cmd }: { cmd: VaultCommand }) {
  const Icon = cmd.icon;
  return (
    <Command.Item
      value={`${cmd.group} ${cmd.label}`}
      onSelect={cmd.action}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
                  outline-none transition-colors duration-100 select-none
                  data-[selected]:bg-white/8 data-[selected]:text-white
                  ${cmd.danger ? 'data-[selected]:bg-red-500/15 data-[selected]:text-red-400' : ''}`}
    >
      <div className={`flex h-7 w-7 items-center justify-center rounded-lg
        ${cmd.danger
          ? 'bg-red-500/15 text-red-400'
          : 'bg-white/[0.04] text-zinc-500 group-data-[selected]:bg-violet-600/20 group-data-[selected]:text-violet-400'
        }`}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      <span className="flex-1 text-sm text-zinc-400 group-data-[selected]:text-inherit">
        {cmd.label}
      </span>

      {cmd.shortcut && (
        <kbd className="shrink-0 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600
                        bg-white/5 border border-white/10 rounded">
          {cmd.shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function CommandPalette() {
  const router    = useRouter();
  const isOpen    = useVaultStore(s => s.isCommandOpen);
  const setOpen   = useVaultStore(s => s.setCommandOpen);
  const kek       = useVaultStore(s => s.kek);
  const setKek    = useVaultStore(s => s.setKek);
  const setViewMode = useVaultStore(s => s.setViewMode);

  const [query, setQuery] = useState('');

  // Build commands with closures over store actions
  const commands: VaultCommand[] = [
    // Navigation
    { id: 'nav-dashboard', label: 'Dashboard', icon: LayoutGrid,   group: 'Navigation', action: () => { router.push('/dashboard'); setOpen(false); } },
    { id: 'nav-settings',  label: 'Settings',  icon: Settings,     group: 'Navigation', action: () => { router.push('/settings');  setOpen(false); } },

    // Files
    { id: 'file-upload',   label: 'Upload Files',         icon: Upload,   group: 'Files', shortcut: '⌘U',
      action: () => { setOpen(false); document.getElementById('file-upload-input')?.click(); } },
    { id: 'file-download', label: 'Download Selected',    icon: Download, group: 'Files',
      action: () => { setOpen(false); window.dispatchEvent(new CustomEvent('cmd:download-selected')); } },
    { id: 'file-delete',   label: 'Delete Selected',      icon: Trash2,   group: 'Files',  danger: true,
      action: () => { setOpen(false); window.dispatchEvent(new CustomEvent('cmd:delete-selected')); } },

    // View
    { id: 'view-grid', label: 'Switch to Grid View', icon: LayoutGrid, group: 'View', shortcut: '⌘1',
      action: () => { setViewMode('grid'); setOpen(false); } },
    { id: 'view-list', label: 'Switch to List View', icon: ListIcon,   group: 'View', shortcut: '⌘2',
      action: () => { setViewMode('list'); setOpen(false); } },

    // Security
    { id: 'sec-status', label: `E2EE Status: ${kek ? 'Active' : 'Inactive'}`, icon: Shield, group: 'Security',
      action: () => { setOpen(false); } },
    { id: 'sec-lock',   label: 'Lock Vault (Clear KEK from RAM)',             icon: Lock,   group: 'Security', danger: true,
      action: () => { setKek(null); setOpen(false); router.push('/login'); } },
  ];

  // Group commands
  const groups = ['Navigation', 'Files', 'View', 'Security'] as const;

  const close = useCallback(() => { setOpen(false); setQuery(''); }, [setOpen]);

  // Keyboard: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, close]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(v) => !v && close()}>
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {isOpen && (
            <>
              {/* Backdrop */}
              <Dialog.Overlay asChild>
                <motion.div
                  key="palette-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md"
                />
              </Dialog.Overlay>

              {/* Palette */}
              <Dialog.Content asChild>
                <motion.div
                  key="palette-content"
                  initial={{ opacity: 0, scale: 0.97, y: -12 }}
                  animate={{ opacity: 1, scale: 1,    y: 0   }}
                  exit={{   opacity: 0, scale: 0.97,  y: -8  }}
                  transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                  className="fixed top-[15%] left-1/2 z-50 -translate-x-1/2 w-full max-w-lg px-4"
                >
                  <Command
                    className="relative rounded-2xl bg-zinc-900/80 backdrop-blur-3xl border border-white/10
                               shadow-[0_0_40px_rgba(139,92,246,0.15)] overflow-hidden
                               before:absolute before:inset-0 before:bg-gradient-to-br before:from-violet-500/10 before:to-transparent before:pointer-events-none"
                  >
                    {/* Search input */}
                    <div className="relative z-10 flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
                      <Search className="h-4 w-4 text-zinc-600 shrink-0" />
                      <Command.Input
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Search commands…"
                        className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600
                                   outline-none caret-violet-400"
                        autoFocus
                      />
                      {/* Crypto status badge */}
                      <div className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px]
                        ${kek
                          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500'
                          : 'bg-zinc-800 border border-white/8 text-zinc-600'
                        }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${kek ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
                        {kek ? 'E2EE Active' : 'Not authenticated'}
                      </div>
                      <button
                        onClick={close}
                        className="p-1 rounded text-zinc-600 hover:text-zinc-400 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Command list */}
                    <Command.List className="relative z-10 overflow-y-auto max-h-80 p-2 scrollbar-none">
                      <Command.Empty className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                        <CommandIcon className="h-8 w-8 text-zinc-700" />
                        <p className="text-sm text-zinc-500">No commands found for "{query}"</p>
                      </Command.Empty>

                      {groups.map(group => {
                        const groupCmds = commands.filter(c => c.group === group);
                        return (
                          <Command.Group
                            key={group}
                            heading={group}
                            className="[&>[cmdk-group-heading]]:px-2 [&>[cmdk-group-heading]]:py-1.5
                                       [&>[cmdk-group-heading]]:text-[10px] [&>[cmdk-group-heading]]:font-semibold
                                       [&>[cmdk-group-heading]]:text-zinc-600
                                       [&>[cmdk-group-heading]]:uppercase [&>[cmdk-group-heading]]:tracking-wider"
                          >
                            {groupCmds.map(cmd => (
                              <CommandItem key={cmd.id} cmd={cmd} />
                            ))}
                          </Command.Group>
                        );
                      })}
                    </Command.List>

                    {/* Footer */}
                    <div className="flex items-center gap-3 px-4 py-2 border-t border-white/[0.04]
                                    text-[10px] text-zinc-700">
                      <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" /> Recent</span>
                      <span>↑↓ navigate</span>
                      <span>↵ select</span>
                      <span>Esc close</span>
                    </div>
                  </Command>
                </motion.div>
              </Dialog.Content>
            </>
          )}
        </AnimatePresence>
      </Dialog.Portal>

      <VisuallyHidden.Root>
        <Dialog.Title>Command Palette</Dialog.Title>
        <Dialog.Description>Search and run vault commands</Dialog.Description>
      </VisuallyHidden.Root>
    </Dialog.Root>
  );
}
