'use client';

import React, { useEffect, useRef } from 'react';
import { useVaultStore } from '@/store/useVaultStore';
import { FileExplorer } from '@/components/files/FileExplorer';
import { Trash2 } from 'lucide-react';

export default function TrashPage() {
  const setCurrentView = useVaultStore(s => s.setCurrentView);
  
  useEffect(() => {
    setCurrentView('trash');
    return () => setCurrentView('files');
  }, [setCurrentView]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-white/[0.06]">
        <Trash2 className="h-5 w-5 text-zinc-400" />
        <h1 className="text-lg font-medium text-zinc-200">Trash</h1>
      </div>

      <div className="flex-1 min-h-0">
        <FileExplorer onUploadClick={() => {}} />
      </div>
    </div>
  );
}
