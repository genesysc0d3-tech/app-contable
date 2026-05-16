"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";

export default function DropzoneUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    let ok = 0, fail = 0;

    for (const file of Array.from(files)) {
      try {
        const arrayBuf = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);

        const res = await fetch("/api/subir-procesar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: file.name,
            base64,
            tipo: file.name.endsWith(".pdf") ? "pdf" : "excel",
          }),
        });
        const data = await res.json();
        if (data.ok) { ok++; } else { fail++; toast(data.error ?? "Error al subir", "error"); }
      } catch (err) {
        fail++;
        toast(`Error: ${err instanceof Error ? err.message : "desconocido"}`, "error");
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
    if (ok > 0) {
      toast(`${ok} archivo${ok > 1 ? "s" : ""} subido${ok > 1 ? "s" : ""}`);
      router.refresh();
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx,.pdf,.csv,.png,.jpg,.jpeg,.webp"
        multiple
        style={{ display: "none" }}
        onChange={handleFiles}
      />
      <div
        className="dz"
        onClick={() => inputRef.current?.click()}
        style={{ cursor: "pointer", opacity: uploading ? 0.6 : 1, transition: "opacity .2s" }}
      >
        <div className="dz-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14m-7-7l7-7 7 7"/></svg>
        </div>
        <div className="dz-txt">
          <h4>{uploading ? "Subiendo..." : "Arrastrá tu archivo aquí"}</h4>
          <p>Excel, PDF, CSV · Máx 20MB</p>
        </div>
      </div>
    </>
  );
}
