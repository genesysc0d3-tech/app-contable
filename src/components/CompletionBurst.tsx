"use client";

import { useEffect, useState } from "react";

const PARTICLES = [
  { x: -18, y: -22, size: 5, delay: 0 },
  { x: 20, y: -18, size: 4, delay: 0.05 },
  { x: -22, y: 12, size: 3, delay: 0.1 },
  { x: 16, y: 20, size: 5, delay: 0.08 },
  { x: -8, y: -26, size: 3, delay: 0.12 },
  { x: 24, y: 4, size: 4, delay: 0.06 },
];

export default function CompletionBurst({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      onDone();
    }, 1200);
    return () => clearTimeout(t);
  }, [onDone]);

  if (!visible) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      {/* Circle + Check */}
      <svg width="48" height="48" viewBox="0 0 48 48" className="animate-check-circle">
        <circle cx="24" cy="24" r="22" fill="#E8553E" opacity="0.15" />
        <circle cx="24" cy="24" r="18" fill="#E8553E" />
        <polyline
          points="15,24 21,30 33,18"
          fill="none"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-check-draw"
        />
      </svg>

      {/* Particles */}
      {PARTICLES.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full animate-particle"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: i % 2 === 0 ? "#E8553E" : "#F59E0B",
            transform: `translate(${p.x}px, ${p.y}px)`,
            animationDelay: `${0.5 + p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
