"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { workbookToPreviewSheets, type ExcelPreviewSheet } from "@/lib/excel/preview";
import * as XLSX from "xlsx";

type FileKind = "sheet" | "image" | "pdf";

function fileKindOf(name: string, mime: string): FileKind {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "bmp", "tiff"].includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  return "sheet";
}

export default function VisualizarArchivo({
  documentoId,
  onClose,
}: {
  documentoId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<ExcelPreviewSheet[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [fileName, setFileName] = useState("");
  const [kind, setKind] = useState<FileKind>("sheet");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let createdUrl: string | null = null;
    (async () => {
      try {
        const { data: doc, error: docErr } = await supabase
          .from("documentos_subidos")
          .select("storage_path, nombre_archivo")
          .eq("id", documentoId)
          .single();

        if (docErr || !doc?.storage_path) {
          throw new Error("Archivo no encontrado");
        }
        if (cancelled) return;
        setFileName(doc.nombre_archivo ?? "Documento");

        const { data: file, error: dlErr } = await supabase.storage
          .from("documentos")
          .download(doc.storage_path);

        if (dlErr || !file) {
          throw new Error("No se pudo descargar el archivo");
        }
        if (cancelled) return;

        const fk = fileKindOf(doc.nombre_archivo ?? doc.storage_path, file.type);
        setKind(fk);

        if (fk === "image" || fk === "pdf") {
          createdUrl = URL.createObjectURL(file);
          if (cancelled) {
            URL.revokeObjectURL(createdUrl);
            return;
          }
          setObjectUrl(createdUrl);
        } else {
          const buffer = await file.arrayBuffer();
          if (cancelled) return;
          const workbook = XLSX.read(buffer, { type: "array" });
          setSheets(workbookToPreviewSheets(workbook));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al leer archivo");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [documentoId]);

  const subtitle =
    kind === "pdf" ? "PDF" : sheets.length > 0 ? `${sheets.length} hoja${sheets.length !== 1 ? "s" : ""}` : "";

  // Imagen → lightbox: zoom in, contenido (no full-screen), fondo SOLO desenfocado
  // (sin oscurecer) y botón "Cerrar" abajo (frosted + fade).
  const esImagen = kind === "image" && !!objectUrl && !loading && !error;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 28,
        background: esImagen ? "transparent" : "rgba(0,0,0,.62)",
        backdropFilter: esImagen ? "none" : "blur(13px)", WebkitBackdropFilter: esImagen ? "none" : "blur(13px)",
      }}
    >
      <style>{`
        @keyframes vx-pulse{0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes lbZoom{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
        @keyframes lbFade{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
        .vx-table { border-collapse: collapse; font-size: 11px; font-family: 'DM Sans','Inter',monospace; width: 100%; background: var(--surface); }
        .vx-table td, .vx-table th { padding: 4px 8px; border: 1px solid var(--border); white-space: nowrap; color: var(--text); text-align: left; }
        .vx-table th { background: var(--bg-muted); font-weight: 600; font-size: 10px; position: sticky; top: 0; z-index: 1; color: var(--text2); text-transform: uppercase; letter-spacing: .03em; }
        .vx-table tr:nth-child(even) { background: var(--bg-muted); }
        .vx-table tr:hover { background: rgba(232,85,62,.04); }
      `}</style>

      {/* Cerrar flotante arriba (solo para card/pdf/planilla) */}
      {!esImagen && (
        <button onClick={onClose} title="Cerrar"
          style={{ position: "fixed", top: 18, right: 22, zIndex: 2, width: 34, height: 34, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(20,20,24,.72)", color: "var(--text2)", fontSize: 20, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>×</button>
      )}

      {loading ? (
        <div onClick={(e) => e.stopPropagation()} style={{ textAlign: "center", color: "var(--text2)", fontSize: 12 }}>
          <div style={{ width: 180, height: 11, borderRadius: 6, background: "var(--bg-muted)", margin: "0 auto 12px", animation: "vx-pulse 1.2s ease infinite" }} />
          Cargando…
        </div>
      ) : error ? (
        <div onClick={(e) => e.stopPropagation()} style={{ textAlign: "center", color: "#ef4444", fontSize: 12 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ margin: "0 auto 8px" }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {error}
        </div>
      ) : esImagen ? (
        /* ── Imagen → lightbox: zoom, contenida, fondo solo desenfocado ── */
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img onClick={(e) => e.stopPropagation()} src={objectUrl ?? ""} alt={fileName}
            style={{ maxWidth: "74vw", maxHeight: "78vh", borderRadius: 16, objectFit: "contain", boxShadow: "0 30px 90px rgba(0,0,0,.5)", display: "block", animation: "lbZoom .28s cubic-bezier(.22,1,.36,1)" }} />
          <button onClick={onClose}
            style={{ position: "fixed", bottom: 30, left: "50%", zIndex: 3, display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 22px", borderRadius: 999, border: "1px solid rgba(255,255,255,.16)", background: "rgba(28,28,34,.4)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 10px 34px rgba(0,0,0,.3)", animation: "lbFade .32s ease .08s both" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            Cerrar
          </button>
        </>
      ) : (
        /* ── PDF / planilla → tarjeta con header + tabs + footer ── */
        <div onClick={(e) => e.stopPropagation()}
          style={{ width: "min(1280px, 96vw)", maxHeight: "88vh", overflow: "hidden", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 30px 90px rgba(0,0,0,.45), inset 0 1px 0 var(--border)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: "rgba(232,85,62,.12)", color: "#E8553E", flexShrink: 0 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</div>
              <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 2 }}>{subtitle}</div>
            </div>
            {kind === "sheet" && sheets.length > 1 && (
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                {sheets.map((s, i) => (
                  <button key={s.name} onClick={() => setActiveSheet(i)}
                    style={{ padding: "5px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: activeSheet === i ? "1px solid rgba(232,85,62,.3)" : "1px solid var(--border)", background: activeSheet === i ? "rgba(232,85,62,.1)" : "var(--bg-muted)", color: activeSheet === i ? "#E8553E" : "var(--text2)", transition: "all .15s" }}>{s.name}</button>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: 0, scrollbarWidth: "thin" }}>
            {kind === "pdf" ? (
              objectUrl ? <iframe src={objectUrl} title={fileName} style={{ width: "100%", height: "78vh", border: 0, background: "#fff" }} /> : null
            ) : (
              <div className="vx-scroll" style={{ padding: "4px 0", minHeight: 200, overflowX: "auto" }}>
                <table className="vx-table">
                  <tbody>
                    {(sheets[activeSheet]?.rows ?? []).map((row, rowIndex) => (
                      <tr key={rowIndex}>{row.map((cell, colIndex) => (<td key={colIndex}>{cell}</td>))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {kind === "sheet" && sheets[activeSheet] && (
            <div style={{ padding: "8px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 12, fontSize: 10, color: "var(--text2)", flexShrink: 0 }}>
              <span>{sheets[activeSheet].rowCount} filas</span><span>·</span><span>{sheets[activeSheet].colCount} columnas</span>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
}
