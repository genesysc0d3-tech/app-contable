"use client";

import { useEffect, useState, type ReactNode } from "react";
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

  useEffect(() => {
    function handler(e: CustomEvent) {
      const v = (e.detail as string) ?? "";
      if (v === "actividad" || v === "rcv" || v === "dashboard") setView(v);
    }
    window.addEventListener("switch-view", handler as EventListener);
    return () => window.removeEventListener("switch-view", handler as EventListener);
  }, []);

  return (
    <GlowWrap glow style={{ height: "100%", borderRadius: 20, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div className="right-col" style={{ flex: 1, minHeight: 0, height: "100%", display: "flex", flexDirection: "column", background: "var(--surface)", borderRadius: 20, border: "1px solid var(--border)", overflow: "hidden", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)" }}>
        {view === "dashboard" ? defaultContent : view === "actividad" ? <ActividadView items={actividadItems} /> : rcvContent}
      </div>
    </GlowWrap>
  );
}
