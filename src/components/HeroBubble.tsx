"use client";

import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "hero-bubble-pos";
const BUBBLE_WIDTH = 280;
const BUBBLE_HEIGHT = 128;
const MARGIN = 24;

interface Pos { x: number; y: number }

function defaultPos(): Pos {
  if (typeof window === "undefined") return { x: 100, y: 100 };
  return { x: window.innerWidth - BUBBLE_WIDTH - MARGIN, y: 80 };
}

function loadPos(): Pos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Pos;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    return parsed;
  } catch { return null; }
}

function clampToViewport(p: Pos): Pos {
  if (typeof window === "undefined") return p;
  const maxX = window.innerWidth - BUBBLE_WIDTH - MARGIN;
  const maxY = window.innerHeight - BUBBLE_HEIGHT - MARGIN;
  return {
    x: Math.max(MARGIN, Math.min(p.x, maxX)),
    y: Math.max(MARGIN, Math.min(p.y, maxY)),
  };
}

export default function HeroBubble({ children }: { children: React.ReactNode }) {
  const [pos, setPos] = useState<Pos>(defaultPos);
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [introActive, setIntroActive] = useState(true);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);
  const mounted = useRef(false);

  // Load stored position on mount
  useEffect(() => {
    const stored = loadPos();
    if (stored) setPos(clampToViewport(stored));
    else setPos(clampToViewport(defaultPos()));
    mounted.current = true;
    // Intro fade: fully active for 1.8s after mount
    const t = setTimeout(() => setIntroActive(false), 1800);
    return () => clearTimeout(t);
  }, []);

  // Persist position
  useEffect(() => {
    if (!mounted.current) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
  }, [pos]);

  // Keep bubble in viewport on resize
  useEffect(() => {
    function onResize() { setPos((p) => clampToViewport(p)); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Drag handlers
  function onPointerDown(e: React.PointerEvent) {
    // Only left button / primary pointer
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY, cx: pos.x, cy: pos.y };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.px;
    const dy = e.clientY - dragStart.current.py;
    setPos(clampToViewport({ x: dragStart.current.cx + dx, y: dragStart.current.cy + dy }));
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragging) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    dragStart.current = null;
    setDragging(false);
  }

  const reducedMotion = typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const active = hover || dragging || introActive || reducedMotion;

  const idleFilter = "blur(6px) saturate(0.8)";
  const activeFilter = "blur(0px) saturate(1)";

  return (
    <div
      ref={bubbleRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role="region"
      aria-label="Panel flotante de propuestas"
      className="hidden lg:block fixed z-40 select-none"
      style={{
        left: pos.x,
        top: pos.y,
        width: BUBBLE_WIDTH,
        cursor: dragging ? "grabbing" : "grab",
        filter: active ? activeFilter : idleFilter,
        opacity: active ? 1 : 0.55,
        transform: `scale(${active ? 1 : 0.96})`,
        transition: dragging
          ? "none"
          : "filter 450ms cubic-bezier(0.22, 1, 0.36, 1), opacity 450ms cubic-bezier(0.22, 1, 0.36, 1), transform 450ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "transform, filter, opacity",
        touchAction: "none",
      }}
    >
      {children}
    </div>
  );
}
