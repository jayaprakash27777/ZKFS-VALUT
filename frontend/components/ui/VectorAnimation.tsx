'use client';

import React from 'react';
import dynamic from 'next/dynamic';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

interface VectorAnimationProps {
  animationUrl: string; // URL to the lottie JSON
  loop?: boolean;
  autoplay?: boolean;
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function VectorAnimation({
  animationUrl,
  loop = true,
  autoplay = true,
  className = '',
  width,
  height,
}: VectorAnimationProps) {
  const [animationData, setAnimationData] = React.useState<any>(null);

  React.useEffect(() => {
    fetch(animationUrl)
      .then((res) => res.json())
      .then((data) => setAnimationData(data))
      .catch((err) => console.error('Failed to load Lottie animation', err));
  }, [animationUrl]);

  if (!animationData) {
    return <div className={`animate-pulse bg-white/5 rounded-2xl ${className}`} style={{ width, height }} />;
  }

  return (
    <div className={className} style={{ width, height }}>
      <Lottie
        animationData={animationData}
        loop={loop}
        autoplay={autoplay}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
