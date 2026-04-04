"use client";

import { useState, useRef, useCallback } from "react";
import { uploadDocumento, validateFile, getAcceptString } from "@/lib/upload";
import type { UploadResult } from "@/lib/upload";

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
        return {
          file,
          status: error ? "error" : "pending",
          error: error ?? undefined,
        };
      });

      setFiles((prev) => [...fileStatuses, ...prev]);

      for (const fs of fileStatuses) {
        if (fs.status === "error") continue;

        setFiles((prev) =>
          prev.map((f) =>
            f.file === fs.file ? { ...f, status: "uploading" } : f
          )
        );

        const result = await uploadDocumento(fs.file, empresaId);

        setFiles((prev) =>
          prev.map((f) =>
            f.file === fs.file
              ? {
                  ...f,
                  status: result.success ? "success" : "error",
                  error: result.error,
                }
              : f
          )
        );

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

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
        e.target.value = "";
      }
    },
    [processFiles]
  );

  const statusIcon = (status: FileStatus["status"]) => {
    switch (status) {
      case "pending": return "⏳";
      case "uploading": return "⏳";
      case "success": return "✓";
      case "error": return "✗";
    }
  };

  const statusColor = (status: FileStatus["status"]) => {
    switch (status) {
      case "uploading": return "text-[#E8553E]";
      case "success": return "text-[#22C55E]";
      case "error": return "text-[#E8553E]";
      default: return "text-[#888]";
    }
  };

  return (
    <div className="space-y-4">
      {/* Zona drag & drop — solo desktop */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          hidden md:flex flex-col items-center justify-center
          rounded-[20px] border-2 border-dashed cursor-pointer
          transition-all duration-200 py-16 px-6
          ${
            isDragging
              ? "border-[#E8553E] bg-[#FFF0EE]"
              : "border-[#E8553E]/40 bg-[#FFF8F7] hover:border-[#E8553E] hover:bg-[#FFF0EE]"
          }
        `}
      >
        <div className="text-4xl mb-3">📄</div>
        <p className="text-lg font-semibold text-[#111]">
          Arrastra archivos aquí
        </p>
        <p className="text-sm text-[#888] mt-1">
          Excel, PDF, imágenes, CSV o chats de WhatsApp
        </p>
      </div>

      {/* Botones de acción */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.accept = "image/*";
              fileInputRef.current.capture = "environment";
              fileInputRef.current.click();
            }
          }}
          className="flex items-center justify-center gap-2 rounded-[16px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-4 py-3.5 text-sm font-medium text-[#111] hover:shadow-[0_2px_16px_rgba(0,0,0,0.1)] transition-shadow"
        >
          <span>📷</span> Cámara
        </button>
        <button
          type="button"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.accept =
                ".xls,.xlsx,.pdf,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf,text/csv";
              fileInputRef.current.removeAttribute("capture");
              fileInputRef.current.click();
            }
          }}
          className="flex items-center justify-center gap-2 rounded-[16px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-4 py-3.5 text-sm font-medium text-[#111] hover:shadow-[0_2px_16px_rgba(0,0,0,0.1)] transition-shadow"
        >
          <span>📊</span> Archivos
        </button>
        <button
          type="button"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.accept = "image/*";
              fileInputRef.current.removeAttribute("capture");
              fileInputRef.current.click();
            }
          }}
          className="flex items-center justify-center gap-2 rounded-[16px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-4 py-3.5 text-sm font-medium text-[#111] hover:shadow-[0_2px_16px_rgba(0,0,0,0.1)] transition-shadow"
        >
          <span>🖼️</span> Galería
        </button>
        <button
          type="button"
          onClick={() => {
            if (fileInputRef.current) {
              fileInputRef.current.accept = ".txt,text/plain";
              fileInputRef.current.removeAttribute("capture");
              fileInputRef.current.click();
            }
          }}
          className="flex items-center justify-center gap-2 rounded-[16px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] px-4 py-3.5 text-sm font-medium text-[#111] hover:shadow-[0_2px_16px_rgba(0,0,0,0.1)] transition-shadow"
        >
          <span>💬</span> WhatsApp
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={getAcceptString()}
        onChange={handleFileInput}
        className="hidden"
      />

      {/* Lista de archivos subidos */}
      {files.length > 0 && (
        <div className="rounded-[20px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] divide-y divide-[#EEEEEE]">
          {files.map((fs, i) => (
            <div
              key={`${fs.file.name}-${i}`}
              className="flex items-center gap-3 px-4 py-3"
            >
              <span className={`text-lg ${statusColor(fs.status)}`}>
                {statusIcon(fs.status)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#111] truncate">{fs.file.name}</p>
                {fs.error && (
                  <p className="text-xs text-[#E8553E] mt-0.5">{fs.error}</p>
                )}
                {fs.status === "uploading" && (
                  <div className="mt-1.5 h-1 rounded-full bg-[#EEEEEE] overflow-hidden">
                    <div className="h-full bg-[#E8553E] rounded-full animate-pulse w-2/3" />
                  </div>
                )}
              </div>
              <span className="text-xs text-[#888] shrink-0">
                {(fs.file.size / 1024).toFixed(0)} KB
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
