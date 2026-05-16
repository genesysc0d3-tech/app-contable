"use client";

import { useState } from "react";
import { X } from "@phosphor-icons/react";

interface Doc { id: string; nombre_archivo: string; tipo: string; estado: string; movimientos_detectados: number | null; created_at: string }
interface Status { label: string; color: string }

export default function DocCardModal({ doc, s, svgPath }: { doc: Doc; s: Status; svgPath: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="h-card" data-status={doc.estado} onClick={() => setOpen(true)}>
      <div className="h-front">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 6 }}>
          <path d={svgPath} />
        </svg>
        <div style={{ fontSize: 10, fontWeight: 600, color: s.color, marginBottom: 2 }}>{s.label}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%", padding: "0 4px" }}>{doc.nombre_archivo}</div>
        <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{doc.tipo.toUpperCase()}{doc.movimientos_detectados ? ` · ${doc.movimientos_detectados} mov` : ""}</div>
      </div>
      <div className="h-actions-wrap" onClick={(e) => e.stopPropagation()}>
        <button style={{ width: "100%", fontSize: 10, padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600, background: `${s.color}18`, color: s.color }}>
          ↔ Mapear · ○ Ver · ◎ Omitidos
        </button>
      </div>

      {open && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 20,
        }} onClick={() => setOpen(false)}>
          <div style={{
            background: "#1a1a24", borderRadius: 16, border: "1px solid #333",
            width: "100%", maxWidth: 480, maxHeight: "80vh", overflow: "auto",
            padding: 24, position: "relative", color: "#e8eaf0",
          }} onClick={(e) => e.stopPropagation()}>
            {/* Close X */}
            <button onClick={() => setOpen(false)} style={{
              position: "absolute", top: 12, right: 12, width: 28, height: 28,
              borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "none",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,0.5)", transition: "all .15s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}>
              <X size={16} />
            </button>

            {/* Header */}
            <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "flex-start" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                <path d={svgPath} />
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{doc.nombre_archivo}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{doc.tipo.toUpperCase()} · subido {new Date(doc.created_at).toLocaleDateString("es-CL")}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: s.color, background: `${s.color}15`, padding: "4px 12px", borderRadius: 20, whiteSpace: "nowrap", alignSelf: "flex-start" }}>{s.label}</span>
            </div>

            {/* Info grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
              <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 4 }}>MOVIMIENTOS</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{doc.movimientos_detectados ?? 0}</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginBottom: 4 }}>TIPO ARCHIVO</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{doc.tipo.toUpperCase()}</div>
              </div>
            </div>

            {/* Mapear (solo Excel) */}
            {doc.tipo === "excel" && (
              <div style={{ background: "rgba(180,240,39,0.06)", border: "1px solid rgba(180,240,39,0.15)", borderRadius: 10, padding: "14px 16px", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#b4f027", marginBottom: 6 }}>↔ Mapeo de columnas</div>
                <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: 0, lineHeight: 1.5 }}>
                  El sistema detectó automáticamente la estructura del archivo. Revisá el mapeo de columnas para asegurar una lectura correcta.
                </p>
              </div>
            )}

            {/* Omitidos */}
            <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 10, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", marginBottom: 6 }}>◎ Movimientos omitidos</div>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: 0, lineHeight: 1.5 }}>
                Transacciones que no se procesarán. Revisá los duplicados y confirmá si querés incluirlos.
              </p>
            </div>

            {/* Action button */}
            <button style={{
              width: "100%", padding: "10px 16px", borderRadius: 10, border: "none",
              background: "#b4f027", color: "#000", fontSize: 13, fontWeight: 600, cursor: "pointer",
              transition: "opacity .15s",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}>
              Ir a revisar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
