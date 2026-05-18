"use client";

import { useState, useRef } from "react";
import { useToast } from "@/components/Toast";
import CartolaMapperDragDrop from "@/components/mapping/CartolaMapperDragDrop";

export default function EmpresaFormatoCartola({ empresaId }: { empresaId: string }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{
    sheetName: string; fingerprint: string; totalRows: number; cols: number;
    rows: string[][]; txStart: number; hasHeader: boolean;
  } | null>(null);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls") && !file.name.endsWith(".csv")) {
      toast("Solo archivos Excel o CSV", "error");
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const res = await fetch("/api/preview-formato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: btoa(bin), nombre: file.name }),
      });
      const d = await res.json();
      if (d.ok) {
        setPreview(d);
      } else {
        toast(d.error ?? "Error al procesar", "error");
      }
    } catch {
      toast("Error al leer el archivo", "error");
    }
    setUploading(false);
  }

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
                }}>2 formatos</span>
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
              <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", color: "#93C5FD", background: "rgba(96,165,250,0.12)", fontSize: 18 }}>☁</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 760, color: "#eaf0f8" }}>Sube un archivo de ejemplo</div>
                <div style={{ marginTop: 2, fontSize: 12, color: "rgba(255,255,255,0.45)" }}>Excel (.xlsx, .xls) o CSV</div>
              </div>
            </div>
            <button onClick={() => inputRef.current?.click()} disabled={uploading}
              style={{
                height: 40, borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.13)",
                background: "rgba(255,255,255,0.045)",
                color: uploading ? "rgba(255,255,255,0.3)" : "#eff3fa",
                padding: "0 16px",
                fontWeight: 760, fontSize: 13,
                display: "inline-flex", alignItems: "center", gap: 9,
                cursor: uploading ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                opacity: uploading ? 0.5 : 1,
              }}>
              {uploading ? "Subiendo..." : "⇧ Subir archivo"}
            </button>
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
        </div>
      </div>

      {preview && (
        <CartolaMapperDragDrop
          empresaId={empresaId}
          onClose={() => setPreview(null)}
          onSaved={() => setPreview(null)}
          previewData={preview}
        />
      )}
    </>
  );
}
