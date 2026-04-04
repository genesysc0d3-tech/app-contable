"use client";

import type { DocumentoSubido } from "@/lib/upload";
import type { ProgresoIA } from "@/lib/ai/types";

interface DocumentListProps {
  documentos: DocumentoSubido[];
}

const ESTADO_BADGE: Record<string, { label: string; className: string }> = {
  subido: { label: "Subido", className: "bg-[#F5F5F3] text-[#888]" },
  procesando: { label: "Procesando", className: "bg-[#FFF0EE] text-[#E8553E]" },
  procesado: { label: "Listo", className: "bg-[#ECFDF5] text-[#22C55E]" },
  error: { label: "Error", className: "bg-[#FFF0EE] text-[#E8553E]" },
};

const TIPO_ICON: Record<string, string> = {
  excel: "📊",
  imagen: "🖼️",
  pdf: "📄",
  whatsapp: "💬",
  csv: "📋",
};

function ProgresoBar({ progreso }: { progreso: ProgresoIA | null }) {
  if (!progreso) return null;

  if (progreso.estado === "completado") {
    if (progreso.duplicados_saltados && progreso.duplicados_saltados > 0) {
      return (
        <p className="text-[10px] text-[#E8553E] mt-1">
          {progreso.duplicados_saltados} duplicados omitidos
        </p>
      );
    }
    return null;
  }

  if (progreso.estado === "error") {
    return (
      <p className="text-xs text-[#E8553E] mt-1 truncate">
        Error: {progreso.error}
      </p>
    );
  }

  const { lote_actual, total_lotes, movimientos_encontrados, duplicados_saltados } = progreso;

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-[#EEEEEE] overflow-hidden">
          <div
            className="h-full bg-[#E8553E] rounded-full transition-all duration-500"
            style={{
              width:
                total_lotes && lote_actual
                  ? `${(lote_actual / total_lotes) * 100}%`
                  : "33%",
            }}
          />
        </div>
        <span className="text-[10px] text-[#888] shrink-0">
          {total_lotes && total_lotes > 1
            ? `Lote ${lote_actual} de ${total_lotes}`
            : "Analizando..."}
        </span>
      </div>
      {movimientos_encontrados !== undefined && movimientos_encontrados > 0 && (
        <p className="text-[10px] text-[#AAA] mt-0.5">
          {movimientos_encontrados} movimientos encontrados
          {duplicados_saltados ? ` · ${duplicados_saltados} duplicados` : ""}
        </p>
      )}
    </div>
  );
}

export default function DocumentList({ documentos }: DocumentListProps) {
  if (documentos.length === 0) {
    return (
      <div className="text-center py-12 text-[#AAA]">
        <p className="text-3xl mb-2">📭</p>
        <p className="text-sm">No hay documentos aun</p>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] divide-y divide-[#EEEEEE]">
      {documentos.map((doc) => {
        const badge = ESTADO_BADGE[doc.estado] ?? ESTADO_BADGE.subido;
        const icon = TIPO_ICON[doc.tipo] ?? "📄";
        const fecha = new Date(doc.created_at).toLocaleDateString("es-CL", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        const progreso = doc.progreso_ia as ProgresoIA | null;

        return (
          <div key={doc.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-xl">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#111] truncate">{doc.nombre_archivo}</p>
                <p className="text-xs text-[#AAA] mt-0.5">{fecha}</p>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>
                  {badge.label}
                </span>
                {doc.estado === "procesado" && doc.movimientos_detectados !== null && (
                  <p className="text-[10px] text-[#AAA] mt-1">
                    {doc.movimientos_detectados} mov.
                  </p>
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
