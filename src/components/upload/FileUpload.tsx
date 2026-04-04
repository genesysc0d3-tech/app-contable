"use client";

import { useState, useRef, useCallback } from "react";
import { uploadDocumento, validateFile, getAcceptString } from "@/lib/upload";
import type { UploadResult } from "@/lib/upload";
import { Camera, FileXls, Images, ChatText, UploadSimple, Check, X } from "@phosphor-icons/react";

interface FileUploadProps {
  empresaId: string;
  onUploadComplete?: (result: UploadResult) => void;
}

type FileStatus = {
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
};

export default function FileUpload({ empresaId, onUploadComplete }: FileUploadProps) {
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(
    async (newFiles: FileList | File[]) => {
      const fileArray = Array.from(newFiles);
      const fileStatuses: FileStatus[] = fileArray.map((file) => {
        const error = validateFile(file);
        return { file, status: error ? "error" : "pending", error: error ?? undefined };
      });
      setFiles((prev) => [...fileStatuses, ...prev]);

      for (const fs of fileStatuses) {
        if (fs.status === "error") continue;
        setFiles((prev) => prev.map((f) => f.file === fs.file ? { ...f, status: "uploading" } : f));
        const result = await uploadDocumento(fs.file, empresaId);
        setFiles((prev) => prev.map((f) => f.file === fs.file ? { ...f, status: result.success ? "success" : "error", error: result.error } : f));
        onUploadComplete?.(result);
        if (result.success && result.documento) {
          fetch("/api/procesar-documento", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documento_id: result.documento.id }),
          }).catch(() => {});
        }
      }
    },
    [empresaId, onUploadComplete]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
  }, [processFiles]);
  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) { processFiles(e.target.files); e.target.value = ""; }
  }, [processFiles]);

  return (
    <div className="space-y-4">
      {/* Drop zone — desktop */}
      <div
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`hidden md:flex flex-col items-center justify-center rounded-[20px] border-2 border-dashed cursor-pointer transition-all duration-200 py-20 px-6 ${
          isDragging
            ? "border-[#E8553E] bg-[var(--accent-light)]"
            : "border-[#E8553E]/40 dark:border-[#E8553E]/30 bg-[#FFF8F7] dark:bg-[var(--accent-light)] hover:border-[#E8553E] hover:bg-[var(--accent-light)]"
        }`}
      >
        <UploadSimple size={48} weight="light" className="text-[#E8553E] mb-3" />
        <p className="text-lg font-semibold text-[var(--foreground)]">Arrastra archivos aquí</p>
        <p className="text-sm text-[var(--muted)] mt-1">Excel, PDF, imágenes, CSV o chats de WhatsApp</p>
      </div>

      {/* Action buttons — 2x2 grid with large icons */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Cámara", Icon: Camera, accept: "image/*", capture: true },
          { label: "Archivos", Icon: FileXls, accept: ".xls,.xlsx,.pdf,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,text/csv" },
          { label: "Galería", Icon: Images, accept: "image/*" },
          { label: "WhatsApp", Icon: ChatText, accept: ".txt,text/plain" },
        ].map(({ label, Icon, accept, capture }) => (
          <button
            key={label} type="button"
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.accept = accept;
                if (capture) fileInputRef.current.capture = "environment";
                else fileInputRef.current.removeAttribute("capture");
                fileInputRef.current.click();
              }
            }}
            className="btn-press flex flex-col items-center justify-center gap-2 rounded-[16px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none dark:border dark:border-white/10 px-4 py-5 text-sm font-medium text-[var(--foreground)] hover:shadow-[0_2px_16px_rgba(0,0,0,0.1)] transition-all duration-150"
          >
            <Icon size={32} weight="light" className="text-[#E8553E]" />
            {label}
          </button>
        ))}
      </div>

      <input ref={fileInputRef} type="file" multiple accept={getAcceptString()} onChange={handleFileInput} className="hidden" />

      {/* Upload list */}
      {files.length > 0 && (
        <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none divide-y divide-[var(--border)]">
          {files.map((fs, i) => (
            <div key={`${fs.file.name}-${i}`} className="flex items-center gap-3 px-4 py-3 animate-fade-in">
              <span className="text-lg">
                {fs.status === "success" ? <Check size={20} weight="bold" className="text-[#22C55E]" /> :
                 fs.status === "error" ? <X size={20} weight="bold" className="text-[#E8553E]" /> :
                 <UploadSimple size={20} className="text-[var(--muted)] animate-pulse" />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--foreground)] truncate">{fs.file.name}</p>
                {fs.error && <p className="text-xs text-[#E8553E] mt-0.5">{fs.error}</p>}
                {fs.status === "uploading" && (
                  <div className="mt-1.5 h-1 rounded-full bg-[var(--border)] overflow-hidden">
                    <div className="h-full bg-[#E8553E] rounded-full animate-pulse w-2/3 transition-all duration-500" />
                  </div>
                )}
              </div>
              <span className="text-xs text-[var(--muted-light)] shrink-0 tabular-nums">{(fs.file.size / 1024).toFixed(0)} KB</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
