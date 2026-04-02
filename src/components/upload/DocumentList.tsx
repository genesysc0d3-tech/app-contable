"use client";

import type { DocumentoSubido } from "@/lib/upload";

interface DocumentListProps {
  documentos: DocumentoSubido[];
}

const ESTADO_BADGE: Record<string, { label: string; className: string }> = {
  subido: { label: "Subido", className: "bg-blue-500/20 text-blue-300" },
  procesando: { label: "Procesando", className: "bg-yellow-500/20 text-yellow-300" },
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

export default function DocumentList({ documentos }: DocumentListProps) {
  if (documentos.length === 0) {
    return (
      <div className="text-center py-12 text-white/40">
        <p className="text-3xl mb-2">📭</p>
        <p className="text-sm">No hay documentos aún</p>
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

        return (
          <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
            <span className="text-xl">{icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white/90 truncate">
                {doc.nombre_archivo}
              </p>
              <p className="text-xs text-white/40 mt-0.5">{fecha}</p>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
