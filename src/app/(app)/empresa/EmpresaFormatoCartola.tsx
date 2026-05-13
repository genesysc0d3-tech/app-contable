"use client";

import { useState, useRef } from "react";
import { UploadSimple, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";
import { classifyFile } from "@/lib/file-classifier";

export default function EmpresaFormatoCartola({ empresaId }: { empresaId: string }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      toast("Solo se aceptan archivos Excel (.xlsx o .xls)", "error");
      return;
    }

    setUploading(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));

      const res = await fetch("/api/subir-ejemplo-formato", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa_id: empresaId,
          nombre: file.name,
          base64,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        toast("Formato guardado. Ahora mapeá las columnas en los documentos subidos.");
      } else {
        toast(data.error ?? "Error al guardar formato", "error");
      }
    } catch {
      toast("Error al procesar el archivo", "error");
    }
    setUploading(false);
  }

  return (
    <div className="p-4 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-3">
      <div className="flex items-start gap-2.5">
        <UploadSimple size={18} weight="light" className="text-[var(--muted)] shrink-0 mt-0.5" />
        <div className="text-[11px] text-[var(--muted-light)] leading-relaxed">
          Subí una cartola de ejemplo de tu banco. El sistema aprende el formato
          y la próxima vez que subas una igual, la va a leer automáticamente.
        </div>
      </div>

      <div
        onClick={() => fileInputRef.current?.click()}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#E8553E]/40 hover:border-[#E8553E] bg-transparent hover:bg-[var(--accent-light)]/50 cursor-pointer px-4 py-3 transition-all"
      >
        <UploadSimple size={16} className="text-[#E8553E]" />
        <span className="text-xs font-medium text-[var(--foreground)]">
          {uploading ? "Subiendo..." : "Subir Excel de ejemplo"}
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      <p className="text-[10px] text-[var(--muted-light)] flex items-center gap-1">
        <WarningCircle size={10} weight="fill" className="text-[#F59E0B]" />
        Después de subirlo, andá a la sección <strong>Subir</strong>, cargá una cartola del mismo banco y usá el botón <strong>Mapear campos</strong> para indicarle al sistema qué columna es cada cosa.
      </p>
    </div>
  );
}
