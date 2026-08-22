"use client";

import { useState, useRef, useCallback } from "react";
import { useToast } from "@/components/Toast";
import { classifyFile } from "@/lib/file-classifier";
import type { FileCategory } from "@/lib/file-classifier";
import { MAX_PROCESAR_UPLOAD_BYTES } from "@/lib/upload/process-upload-validation";

interface QueuedFile {
  id: string; file: File; category: FileCategory;
  customName: string; error?: string;
}

let idCounter = 0;

// El backend despacha el parser según este tipo: parseExcel, pdf-parse,
// OCR OpenCode para fotos/capturas, o texto plano (csv).
function tipoForFile(file: File): { tipo: string; mime: string } {
  const ext = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "";
  if (ext === "pdf") return { tipo: "pdf", mime: "application/pdf" };
  if (ext === "csv") return { tipo: "csv", mime: "text/csv" };
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
    return { tipo: "imagen", mime: file.type || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg") };
  }
  return { tipo: "excel", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

export default function DropzoneUpload({ onUploaded }: { onUploaded?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const { toast } = useToast();

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const queued: QueuedFile[] = await Promise.all(
      files.map(async (f) => ({
        id: `q-${++idCounter}`, file: f,
        category: await classifyFile(f),
        customName: f.name.replace(/\.[^.]+$/, ""),
        // El server rechaza >10MB (413): se marca aquí y no se envía
        error: f.size > MAX_PROCESAR_UPLOAD_BYTES ? "Supera 10MB — no se subirá" : undefined,
      }))
    );
    setQueue(prev => [...prev, ...queued]);
  }, []);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) addFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeFile(id: string) {
    setQueue(prev => prev.filter(f => f.id !== id));
  }

  function startEdit(f: QueuedFile) { setEditingId(f.id); setEditName(f.customName); }

  function saveName(id: string) {
    setQueue(prev => prev.map(f => f.id === id ? { ...f, customName: editName || f.file.name } : f));
    setEditingId(null);
  }

  async function handleUploadAll() {
    // Los >10MB quedan marcados en la cola y no se envían
    const subibles = queue.filter(q => q.file.size <= MAX_PROCESAR_UPLOAD_BYTES);
    if (!subibles.length) return;
    setUploading(true);
    let ok = 0;
    let dup = 0;
    let dupEnCurso = 0;
    let dupError = 0;
    const subidos = new Set<string>();
    const fallidos = new Map<string, string>();
    for (const q of subibles) {
      try {
        const arrayBuf = await q.file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        const { tipo, mime } = tipoForFile(q.file);
        const res = await fetch("/api/subir-procesar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: q.customName + (q.file.name.match(/\.[^.]+$/) ?? ""),
            base64,
            tipo,
            mime,
          }),
        });
        const data = await res.json().catch(() => null);
        if (data?.ok) {
          subidos.add(q.id);
          // El server deduplica por hash de contenido: re-subir el MISMO archivo NO
          // crea otro documento (evita duplicar movimientos/boletas). Se avisa aparte
          // para que el usuario entienda por qué "no aparece nuevo" y ve el de antes.
          if (data.ya_procesado) {
            if (data.estado_previo === "procesando" || data.estado_previo === "subido") dupEnCurso++;
            else if (data.estado_previo === "error") dupError++;
            else dup++;
          } else ok++;
        }
        else {
          fallidos.set(q.id,
            res.status === 413 ? "El archivo supera 10MB"
            : res.status === 415 ? "Tipo de archivo no permitido"
            : res.status === 429 ? "Demasiados archivos seguidos — espera un minuto y reintenta"
            : "No se pudo subir. Intenta de nuevo.");
        }
      } catch { fallidos.set(q.id, "Error de red. Revisa tu conexión e intenta de nuevo."); }
    }
    setUploading(false);
    // Conserva en la cola los que fallaron, con su error visible
    setQueue(prev => prev
      .filter(f => !subidos.has(f.id))
      .map(f => fallidos.has(f.id) ? { ...f, error: fallidos.get(f.id) } : f));
    if (fallidos.size > 0) {
      toast(fallidos.size > 1 ? `${fallidos.size} archivos no se pudieron subir. Revisa la cola.` : "1 archivo no se pudo subir. Revisa la cola.", "error");
    }
    if (dup > 0) {
      toast(
        dup > 1
          ? `${dup} archivos ya los habías subido antes (mismo contenido): no se volvieron a subir para no duplicar.`
          : "Ya habías subido este archivo antes (mismo contenido): no se volvió a subir para no duplicar — estás viendo el de esa vez.",
        "info",
      );
    }
    if (dupEnCurso > 0) {
      toast("Ese archivo ya se está procesando — dale un momento, no hace falta subirlo de nuevo.", "info");
    }
    if (dupError > 0) {
      toast("Ese archivo ya está en la mesa con error. Aprieta ↻ Reintentar en su tarjeta en vez de subirlo de nuevo.", "info");
    }
    if (ok > 0) toast(`${ok} subido${ok > 1 ? "s" : ""}`);
    if (ok > 0 || dup > 0 || dupEnCurso > 0 || dupError > 0) onUploaded?.();
  }

  const numSubibles = queue.filter(q => q.file.size <= MAX_PROCESAR_UPLOAD_BYTES).length;

  return (
    <>
      <input ref={inputRef} type="file" accept=".xls,.xlsx,.pdf,.csv,.png,.jpg,.jpeg,.webp" multiple
        style={{ display: "none" }} onChange={handleInput} />

      <div className="dz" role="button" tabIndex={uploading ? -1 : 0}
        aria-label="Subir cartola o comprobante: Excel, PDF, CSV o foto (máx 10MB)"
        aria-disabled={uploading || undefined}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !uploading) { e.preventDefault(); inputRef.current?.click(); } }}
        onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files); }}
        style={{ cursor: "pointer", opacity: uploading ? .6 : 1, ...(dragOver ? { borderColor: "rgba(180,240,39,.45)", background: "rgba(180,240,39,.04)" } : null) }}>
        <div className="dz-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14m-7-7l7-7 7 7"/></svg>
        </div>
        <div className="dz-txt">
          <h4>{uploading ? "Subiendo..." : dragOver ? "Suelta aquí" : "Arrastra tu archivo aquí"}</h4>
          <p>Excel, PDF, CSV o foto de cartola · Máx 10MB</p>
        </div>
      </div>

      {queue.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 9, color: "var(--text2)", fontWeight: 500 }}>
              Archivos pendientes
          </div>
          {queue.map(q => {
            const isGrande = q.category === "grande";
            return (
              <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6, background: "color-mix(in srgb, var(--text) 2%, transparent)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === q.id ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        style={{ flex: 1, fontSize: 10, background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text)", padding: "2px 6px" }} />
                      <button onClick={() => saveName(q.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--green)", fontSize: 10 }}>✓</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {isGrande ? `${q.customName} (${(q.file.size / 1024 / 1024).toFixed(1)} MB)` : q.customName}
                      </div>
                      <div style={{ fontSize: 8, color: q.error ? "var(--accent)" : isGrande ? "var(--amber)" : "var(--text2)" }}>
                        {q.error ?? (isGrande ? "Procesa solo" : `${(q.file.size / 1024).toFixed(0)} KB`)}
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => editingId === q.id ? saveName(q.id) : startEdit(q)}
                  style={{ width: 16, height: 16, borderRadius: 3, border: "none", cursor: "pointer", fontSize: 8, background: "transparent", color: "var(--text2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  ✎
                </button>
                <button onClick={() => removeFile(q.id)}
                  style={{ width: 16, height: 16, borderRadius: 3, border: "none", cursor: "pointer", fontSize: 9, background: "transparent", color: "var(--text2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  ✕
                </button>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button onClick={handleUploadAll} disabled={uploading || numSubibles === 0}
              style={{
                flex: 1, border: "none", borderRadius: 6, background: "linear-gradient(135deg,var(--lime),var(--green))",
                padding: "7px 10px", fontSize: 10, fontWeight: 600, color: "var(--bg)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                opacity: uploading || numSubibles === 0 ? .6 : 1, transition: "all .2s",
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7"/></svg>
              {uploading ? "Subiendo..." : `Subir todo (${numSubibles} archivo${numSubibles !== 1 ? "s" : ""})`}
            </button>
            <button onClick={() => setQueue([])}
              style={{ padding: "7px 12px", border: "none", borderRadius: 6, background: "var(--surface2)", fontSize: 10, fontWeight: 600, color: "color-mix(in srgb, var(--text) 45%, transparent)", cursor: "pointer" }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
