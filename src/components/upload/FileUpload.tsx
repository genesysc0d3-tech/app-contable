"use client";

import { useState, useRef, useCallback } from "react";
import { validateFile, getAcceptString } from "@/lib/upload";
import { classifyFile, getCategoryColor, BADGE_COLORS } from "@/lib/file-classifier";
import type { FileCategory } from "@/lib/file-classifier";
import {
  UploadSimple,
  FileXls,
  FilePdf,
  Image,
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

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    const queued: QueuedFile[] = fileArray.map((file) => {
      const error = validateFile(file) ?? undefined;
      const category = classifyFile(file);
      return {
        id: `f-${++fileIdCounter}`,
        file,
        category,
        group: 1,
        customName: file.name.replace(/\.[^.]+$/, ""),
        error,
      };
    });
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

  return (
    <div className="space-y-4">
      {/* Single drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center rounded-[20px] border-2 border-dashed cursor-pointer transition-all duration-200 py-14 px-6 ${
          isDragging
            ? "border-[#E8553E] bg-[var(--accent-light)]"
            : "border-[#E8553E]/40 dark:border-[#E8553E]/30 bg-[#FFF8F7] dark:bg-[var(--accent-light)] hover:border-[#E8553E] hover:bg-[var(--accent-light)]"
        }`}
      >
        <UploadSimple size={40} weight="light" className="text-[#E8553E] mb-3" />
        <p className="text-base font-semibold text-[var(--foreground)]">
          Arrastra archivos o toca para seleccionar
        </p>
        <div className="flex items-center gap-4 mt-3 text-[var(--muted-light)]">
          <FileXls size={20} weight="light" />
          <FilePdf size={20} weight="light" />
          <Image size={20} weight="light" />
          <FileIcon size={20} weight="light" />
        </div>
        <p className="text-xs text-[var(--muted-light)] mt-2">Excel, PDF, imágenes, CSV</p>
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
