"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/components/Toast";
import CartolaMapperDragDrop from "@/components/mapping/CartolaMapperDragDrop";
import { listFormatosCartola, type FormatoCartolaGuardado } from "./actions";

export default function EmpresaFormatoCartola({ empresaId }: { empresaId: string }) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{
    sheetName: string; fingerprint: string; totalRows: number; cols: number;
    rows: string[][]; txStart: number; hasHeader: boolean;
  } | null>(null);
  const [formatos, setFormatos] = useState<FormatoCartolaGuardado[] | null>(null);

  const cargarFormatos = useCallback(() => {
    listFormatosCartola()
      .then((r) => { setFormatos(r.ok && r.formatos ? r.formatos : []); })
      .catch(() => { setFormatos([]); });
  }, []);

  useEffect(() => { cargarFormatos(); }, [cargarFormatos]);

  async function handleFile(file: File) {
    const nombreArchivo = file.name.toLowerCase();
    if (!nombreArchivo.endsWith(".xlsx") && !nombreArchivo.endsWith(".xls") && !nombreArchivo.endsWith(".csv")) {
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
        border: "1px solid var(--border, rgba(255,255,255,.06))",
        background: "color-mix(in srgb, var(--text, #e8eaf0) 3%, transparent)",
        boxShadow: "inset 0 1px 0 var(--border, rgba(255,255,255,.06))",
      }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 36px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
            <div style={{
              width: 48, height: 48, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 16,
              border: "1px solid color-mix(in srgb, var(--blue, #5b9cf6) 25%, transparent)",
              background: "color-mix(in srgb, var(--blue, #5b9cf6) 12%, transparent)",
              color: "var(--blue, #5b9cf6)",
            }}>
              <svg viewBox="0 0 24 24" fill="none" width={20} height={20}>
                <path d="M7 3h7l4 4v14H7V3Z" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M14 3v5h5M9 13h6M9 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "var(--text, #e8eaf0)" }}>
                  Formatos de cartola
                </h3>
              </div>
              <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "var(--text3, #697080)" }}>
                Opcional — la mayoría de los bancos se leen solos. Si el tuyo no, sube una cartola de ejemplo y enséñale a la app qué hay en cada columna (una sola vez).
              </p>
            </div>
          </div>

          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
            borderRadius: 16,
            border: "1px dashed color-mix(in srgb, var(--blue, #5b9cf6) 25%, transparent)",
            background: "color-mix(in srgb, var(--blue, #5b9cf6) 6%, transparent)",
            padding: "16px 20px",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center", color: "var(--blue, #5b9cf6)", background: "color-mix(in srgb, var(--blue, #5b9cf6) 12%, transparent)", fontSize: 18 }}>☁</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 760, color: "var(--text, #e8eaf0)" }}>Sube un archivo de ejemplo</div>
                <div style={{ marginTop: 2, fontSize: 12, color: "var(--text3, #697080)" }}>Excel (.xlsx, .xls) o CSV</div>
              </div>
            </div>
            <button onClick={() => inputRef.current?.click()} disabled={uploading}
              style={{
                height: 40, borderRadius: 10,
                border: "1px solid var(--border, rgba(255,255,255,.06))",
                background: "color-mix(in srgb, var(--text, #e8eaf0) 5%, transparent)",
                color: uploading ? "var(--text3, #697080)" : "var(--text, #e8eaf0)",
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

          {/* Formatos configurados */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 760, color: "var(--text, #e8eaf0)", marginBottom: 8 }}>
              Formatos configurados
            </div>
            {formatos === null ? (
              <div style={{ fontSize: 12, color: "var(--text3, #697080)" }}>Cargando…</div>
            ) : formatos.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text3, #697080)" }}>
                Aún no has enseñado ningún formato — la mayoría de los bancos se leen solos.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {formatos.map((f) => (
                  <div key={f.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                    borderRadius: 12,
                    border: "1px solid var(--border, rgba(255,255,255,.06))",
                    background: "color-mix(in srgb, var(--text, #e8eaf0) 3%, transparent)",
                    padding: "10px 14px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: "var(--green, #34d46e)" }} />
                      <span style={{ fontSize: 13, fontWeight: 650, color: "var(--text, #e8eaf0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.nombre || "Formato sin nombre"}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--text3, #697080)", flexShrink: 0 }}>
                      {new Date(f.createdAt).toLocaleDateString("es-CL", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <CartolaMapperDragDrop
          empresaId={empresaId}
          onClose={() => setPreview(null)}
          onSaved={() => { setPreview(null); cargarFormatos(); }}
          previewData={preview}
        />
      )}
    </>
  );
}
