"use client";

import type { DocumentoSubido } from "@/lib/upload";
import type { ProgresoIA } from "@/lib/ai/types";
import { FileText, FileXls, Image, ChatText, File } from "@phosphor-icons/react";

interface DocumentListProps {
  documentos: DocumentoSubido[];
}

const ESTADO_BADGE: Record<string, { label: string; className: string }> = {
  subido: { label: "Subido", className: "bg-[var(--surface)] text-[var(--muted)]" },
  procesando: { label: "Procesando", className: "bg-[var(--accent-light)] text-[#E8553E]" },
  procesado: { label: "Listo", className: "bg-[#ECFDF5] dark:bg-[#22C55E]/15 text-[#22C55E]" },
  error: { label: "Error", className: "bg-[var(--accent-light)] text-[#E8553E]" },
};

const TIPO_ICON: Record<string, typeof FileText> = {
  excel: FileXls,
  imagen: Image,
  pdf: FileText,
  whatsapp: ChatText,
  csv: File,
};

function formatFechaCorta(dateStr: string): string {
  const d = new Date(dateStr);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d.getDate()} ${meses[d.getMonth()]}`;
}

function ProgresoBar({ progreso }: { progreso: ProgresoIA | null }) {
  if (!progreso) return null;

  if (progreso.estado === "completado") {
    if (progreso.duplicados_saltados && progreso.duplicados_saltados > 0) {
      return <p className="text-[10px] text-[#E8553E] mt-1">{progreso.duplicados_saltados} duplicados omitidos</p>;
    }
    return null;
  }

  if (progreso.estado === "error") {
    return <p className="text-xs text-[#E8553E] mt-1 truncate">Error: {progreso.error}</p>;
  }

  const { lote_actual, total_lotes, movimientos_encontrados, duplicados_saltados } = progreso;

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-[var(--border)] overflow-hidden">
          <div
            className="h-full bg-[#E8553E] rounded-full transition-all duration-500"
            style={{ width: total_lotes && lote_actual ? `${(lote_actual / total_lotes) * 100}%` : "33%" }}
          />
        </div>
        <span className="text-[10px] text-[var(--muted)] shrink-0">
          {total_lotes && total_lotes > 1 ? `Lote ${lote_actual} de ${total_lotes}` : "Analizando..."}
        </span>
      </div>
      {movimientos_encontrados !== undefined && movimientos_encontrados > 0 && (
        <p className="text-[10px] text-[var(--muted-light)] mt-0.5">
          {movimientos_encontrados} movimientos{duplicados_saltados ? ` · ${duplicados_saltados} duplicados` : ""}
        </p>
      )}
    </div>
  );
}

export default function DocumentList({ documentos }: DocumentListProps) {
  if (documentos.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--muted-light)]">
        <FileText size={48} weight="light" className="mx-auto mb-3 text-[var(--border)]" />
        <p className="text-sm">No hay documentos aun</p>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none divide-y divide-[var(--border)]">
      {documentos.map((doc) => {
        const badge = ESTADO_BADGE[doc.estado] ?? ESTADO_BADGE.subido;
        const IconComp = TIPO_ICON[doc.tipo] ?? FileText;
        const progreso = doc.progreso_ia as ProgresoIA | null;

        return (
          <div key={doc.id} className="px-4 py-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <IconComp size={24} weight="light" className="text-[var(--muted)] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--foreground)] truncate">{doc.nombre_archivo}</p>
                <p className="text-xs text-[var(--muted-light)] mt-0.5">{formatFechaCorta(doc.created_at)}</p>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>{badge.label}</span>
                {doc.estado === "procesado" && doc.movimientos_detectados !== null && (
                  <p className="text-[10px] text-[var(--muted-light)] mt-1 tabular-nums">{doc.movimientos_detectados} mov.</p>
                )}
              </div>
            </div>
            <ProgresoBar progreso={progreso} />
          </div>
        );
      })}
    </div>
  );
}
