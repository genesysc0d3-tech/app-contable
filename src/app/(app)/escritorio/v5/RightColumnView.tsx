"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import GlowWrap from "./GlowWrap";
import ActividadView, { type ActividadItem } from "./ActividadView";

export default function RightColumnView({
  defaultContent,
  actividadItems,
  rcvContent,
}: {
  defaultContent: ReactNode;
  actividadItems?: ActividadItem[];
  rcvContent?: ReactNode;
}) {
  const [view, setView] = useState<"dashboard" | "actividad" | "rcv">("dashboard");
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [originStyle, setOriginStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    function handler(e: CustomEvent) {
      const v = (e.detail as string) ?? "";
      if (v === "actividad" || v === "rcv" || v === "dashboard") setView(v);
    }
    window.addEventListener("switch-view", handler as EventListener);
    return () => window.removeEventListener("switch-view", handler as EventListener);
  }, []);

  useEffect(() => {
    function handler(e: CustomEvent<{ open?: boolean }>) {
      const shouldOpen = Boolean(e.detail?.open);
      const rect = cardRef.current?.getBoundingClientRect();
      if (!rect) return;

      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }

      const origin = {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        borderRadius: 20,
      } satisfies CSSProperties;

      setOriginStyle(origin);

      if (shouldOpen) {
        setFullscreen(true);
        requestAnimationFrame(() => setExpanded(true));
      } else {
        setExpanded(false);
        closeTimerRef.current = setTimeout(() => {
          setFullscreen(false);
          setOriginStyle(null);
        }, 320);
      }
    }

    window.addEventListener("toggle-dashboard-fullscreen", handler as EventListener);
    return () => {
      window.removeEventListener("toggle-dashboard-fullscreen", handler as EventListener);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  return (
    <>
    <GlowWrap glow style={{ height: "100%", borderRadius: 20, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div ref={cardRef} className="right-col" style={{ flex: 1, minHeight: 0, height: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", borderRadius: 20, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)", opacity: fullscreen && expanded ? 0 : 1, transition: "opacity .24s ease" }}>
        {view === "dashboard" ? defaultContent : view === "actividad" ? <ActividadView items={actividadItems} /> : rcvContent}
      </div>
    </GlowWrap>
    {fullscreen && originStyle && (
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          zIndex: 70,
          top: expanded ? 70 : originStyle.top,
          left: expanded ? 20 : originStyle.left,
          width: expanded ? "calc(100vw - 40px)" : originStyle.width,
          height: expanded ? "calc(100vh - 90px)" : originStyle.height,
          borderRadius: expanded ? 20 : originStyle.borderRadius,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "inset 0 1px 0 var(--border),0 24px 80px rgba(0,0,0,.42),0 0 44px -10px rgba(232,85,62,.34)",
          opacity: expanded ? 1 : 0,
          overflow: "hidden",
          transition: "top .32s cubic-bezier(.22,1,.36,1),left .32s cubic-bezier(.22,1,.36,1),width .32s cubic-bezier(.22,1,.36,1),height .32s cubic-bezier(.22,1,.36,1),border-radius .32s cubic-bezier(.22,1,.36,1),opacity .24s ease",
        }}
      />
    )}
    </>
  );
}
