'use client';

import React, { useRef, useState, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

interface TiltCardProps {
  children: React.ReactNode;
  className?: string;
  tiltReverse?: boolean;
  maxTilt?: number;
}

export function TiltCard({ children, className = '', tiltReverse = false, maxTilt = 15 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Smooth out the motion values for the tilt
  const springConfig = { damping: 25, stiffness: 300, mass: 0.5 };
  const springX = useSpring(x, springConfig);
  const springY = useSpring(y, springConfig);

  // Map mouse position to rotation
  const rotateX = useTransform(springY, [-0.5, 0.5], tiltReverse ? [-maxTilt, maxTilt] : [maxTilt, -maxTilt]);
  const rotateY = useTransform(springX, [-0.5, 0.5], tiltReverse ? [maxTilt, -maxTilt] : [-maxTilt, maxTilt]);

  // Map mouse position to glare effect
  const glareX = useTransform(springX, [-0.5, 0.5], [100, -100]);
  const glareY = useTransform(springY, [-0.5, 0.5], [100, -100]);
  const glareOpacity = useTransform(springY, [-0.5, 0.5], [0, 0.3]);

  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseEnter = () => setIsHovered(true);

  const handleMouseLeave = () => {
    setIsHovered(false);
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX,
        rotateY,
        transformStyle: 'preserve-3d',
        perspective: 1000,
      }}
      className={`relative ${className}`}
    >
      <motion.div
        style={{ transform: 'translateZ(10px)' }}
        className="w-full h-full relative"
      >
        {children}
        
        {/* Dynamic Glare Overlay */}
        <motion.div
          className="absolute inset-0 pointer-events-none rounded-inherit transition-opacity duration-300"
          style={{
            background: 'radial-gradient(circle at center, rgba(255,255,255,1) 0%, transparent 60%)',
            mixBlendMode: 'overlay',
            opacity: isHovered ? glareOpacity : 0,
            x: glareX,
            y: glareY,
          }}
        />
      </motion.div>
    </motion.div>
  );
}
