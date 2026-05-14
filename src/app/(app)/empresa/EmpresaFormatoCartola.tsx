"use client";

import { useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";
import CartolaMapperDragDrop from "@/components/mapping/CartolaMapperDragDrop";

export default function EmpresaFormatoCartola({ empresaId }: { empresaId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 space-y-2">
        <p className="text-[11px] text-[var(--muted-light)] leading-relaxed">
          Subí un ejemplo de cartola de tu banco y <strong>mapeá sus columnas</strong> con drag &amp; drop.
          El sistema recordará el formato y lo leerá automáticamente la próxima vez.
        </p>
        <button onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] px-3 py-2 text-xs font-semibold text-white transition-all btn-press">
          <UploadSimple size={14} />
          Mapear cartola
        </button>
      </div>

      {open && (
        <CartolaMapperDragDrop
          empresaId={empresaId}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </>
  );
}
