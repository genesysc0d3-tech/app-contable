"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { classifyFile } from "@/lib/file-classifier";
import type { FileCategory } from "@/lib/file-classifier";

interface QueuedFile {
  id: string; file: File; category: FileCategory;
  group: number; customName: string; error?: string;
}

const GROUP_COLORS = ["#E8553E", "#3B82F6", "#22C55E", "#7C3AED", "#F59E0B"];

let idCounter = 0;

export default function DropzoneUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const router = useRouter();
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

  useEffect(() => {
    const el = zoneRef.current;
    if (!el) return;
    const onDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(true); };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (!el.contains(e.relatedTarget as Node)) setDragging(false);
    };
    const onDrop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragging(false); if (e.dataTransfer?.files) addFiles(e.dataTransfer.files); };
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => { el.removeEventListener("dragover", onDragOver); el.removeEventListener("dragleave", onDragLeave); el.removeEventListener("drop", onDrop); };
  }, [addFiles]);

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

  function formatSize(bytes: number) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function fileIcon(name: string) {
    const ext = name.split(".").pop()?.toLowerCase();
    const s = { display: "inline-block", width: 18, height: 18 } as const;
    if (ext === "pdf") return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6"/><path d="M9 18h6"/><path d="M12 12h.01"/></svg>;
    if (["xls", "xlsx"].includes(ext ?? "")) return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="#22C55E" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13l2.5 3.5L13 13"/><path d="M13 16.5L15.5 13"/></svg>;
    if (ext === "csv") return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6"/><path d="M9 16h6"/></svg>;
    if (["png", "jpg", "jpeg", "webp"].includes(ext ?? "")) return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>;
    return <svg {...s} viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="1.5"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>;
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
        const res = await fetch("/api/subir-procesar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: q.customName + (q.file.name.match(/\.[^.]+$/) ?? ""),
            base64,
            tipo: q.file.name.endsWith(".pdf") ? "pdf" : "excel",
          }),
        });
        const data = await res.json();
        if (data.ok) ok++; else { fail++; toast(data.error ?? "Error", "error"); }
      } catch { fail++; toast("Error de red", "error"); }
    }
    setUploading(false);
    setQueue([]);
    if (ok > 0) { sessionStorage.removeItem("flow-stage"); toast(`${ok} subido${ok > 1 ? "s" : ""}`); router.refresh(); }
  }

  const dzBorder = dragging ? "rgba(180,240,39,.6)" : "rgba(255,255,255,.08)";
  const dzBg = dragging ? "rgba(180,240,39,.04)" : "transparent";

  return (
    <>
      <input ref={inputRef} type="file" accept=".xls,.xlsx,.pdf,.csv,.png,.jpg,.jpeg,.webp" multiple
        style={{ display: "none" }} onChange={handleInput} />

      {/* DROP ZONE */}
      <div ref={zoneRef} onClick={() => inputRef.current?.click()}
        style={{
          cursor: "pointer", opacity: uploading ? .6 : 1, userSelect: "none",
          padding: "32px 20px", borderRadius: 12,
          border: `2px dashed ${dzBorder}`,
          background: dzBg,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
          transition: "all .25s ease",
          position: "relative", overflow: "hidden",
        }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: dragging ? "rgba(180,240,39,.1)" : "rgba(180,240,39,.04)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all .25s",
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b4f027" strokeWidth="1.5">
            <path d="M12 5v14m-7-7l7-7 7 7"/>
          </svg>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>
            {dragging ? "Suelta tus archivos aquí" : "Arrastra tus archivos aquí"}
          </div>
          <div style={{ fontSize: 10, color: "var(--text2)" }}>
            o haz clic para seleccionar · Excel, PDF, CSV, imágenes
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {[
            { label: "XLS", color: "#22C55E" },
            { label: "PDF", color: "#E8553E" },
            { label: "CSV", color: "#3B82F6" },
            { label: "IMG", color: "#7C3AED" },
          ].map(f => (
            <span key={f.label} style={{
              padding: "2px 8px", borderRadius: 4, fontSize: 8, fontWeight: 700,
              background: f.color + "1A", color: f.color, letterSpacing: "0.04em",
            }}>
              {f.label}
            </span>
          ))}
        </div>
      </div>

      {/* FILE QUEUE */}
      {queue.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
              Archivos pendientes <span style={{ color: "var(--text2)", fontWeight: 400, fontSize: 10 }}>({queue.length})</span>
            </span>
            <button onClick={() => inputRef.current?.click()}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#b4f027", fontWeight: 600, padding: 0 }}>
              + Agregar más
            </button>
          </div>
          {queue.map(q => {
            const gc = GROUP_COLORS[q.group - 1] ?? GROUP_COLORS[0];
            const isGrande = q.category === "grande";
            return (
              <div key={q.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 8,
                background: "rgba(255,255,255,.02)",
                border: "1px solid rgba(255,255,255,.04)",
                transition: "all .15s",
              }}>
                {/* Group badge */}
                <button onClick={() => cycleGroup(q.id)} disabled={isGrande}
                  style={{
                    width: 26, height: 26, borderRadius: "50%", border: "none",
                    cursor: isGrande ? "not-allowed" : "pointer",
                    fontSize: 10, fontWeight: 700,
                    background: gc + "20", color: gc,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, opacity: isGrande ? .5 : 1,
                    transition: "all .15s",
                  }}>
                  {isGrande ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={gc} strokeWidth="2">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                  </svg>
                ) : q.group}
                </button>

                {/* File icon */}
                <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(q.file.name)}</span>

                {/* File info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === q.id ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        style={{
                          flex: 1, fontSize: 11,
                          background: "var(--bg-muted)", border: "1px solid rgba(255,255,255,.06)",
                          borderRadius: 4, color: "var(--text)", padding: "3px 6px", outline: "none",
                        }} />
                      <button onClick={() => saveName(q.id)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#22c55e", padding: "0 4px", display: "flex", alignItems: "center" }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }}>
                        {isGrande ? `${q.customName}` : q.customName}
                      </div>
                      <div style={{ fontSize: 9, color: "var(--text2)", display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                        <span>{formatSize(q.file.size)}</span>
                        <span style={{ color: "rgba(255,255,255,.08)" }}>·</span>
                        {isGrande ? (
                          <span style={{ color: "#f59e0b" }}>Archivo grande — se procesa solo</span>
                        ) : (
                          <span>Grupo <span style={{ color: gc, fontWeight: 600 }}>{q.group}</span></span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Edit */}
                <button onClick={() => editingId === q.id ? saveName(q.id) : startEdit(q)}
                  style={{
                    width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer",
                    background: "transparent", color: "var(--text2)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    transition: "all .15s",
                  }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>

                {/* Remove */}
                <button onClick={() => removeFile(q.id)}
                  style={{
                    width: 22, height: 22, borderRadius: 4, border: "none", cursor: "pointer",
                    background: "transparent", color: "rgba(255,255,255,.15)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    transition: "all .15s",
                  }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            );
          })}

          {/* Upload actions */}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={handleUploadAll} disabled={uploading}
              style={{
                flex: 1, border: "none", borderRadius: 8,
                background: uploading ? "rgba(232,85,62,.6)" : "#E8553E",
                padding: "10px 14px", fontSize: 11, fontWeight: 600, color: "#fff", cursor: uploading ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                opacity: uploading ? .6 : 1, transition: "all .2s",
              }}>
              {uploading ? (
                <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "sp .5s linear infinite" }} />
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 13l4 4L19 7"/>
                </svg>
              )}
              {uploading ? "Subiendo..." : `Subir ${queue.length} archivo${queue.length > 1 ? "s" : ""}`}
            </button>
            <button onClick={() => setQueue([])}
              style={{
                padding: "10px 16px", border: "1px solid rgba(255,255,255,.06)", borderRadius: 8,
                background: "transparent", fontSize: 11, fontWeight: 600, color: "var(--text2)", cursor: "pointer",
                transition: "all .2s",
              }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
