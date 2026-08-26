"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { type ExcelPreviewSheet } from "@/lib/excel/preview";
import GaleriaComprobante from "./GaleriaComprobante";

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
  const [albumImgs, setAlbumImgs] = useState<string[]>([]);

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: doc, error: docErr } = await supabase
          .from("documentos_subidos")
          .select("nombre_archivo, album_imagenes")
          .eq("id", documentoId)
          .single();
        if (docErr || !doc) throw new Error("Archivo no encontrado");
        if (cancelled) return;
        const nombre = doc.nombre_archivo ?? "Documento";
        setFileName(nombre);

        // Kind por extensión (sin bajar el blob). Bytes vía la ruta de servido
        // provider-aware (Supabase hoy, R2 cuando migre).
        const fk = fileKindOf(nombre, "");
        setKind(fk);
        const url = `/api/archivo/${documentoId}`;

        if (fk === "image") {
          // Foto suelta o álbum de Telegram → galería (zoom + flechas si hay varias).
          const album = Array.isArray(doc.album_imagenes) ? (doc.album_imagenes as unknown[]) : null;
          const imgs = album && album.length ? album.map((_, i) => `/api/archivo/${documentoId}?i=${i}`) : [url];
          if (!cancelled) setAlbumImgs(imgs);
        } else if (fk === "pdf") {
          if (!cancelled) setObjectUrl(url);
        } else {
          // Perf: xlsx (SheetJS, ~365KB) se carga RECIÉN al abrir un Excel — antes
          // viajaba en el bundle inicial del escritorio para todos, siempre.
          // El import type de ExcelPreviewSheet arriba no cuenta: los types se borran
          // al compilar; el módulo real entra solo por este import dinámico.
          const [res, { read }, { workbookToPreviewSheets }] = await Promise.all([
            fetch(url),
            import("xlsx"),
            import("@/lib/excel/preview"),
          ]);
          if (!res.ok) throw new Error("No se pudo descargar el archivo");
          const buffer = await res.arrayBuffer();
          if (cancelled) return;
          const workbook = read(buffer, { type: "array" });
          setSheets(workbookToPreviewSheets(workbook));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al leer archivo");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [documentoId]);

  const subtitle =
    kind === "pdf" ? "PDF" : sheets.length > 0 ? `${sheets.length} hoja${sheets.length !== 1 ? "s" : ""}` : "";

  // Imagen → lightbox: zoom in, contenido (no full-screen), fondo SOLO desenfocado
  // (sin oscurecer) y botón "Cerrar" abajo (frosted + fade).
  const esImagen = kind === "image" && albumImgs.length > 0 && !loading && !error;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", padding: 28,
        background: "rgba(0,0,0,.5)",
        backdropFilter: esImagen ? "none" : "blur(13px)", WebkitBackdropFilter: esImagen ? "none" : "blur(13px)",
      }}
    >
      <style>{`
        @keyframes vx-pulse{0%,100%{opacity:.4}50%{opacity:1}}
        @keyframes lbZoom{from{transform:scale(.9);opacity:0}to{transform:scale(1);opacity:1}}
        @keyframes lbFade{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
        .vx-table { border-collapse: collapse; font-size: 11px; font-family: var(--font-geist-mono), monospace; width: 100%; background: var(--surface); }
        .vx-table td, .vx-table th { padding: 4px 8px; border: 1px solid var(--border); white-space: nowrap; color: var(--text); text-align: left; }
        .vx-table th { background: var(--bg-muted); font-weight: 600; font-size: 10px; position: sticky; top: 0; z-index: 1; color: var(--text2); text-transform: uppercase; letter-spacing: .03em; }
        .vx-table tr:nth-child(even) { background: var(--bg-muted); }
        .vx-table tr:hover { background: rgba(232,85,62,.04); }
      `}</style>

      {/* Cerrar flotante arriba: solo para la tarjeta pdf/planilla (la imagen usa el de abajo) */}
      {!esImagen && !loading && !error && (
        <button onClick={onClose} title="Cerrar"
          style={{ position: "fixed", top: 18, right: 22, zIndex: 2, width: 34, height: 34, borderRadius: 9, border: "1px solid var(--border)", background: "color-mix(in srgb, var(--bg) 72%, transparent)", color: "var(--text2)", fontSize: 20, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>×</button>
      )}

      {error ? (
        <div onClick={(e) => e.stopPropagation()} style={{ textAlign: "center", color: "var(--red)", fontSize: 12 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ margin: "0 auto 8px" }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          {error}
        </div>
      ) : (loading || esImagen) ? (
        /* ── Pop-up de imagen/álbum: la CAJA aparece YA; adentro "Cargando imagen…" hasta que está lista. ── */
        <>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(88vw, 760px)", height: "80vh", position: "relative", background: "var(--surface2)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden", animation: "lbZoom .28s cubic-bezier(.22,1,.36,1)" }}>
            {esImagen ? (
              <GaleriaComprobante images={albumImgs} alt={fileName} />
            ) : (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, color: "var(--text2)", fontSize: 12 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--text3)", animation: "vx-pulse 1.2s ease infinite" }} />
                Cargando imagen…
              </div>
            )}
          </div>
          <button onClick={onClose}
            style={{ position: "fixed", bottom: 30, left: "50%", zIndex: 3, display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 22px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--text) 16%, transparent)", background: "color-mix(in srgb, var(--bg) 40%, transparent)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 10px 34px rgba(0,0,0,.3)", animation: "lbFade .32s ease .08s both" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            Cerrar
          </button>
        </>
      ) : (
        /* ── PDF / planilla → tarjeta con header + tabs + footer ── */
        <div onClick={(e) => e.stopPropagation()}
          style={{ width: "min(1280px, 96vw)", maxHeight: "88vh", overflow: "hidden", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 30px 90px rgba(0,0,0,.45), inset 0 1px 0 var(--border)", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: "rgba(232,85,62,.12)", color: "var(--accent)", flexShrink: 0 }}>
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
                    style={{ padding: "5px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: activeSheet === i ? "1px solid rgba(232,85,62,.3)" : "1px solid var(--border)", background: activeSheet === i ? "rgba(232,85,62,.1)" : "var(--bg-muted)", color: activeSheet === i ? "var(--accent)" : "var(--text2)", transition: "all .15s" }}>{s.name}</button>
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
