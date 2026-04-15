"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { validateFile, getAcceptString } from "@/lib/upload";
import { classifyFile, getCategoryColor, BADGE_COLORS } from "@/lib/file-classifier";
import type { FileCategory } from "@/lib/file-classifier";
import {
  UploadSimple,
  FileXls,
  FilePdf,
  Image as ImageIcon,
  File as FileIcon,
  X,
  PencilSimple,
  Check,
} from "@phosphor-icons/react";

export interface QueuedFile {
  id: string;
  file: File;
  category: FileCategory;
  group: number; // 1-5 badge
  customName: string;
  error?: string;
}

interface FileUploadProps {
  onFilesQueued: (files: QueuedFile[]) => void;
}

let fileIdCounter = 0;

export default function FileUpload({ onFilesQueued }: FileUploadProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const queued: QueuedFile[] = await Promise.all(
      fileArray.map(async (file) => {
        const error = validateFile(file) ?? undefined;
        const category = await classifyFile(file);
        return {
          id: `f-${++fileIdCounter}`,
          file,
          category,
          group: 1,
          customName: file.name.replace(/\.[^.]+$/, ""),
          error,
        };
      })
    );
    setQueue((prev) => [...prev, ...queued]);
  }, []);

  function cycleGroup(id: string) {
    setQueue((prev) =>
      prev.map((f) => {
        if (f.id !== id || f.category === "grande") return f;
        return { ...f, group: f.group >= 5 ? 1 : f.group + 1 };
      })
    );
  }

  function removeFile(id: string) {
    setQueue((prev) => prev.filter((f) => f.id !== id));
  }

  function startEditName(f: QueuedFile) {
    setEditingId(f.id);
    setEditName(f.customName);
  }

  function saveName(id: string) {
    setQueue((prev) =>
      prev.map((f) => (f.id === id ? { ...f, customName: editName || f.file.name } : f))
    );
    setEditingId(null);
  }

  function handleSubmit() {
    const valid = queue.filter((f) => !f.error);
    if (valid.length === 0) return;
    onFilesQueued(valid);
    setQueue([]);
  }

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  // Window-wide drag-drop — user can drop files ANYWHERE on the window,
  // not just on the dropzone. Dropzone highlights while dragging.
  useEffect(() => {
    let depth = 0; // track nested dragenter/leave to avoid flicker
    function hasFiles(e: DragEvent) {
      return Array.from(e.dataTransfer?.types ?? []).includes("Files");
    }
    function onWinDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth++;
      setIsDragging(true);
    }
    function onWinDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    }
    function onWinDragOver(e: DragEvent) {
      if (!hasFiles(e)) return;
      e.preventDefault(); // allow drop
    }
    function onWinDrop(e: DragEvent) {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      depth = 0;
      setIsDragging(false);
      addFiles(e.dataTransfer.files);
    }
    window.addEventListener("dragenter", onWinDragEnter);
    window.addEventListener("dragleave", onWinDragLeave);
    window.addEventListener("dragover", onWinDragOver);
    window.addEventListener("drop", onWinDrop);
    return () => {
      window.removeEventListener("dragenter", onWinDragEnter);
      window.removeEventListener("dragleave", onWinDragLeave);
      window.removeEventListener("dragover", onWinDragOver);
      window.removeEventListener("drop", onWinDrop);
    };
  }, [addFiles]);

  return (
    <div className="space-y-4">
      {/* Single drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex items-center gap-3 rounded-2xl border border-dashed cursor-pointer transition-all duration-200 py-3 px-4 ${
          isDragging
            ? "border-[#E8553E] bg-[var(--accent-light)] scale-[1.01] shadow-[0_0_32px_-8px_rgba(232,85,62,0.5)]"
            : "border-[#E8553E]/40 dark:border-[#E8553E]/30 bg-transparent hover:border-[#E8553E] hover:bg-[var(--accent-light)]/50"
        }`}
      >
        <div className="w-10 h-10 rounded-xl bg-[var(--accent-light)] text-[#E8553E] flex items-center justify-center shrink-0">
          <UploadSimple size={20} weight="bold" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[var(--foreground)] leading-tight">
            {isDragging ? "Soltá para subir" : "Arrastrá o tocá"}
          </p>
          <p className="text-[10px] text-[var(--muted-light)] mt-0.5">Excel, PDF, imágenes, CSV</p>
        </div>
        <div className="flex items-center gap-1.5 text-[var(--muted-light)] shrink-0">
          <FileXls size={14} weight="light" />
          <FilePdf size={14} weight="light" />
          <ImageIcon size={14} weight="light" />
          <FileIcon size={14} weight="light" />
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={getAcceptString()}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            addFiles(e.target.files);
            e.target.value = "";
          }
        }}
        className="hidden"
      />

      {/* Queue */}
      {queue.length > 0 && (
        <>
          <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none divide-y divide-[var(--border)]">
            {queue.map((f) => {
              const catColor = getCategoryColor(f.category);
              const badgeColor = BADGE_COLORS[f.group] ?? BADGE_COLORS[1];
              const isEditing = editingId === f.id;

              return (
                <div key={f.id} className="px-4 py-3 animate-fade-in">
                  <div className="flex items-center gap-3">
                    {/* Badge (clickable for chico/imagen) */}
                    {f.category === "grande" ? (
                      <span className="w-7 h-7 rounded-full bg-[var(--accent-light)] flex items-center justify-center text-[10px] font-bold text-[#E8553E] shrink-0">
                        !
                      </span>
                    ) : (
                      <button
                        onClick={() => cycleGroup(f.id)}
                        className={`w-7 h-7 rounded-full ${badgeColor} flex items-center justify-center text-[10px] font-bold text-white shrink-0 btn-press transition-transform duration-150 hover:scale-110`}
                      >
                        {f.group}
                      </button>
                    )}

                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && saveName(f.id)}
                            autoFocus
                            className="flex-1 text-sm bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2 py-1 text-[var(--foreground)] focus:outline-none focus:border-[#E8553E]"
                          />
                          <button onClick={() => saveName(f.id)} className="text-[#22C55E]">
                            <Check size={16} weight="bold" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm text-[var(--foreground)] truncate">{f.customName}</p>
                          <button onClick={() => startEditName(f)} className="text-[var(--muted-light)] hover:text-[var(--muted)]">
                            <PencilSimple size={12} />
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] font-medium ${catColor}`}>
                          {f.category === "grande" ? "Procesa solo" : f.category === "imagen" ? "OCR" : "Agrupable"}
                        </span>
                        <span className="text-[10px] text-[var(--muted-light)] tabular-nums">{(f.file.size / 1024).toFixed(0)} KB</span>
                      </div>
                      {f.error && <p className="text-[10px] text-[#E8553E] mt-0.5">{f.error}</p>}
                    </div>

                    <button onClick={() => removeFile(f.id)} className="text-[var(--muted-light)] hover:text-[#E8553E] shrink-0">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Disclaimer */}
          <p className="text-[10px] text-[var(--muted-light)] px-1">
            Documentos grandes (&gt;50 tx) se procesan individualmente. Para screenshots, agrúpalos por operación usando el badge de color.
          </p>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={queue.every((f) => !!f.error)}
            className="btn-press w-full rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-all duration-150"
          >
            Subir todo ({queue.filter((f) => !f.error).length} archivo{queue.filter((f) => !f.error).length !== 1 ? "s" : ""})
          </button>
        </>
      )}
    </div>
  );
}
