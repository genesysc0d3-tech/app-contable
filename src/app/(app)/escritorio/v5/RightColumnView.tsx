"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import GlowWrap from "./GlowWrap";
import ActividadView, { type ActividadItem } from "./ActividadView";
import SearchHistoryView from "./SearchHistoryView";
import type { SearchItem } from "@/lib/tree-structure";

export default function RightColumnView({
  defaultContent,
  actividadItems,
  rcvContent,
  searchHistoryItems,
  empresaNombre,
  empresaLogoUrl,
}: {
  defaultContent: ReactNode;
  actividadItems?: ActividadItem[];
  rcvContent?: ReactNode;
  searchHistoryItems?: SearchItem[];
  empresaNombre?: string;
  empresaLogoUrl?: string | null;
}) {
  const [view, setView] = useState<"dashboard" | "actividad" | "rcv">("dashboard");
  const viewRef = useRef(view);
  viewRef.current = view;
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [originStyle, setOriginStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    function handler(e: CustomEvent) {
      const v = (e.detail as string) ?? "";
      if (v === "actividad" || v === "rcv" || v === "dashboard") {
        if (v === viewRef.current) return;
        setView(v);
      }
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

  function slideStyle(v: "dashboard" | "actividad" | "rcv"): React.CSSProperties {
    const active = view === v;
    return {
      position: "absolute", inset: 0,
      opacity: active ? 1 : 0,
      pointerEvents: active ? "auto" : "none",
      zIndex: active ? 1 : 0,
      display: "flex", flexDirection: "column",
      transition: "opacity .28s cubic-bezier(.22,1,.36,1)",
    };
  }

  return (
    <>
    <GlowWrap glow style={{ height: "100%", borderRadius: 20, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div ref={cardRef} className="right-col" style={{ flex: 1, minHeight: 0, height: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", borderRadius: 20, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)", opacity: fullscreen && expanded ? 0 : 1, transition: "opacity .24s ease" }}>
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <div style={slideStyle("dashboard")}>{defaultContent}</div>
          <div style={slideStyle("actividad")}><ActividadView items={actividadItems} /></div>
          <div style={slideStyle("rcv")}>{rcvContent}</div>
        </div>
      </div>
    </GlowWrap>
    {fullscreen && originStyle && expanded && (
      <div
        style={{
          position: "fixed",
          zIndex: 70,
          top: 70,
          left: 20,
          width: "calc(100vw - 40px)",
          height: "calc(100vh - 90px)",
          borderRadius: 20,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "inset 0 1px 0 var(--border),0 24px 80px rgba(0,0,0,.42),0 0 44px -10px rgba(232,85,62,.34)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          opacity: expanded ? 1 : 0,
          transition: "opacity .24s ease",
        }}
      >
        {searchHistoryItems ? (
          <SearchHistoryView items={searchHistoryItems} empresaNombre={empresaNombre} empresaLogoUrl={empresaLogoUrl} />
        ) : (
          <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--text2)", fontSize: 12 }}>
            Sin datos de actividad
          </div>
        )}
      </div>
    )}
    </>
  );
}
