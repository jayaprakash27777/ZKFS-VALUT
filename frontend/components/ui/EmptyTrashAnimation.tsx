'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const VectorAnimation = dynamic(
  () => import('./VectorAnimation').then((mod) => mod.VectorAnimation),
  { ssr: false, loading: () => <div className="w-32 h-32 animate-pulse bg-white/5 rounded-full" /> }
);

export function EmptyTrashAnimation() {
  return (
    <div className="relative w-40 h-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-emerald-600/20 blur-[40px] rounded-full" />
      {/* Assuming we might not have a specific trash Lottie, we use the loading one, or if there is a trash one, we can replace it. */}
      {/* For now, just reuse loading.json as a 2D vector graphic since it's an abstract sleek loader */}
      <VectorAnimation 
        animationUrl="/animations/loading.json" 
        className="w-32 h-32 opacity-80 hue-rotate-180" // Greenish tint
        loop={true}
        autoplay={true}
      />
    </div>
  );
}
