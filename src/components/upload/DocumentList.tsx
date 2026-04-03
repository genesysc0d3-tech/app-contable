"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { DocumentoSubido } from "@/lib/upload";
import type { ProgresoIA } from "@/lib/ai/types";

interface DocumentListProps {
  documentos: DocumentoSubido[];
  onDocumentoUpdate?: () => void;
}

const ESTADO_BADGE: Record<string, { label: string; className: string }> = {
  subido: { label: "Subido", className: "bg-blue-500/20 text-blue-300" },
  procesando: {
    label: "Procesando",
    className: "bg-yellow-500/20 text-yellow-300",
  },
  procesado: { label: "Listo", className: "bg-emerald-500/20 text-emerald-300" },
  error: { label: "Error", className: "bg-red-500/20 text-red-300" },
};

const TIPO_ICON: Record<string, string> = {
  excel: "📊",
  imagen: "🖼️",
  pdf: "📄",
  whatsapp: "💬",
  csv: "📋",
};

function ProgresoBar({ progreso }: { progreso: ProgresoIA | null }) {
  if (!progreso || progreso.estado === "completado") return null;

  if (progreso.estado === "error") {
    return (
      <p className="text-xs text-red-400 mt-1 truncate">
        Error: {progreso.error}
      </p>
    );
  }

  const { lote_actual, total_lotes, movimientos_encontrados } = progreso;

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-yellow-400 rounded-full transition-all duration-500"
            style={{
              width:
                total_lotes && lote_actual
                  ? `${(lote_actual / total_lotes) * 100}%`
                  : "33%",
            }}
          />
        </div>
        <span className="text-[10px] text-white/40 shrink-0">
          {total_lotes && total_lotes > 1
            ? `Lote ${lote_actual} de ${total_lotes}`
            : "Analizando..."}
        </span>
      </div>
      {movimientos_encontrados !== undefined && movimientos_encontrados > 0 && (
        <p className="text-[10px] text-white/30 mt-0.5">
          {movimientos_encontrados} movimientos encontrados
        </p>
      )}
    </div>
  );
}

export default function DocumentList({
  documentos,
  onDocumentoUpdate,
}: DocumentListProps) {
  // Subscribe to realtime changes on documentos_subidos
  useEffect(() => {
    if (documentos.length === 0) return;

    const channel = supabase
      .channel("documentos-progreso")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "documentos_subidos",
        },
        () => {
          onDocumentoUpdate?.();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [documentos.length, onDocumentoUpdate]);

  if (documentos.length === 0) {
    return (
      <div className="text-center py-12 text-white/40">
        <p className="text-3xl mb-2">📭</p>
        <p className="text-sm">No hay documentos aun</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 divide-y divide-white/10">
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
                <p className="text-sm text-white/90 truncate">
                  {doc.nombre_archivo}
                </p>
                <p className="text-xs text-white/40 mt-0.5">{fecha}</p>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
                {doc.estado === "procesado" &&
                  doc.movimientos_detectados !== null && (
                    <p className="text-[10px] text-white/30 mt-1">
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
