"use client";

import { useEffect, useRef } from "react";

/**
 * Pointer-follow parallax wrapper. Card drifts gently toward cursor
 * position — max ~14px x ~10px from center, smoothed with 6% lerp.
 *
 * Non-interactive only (display card). Do NOT wrap buttons / clickable
 * content — the motion interferes with target acquisition.
 *
 * Respects prefers-reduced-motion: disables the parallax entirely.
 */
export default function FloatingHero({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let targetX = 0, targetY = 0, currentX = 0, currentY = 0;

    function onMove(e: MouseEvent) {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      targetX = ((e.clientX - cx) / cx) * 14;
      targetY = ((e.clientY - cy) / cy) * 10;
    }

    function onLeave() { targetX = 0; targetY = 0; }

    function tick() {
      currentX += (targetX - currentX) * 0.06;
      currentY += (targetY - currentY) * 0.06;
      if (ref.current) {
        ref.current.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    }

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    tick();
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} style={{ willChange: "transform" }} className="transition-transform">
      {children}
    </div>
  );
}
