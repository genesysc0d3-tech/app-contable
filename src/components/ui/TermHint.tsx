"use client";

import type { ReactNode } from "react";

/**
 * Circulito "?" discreto que al hover/tap explica jerga tributaria en simple.
 * Invisible hasta que se necesita: no compite con el contenido.
 */
export default function TermHint({ children, width = 236, align = "left" }: {
  children: ReactNode;
  width?: number;
  align?: "left" | "right";
}) {
  return (
    <span className="th-wrap" style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      <style>{`
        .th-wrap .th-dot{width:13px;height:13px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;line-height:1;color:var(--text3);border:1px solid var(--border);background:transparent;cursor:help;transition:color .15s ease,border-color .15s ease;user-select:none}
        .th-wrap:hover .th-dot,.th-wrap:focus-within .th-dot{color:#E8553E;border-color:rgba(232,85,62,.45)}
        .th-wrap .th-tip{position:absolute;bottom:calc(100% + 8px);padding:9px 11px;border-radius:11px;background:rgba(15,16,20,.97);border:1px solid rgba(255,255,255,.1);box-shadow:0 16px 40px rgba(0,0,0,.4);color:rgba(255,255,255,.88);font-size:10px;font-weight:500;line-height:1.55;text-align:left;text-transform:none;letter-spacing:0;opacity:0;transform:translateY(3px);pointer-events:none;transition:opacity .16s ease,transform .16s ease;z-index:80}
        .th-wrap:hover .th-tip,.th-wrap:focus-within .th-tip{opacity:1;transform:translateY(0)}
      `}</style>
      <span className="th-dot" tabIndex={0} role="button" aria-label="Qué significa">?</span>
      <span className="th-tip" role="tooltip" style={{ width, ...(align === "right" ? { right: 0 } : { left: 0 }) }}>{children}</span>
    </span>
  );
}
