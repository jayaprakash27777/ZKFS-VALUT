'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const VectorAnimation = dynamic(
  () => import('./VectorAnimation').then((mod) => mod.VectorAnimation),
  { ssr: false, loading: () => <div className="w-32 h-32 animate-pulse bg-white/5 rounded-full" /> }
);
export function EmptyVaultAnimation() {
  return (
    <div className="relative w-40 h-40 flex items-center justify-center isolate">
      <div className="absolute inset-0 bg-violet-600/20 blur-[40px] rounded-full -z-10" />
      <VectorAnimation 
        animationUrl="/animations/loading.json" 
        className="w-32 h-32 opacity-80 relative z-10 [transform:translateZ(0)]"
        loop={true}
        autoplay={true}
      />
    </div>
  );
}
