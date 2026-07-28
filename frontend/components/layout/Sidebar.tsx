'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { FolderOpen, Trash2, Settings, Shield, Clock, Share2, Users } from 'lucide-react';

const NAV_ITEMS = [
  { label: 'My Vault',     href: '/dashboard',        icon: FolderOpen },
  { label: 'Shared Links', href: '/dashboard/shared', icon: Share2 },
  { label: 'Shared With Me',href: '/dashboard/shared-with-me', icon: Users },
  { label: 'Trash',        href: '/dashboard/trash',  icon: Trash2 },
  { label: 'Settings',     href: '/settings',         icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="panel-floating w-64 shrink-0 flex flex-col h-full mr-0 border-r-0">
      {/* Subtle Noise Texture Overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")` }}
      />
      <div className="relative z-10 p-4 flex-1 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link key={item.href} href={item.href} className="block relative">
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-violet-600/20 border border-violet-500/50 rounded-2xl shadow-neon-violet"
                  transition={{ type: 'spring', stiffness: 200, damping: 20 }}
                />
              )}
              <motion.div
                whileHover={{ scale: 1.02, x: 4 }}
                whileTap={{ scale: 0.98 }}
                className={`relative flex items-center gap-3 px-3 py-3 rounded-2xl text-[15px] font-medium transition-colors
                  ${isActive ? 'text-violet-200' : 'text-zinc-400 hover:text-white hover:bg-white/5'}
                `}
              >
                <Icon className={`h-[18px] w-[18px] ${isActive ? 'text-violet-300 drop-shadow-md' : 'text-zinc-500'}`} />
                {item.label}
              </motion.div>
            </Link>
          );
        })}
      </div>

      <div className="relative z-10 p-4">
        <motion.div 
          whileHover={{ scale: 1.02 }}
          className="rounded-2xl border border-violet-500/30 bg-violet-500/15 p-5 shadow-neon-violet transition-all"
        >
          <div className="flex items-center gap-2 mb-2.5">
            <Shield className="h-4 w-4 text-violet-300 drop-shadow-md" />
            <h4 className="text-xs font-bold text-violet-200 uppercase tracking-widest drop-shadow-sm">Zero-Knowledge</h4>
          </div>
          <p className="text-xs text-violet-100/70 leading-relaxed font-medium">
            Your master password never leaves this device. The server cannot read your files.
          </p>
        </motion.div>
      </div>
    </aside>
  );
}
