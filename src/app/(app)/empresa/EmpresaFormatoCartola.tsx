"use client";

import { useState } from "react";
import CartolaMapperDragDrop from "@/components/mapping/CartolaMapperDragDrop";

export default function EmpresaFormatoCartola({ empresaId }: { empresaId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div style={{
        borderRadius: 22,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.025)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.035)",
      }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 36px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
            <div style={{
              width: 48, height: 48, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 16,
              border: "1px solid rgba(96,165,250,0.25)",
              background: "rgba(96,165,250,0.12)",
              color: "#93C5FD",
            }}>
              <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
                <path d="M7 3h7l4 4v14H7V3Z" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M14 3v5h5M9 13h6M9 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "#ffffff" }}>
                  Formatos de cartola
                </h3>
                <span style={{
                  display: "inline-block", borderRadius: 9999,
                  border: "1px solid rgba(96,165,250,0.20)",
                  background: "rgba(96,165,250,0.13)",
                  padding: "4px 10px", fontSize: 11, fontWeight: 700,
                  color: "#93C5FD",
                }}>
                  2 formatos
                </span>
              </div>
              <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "rgba(255,255,255,0.45)" }}>
                Sube ejemplos de tus cartolas y mapéalos automáticamente.
              </p>
            </div>
          </div>

          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
            borderRadius: 16,
            border: "1px dashed rgba(147,197,253,0.25)",
            background: "rgba(96,165,250,0.045)",
            padding: "16px 20px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                display: "grid", placeItems: "center",
                color: "#93C5FD", background: "rgba(96,165,250,0.12)",
                fontSize: 18,
              }}>
                ☁
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 760, color: "#eaf0f8" }}>
                  Sube un archivo de ejemplo
                </div>
                <div style={{ marginTop: 2, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>
                  Excel (.xlsx, .xls) o CSV
                </div>
              </div>
            </div>
            <button onClick={() => setOpen(true)}
              style={{
                height: 40, borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.13)",
                background: "rgba(255,255,255,0.045)",
                color: "#eff3fa",
                padding: "0 16px",
                fontWeight: 760, fontSize: 13,
                display: "inline-flex", alignItems: "center", gap: 9,
                cursor: "pointer", whiteSpace: "nowrap",
              }}>
              ⇧ Subir archivo
            </button>
          </div>
        </div>
      </div>

      {open && (
        <CartolaMapperDragDrop
          empresaId={empresaId}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </>
  );
}
