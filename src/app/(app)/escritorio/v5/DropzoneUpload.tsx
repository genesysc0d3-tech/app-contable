"use client";

import { useState, useRef, useCallback } from "react";
import { useToast } from "@/components/Toast";
import { classifyFile, BADGE_COLORS } from "@/lib/file-classifier";
import type { FileCategory } from "@/lib/file-classifier";

interface QueuedFile {
  id: string; file: File; category: FileCategory;
  group: number; customName: string; error?: string;
}

const BADGE: Record<number, string> = {
  1: "bg-[#E8553E] text-white", 2: "bg-[#3B82F6] text-white",
  3: "bg-[#22C55E] text-white", 4: "bg-[#7C3AED] text-white",
  5: "bg-[#F59E0B] text-white",
};

let idCounter = 0;

// El backend despacha el parser según este tipo: parseExcel, pdf-parse,
// OCR Mistral para fotos/capturas, o texto plano (csv).
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
  const { toast } = useToast();

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const queued: QueuedFile[] = await Promise.all(
      files.map(async (f) => ({
        id: `q-${++idCounter}`, file: f,
        category: await classifyFile(f), group: 1,
        customName: f.name.replace(/\.[^.]+$/, ""),
      }))
    );
    setQueue(prev => [...prev, ...queued]);
  }, []);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) addFiles(e.target.files);
    if (inputRef.current) inputRef.current.value = "";
  }

  function cycleGroup(id: string) {
    setQueue(prev => prev.map(f => f.id !== id || f.category === "grande" ? f : { ...f, group: f.group >= 5 ? 1 : f.group + 1 }));
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
    if (!queue.length) return;
    setUploading(true);
    let ok = 0, fail = 0;
    for (const q of queue) {
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
        const data = await res.json();
        if (data.ok) ok++;
        else { fail++; toast(`No se pudo subir "${q.customName}". Intenta de nuevo o revisa el archivo.`, "error"); }
      } catch { fail++; toast(`Error de red subiendo "${q.customName}".`, "error"); }
    }
    setUploading(false);
    setQueue([]);
    if (ok > 0) { toast(`${ok} subido${ok > 1 ? "s" : ""}`); onUploaded?.(); }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".xls,.xlsx,.pdf,.csv,.png,.jpg,.jpeg,.webp" multiple
        style={{ display: "none" }} onChange={handleInput} />

      <div className="dz" onClick={() => inputRef.current?.click()}
        style={{ cursor: "pointer", opacity: uploading ? .6 : 1 }}>
        <div className="dz-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14m-7-7l7-7 7 7"/></svg>
        </div>
        <div className="dz-txt">
          <h4>{uploading ? "Subiendo..." : "Arrastra tu archivo aquí"}</h4>
          <p>Excel, PDF, CSV o foto de cartola · Máx 20MB</p>
        </div>
      </div>

      {queue.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 9, color: "var(--text2)", fontWeight: 500 }}>
              Archivos pendientes
              <span title="Grupos de color (1-5) para agrupar capturas. Haz clic en el badge."
                style={{ marginLeft: 4, width: 13, height: 13, borderRadius: "50%", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 7, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "help" }}>?</span>
          </div>
          {queue.map(q => {
            const badgeClass = BADGE[q.group] ?? BADGE[1];
            const isGrande = q.category === "grande";
            return (
              <div key={q.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6, background: "rgba(255,255,255,.02)" }}>
                <button onClick={() => cycleGroup(q.id)} disabled={isGrande}
                  className={badgeClass}
                  style={{ width: 22, height: 22, borderRadius: "50%", border: "none", cursor: isGrande ? "not-allowed" : "pointer", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: isGrande ? .5 : 1 }}>
                  {isGrande ? "⚡" : q.group}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === q.id ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        style={{ flex: 1, fontSize: 10, background: "var(--bg-muted)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 4, color: "var(--text)", padding: "2px 6px" }} />
                      <button onClick={() => saveName(q.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#22c55e", fontSize: 10 }}>✓</button>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 10, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {isGrande ? `${q.customName} (${(q.file.size / 1024 / 1024).toFixed(1)} MB)` : q.customName}
                      </div>
                      <div style={{ fontSize: 8, color: isGrande ? "#f59e0b" : "var(--text2)" }}>
                        {isGrande ? "Procesa solo" : `Grupo ${q.group} · ${(q.file.size / 1024).toFixed(0)} KB`}
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => editingId === q.id ? saveName(q.id) : startEdit(q)}
                  style={{ width: 16, height: 16, borderRadius: 3, border: "none", cursor: "pointer", fontSize: 8, background: "transparent", color: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  ✎
                </button>
                <button onClick={() => removeFile(q.id)}
                  style={{ width: 16, height: 16, borderRadius: 3, border: "none", cursor: "pointer", fontSize: 9, background: "transparent", color: "rgba(255,255,255,.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  ✕
                </button>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button onClick={handleUploadAll} disabled={uploading}
              style={{
                flex: 1, border: "none", borderRadius: 6, background: "linear-gradient(135deg,#b4f027,#22c55e)",
                padding: "7px 10px", fontSize: 10, fontWeight: 600, color: "#000", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                opacity: uploading ? .6 : 1, transition: "all .2s",
              }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7"/></svg>
              {uploading ? "Subiendo..." : `Subir todo (${queue.length} archivo${queue.length > 1 ? "s" : ""})`}
            </button>
            <button onClick={() => setQueue([])}
              style={{ padding: "7px 12px", border: "none", borderRadius: 6, background: "#1a1c24", fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,.4)", cursor: "pointer" }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
