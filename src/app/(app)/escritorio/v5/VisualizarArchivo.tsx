"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { workbookToPreviewSheets, type ExcelPreviewSheet } from "@/lib/excel/preview";
import * as XLSX from "xlsx";

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

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  useEffect(() => {
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

        setFileName(doc.nombre_archivo ?? "Documento");

        const { data: file, error: dlErr } = await supabase.storage
          .from("documentos")
          .download(doc.storage_path);

        if (dlErr || !file) {
          throw new Error("No se pudo descargar el archivo");
        }

        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });

        setSheets(workbookToPreviewSheets(workbook));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error al leer archivo");
      } finally {
        setLoading(false);
      }
    })();
  }, [documentoId]);

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center",
        padding: 24, background: "rgba(0,0,0,.58)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <style>{`
        .vx-table { border-collapse: collapse; font-size: 11px; font-family: 'DM Sans','Inter',monospace; width: 100%; background: var(--surface); }
        .vx-table td, .vx-table th { padding: 4px 8px; border: 1px solid var(--border); white-space: nowrap; color: var(--text); text-align: left; }
        .vx-table th { background: var(--bg-muted); font-weight: 600; font-size: 10px; position: sticky; top: 0; z-index: 1; color: var(--text2); text-transform: uppercase; letter-spacing: .03em; }
        .vx-table tr:nth-child(even) { background: var(--bg-muted); }
        .vx-table tr:hover { background: rgba(232,85,62,.04); }
      `}</style>
      <div
        style={{
          width: "min(1280px, 96vw)", maxHeight: "88vh",
          overflow: "hidden", borderRadius: 20,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          boxShadow: "0 30px 90px rgba(0,0,0,.45), inset 0 1px 0 var(--border)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* HEADER */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, display: "grid", placeItems: "center",
            background: "rgba(232,85,62,.12)", color: "#E8553E", flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", letterSpacing: "-.02em" }}>{fileName}</div>
            <div style={{ fontSize: 10, color: "var(--text2)", marginTop: 2 }}>
              {sheets.length > 0 && `${sheets.length} hoja${sheets.length !== 1 ? "s" : ""}`}
            </div>
          </div>

          {/* SHEET TABS */}
          {sheets.length > 1 && (
            <div style={{ display: "flex", gap: 4 }}>
              {sheets.map((s, i) => (
                <button
                  key={s.name}
                  onClick={() => setActiveSheet(i)}
                  style={{
                    padding: "5px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer",
                    border: activeSheet === i ? "1px solid rgba(232,85,62,.3)" : "1px solid var(--border)",
                    background: activeSheet === i ? "rgba(232,85,62,.1)" : "var(--bg-muted)",
                    color: activeSheet === i ? "#E8553E" : "var(--text2)",
                    transition: "all .15s",
                  }}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg-muted)", color: "var(--text2)", fontSize: 18, lineHeight: 1,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>

        {/* BODY */}
        <div style={{ flex: 1, overflow: "auto", padding: 0, scrollbarWidth: "thin" }}>
          {loading ? (
            <div style={{ padding: 80, textAlign: "center", color: "var(--text2)", fontSize: 12 }}>
              <div style={{ width: 200, height: 12, borderRadius: 6, background: "var(--bg-muted)", margin: "0 auto 12px", animation: "vx-pulse 1.2s ease infinite" }} />
              <style>{`@keyframes vx-pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
              Cargando archivo...
            </div>
          ) : error ? (
            <div style={{ padding: 80, textAlign: "center", color: "#ef4444", fontSize: 12 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ margin: "0 auto 8px" }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          ) : (
            <div className="vx-scroll" style={{ padding: "4px 0", minHeight: 200, overflowX: "auto" }}>
              <table className="vx-table">
                <tbody>
                  {(sheets[activeSheet]?.rows ?? []).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, colIndex) => (
                        <td key={colIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* FOOTER */}
        {sheets[activeSheet] && (
          <div style={{ padding: "8px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 12, fontSize: 10, color: "var(--text2)", flexShrink: 0 }}>
            <span>{sheets[activeSheet].rowCount} filas</span>
            <span>·</span>
            <span>{sheets[activeSheet].colCount} columnas</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
