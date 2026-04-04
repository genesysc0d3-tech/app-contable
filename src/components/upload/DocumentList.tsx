"use client";

import { useState } from "react";
import type { DocumentoSubido } from "@/lib/upload";
import type { ProgresoIA, DuplicadoDetalle } from "@/lib/ai/types";
import { FileText, FileXls, Image, ChatText, File, CaretDown, Warning, ArrowUUpLeft, ArrowCounterClockwise, Play } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

interface DocumentListProps {
  documentos: DocumentoSubido[];
  onDocumentoUpdate?: () => void;
}

const ESTADO_BADGE: Record<string, { label: string; className: string }> = {
  subido: { label: "Pendiente", className: "bg-[var(--surface)] text-[var(--muted)]" },
  procesando: { label: "Procesando", className: "bg-[var(--accent-light)] text-[#E8553E]" },
  procesado: { label: "Listo", className: "bg-[#ECFDF5] dark:bg-[#22C55E]/15 text-[#22C55E]" },
  error: { label: "Error", className: "bg-[var(--accent-light)] text-[#E8553E]" },
};

const TIPO_ICON: Record<string, typeof FileText> = {
  excel: FileXls, imagen: Image, pdf: FileText, whatsapp: ChatText, csv: File,
};

function formatFechaCorta(dateStr: string): string {
  const d = new Date(dateStr);
  const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${d.getDate()} ${meses[d.getMonth()]}`;
}

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function ProgresoBar({ progreso }: { progreso: ProgresoIA | null }) {
  if (!progreso || progreso.estado === "completado" || progreso.estado === "error") return null;
  const { lote_actual, total_lotes, movimientos_encontrados } = progreso;
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-[var(--border)] overflow-hidden">
          <div className="h-full bg-[#E8553E] rounded-full transition-all duration-500"
            style={{ width: total_lotes && lote_actual ? `${(lote_actual / total_lotes) * 100}%` : "33%" }} />
        </div>
        <span className="text-[10px] text-[var(--muted)] shrink-0">
          {total_lotes && total_lotes > 1 ? `Lote ${lote_actual} de ${total_lotes}` : "Analizando..."}
        </span>
      </div>
      {movimientos_encontrados !== undefined && movimientos_encontrados > 0 && (
        <p className="text-[10px] text-[var(--muted-light)] mt-0.5">{movimientos_encontrados} movimientos</p>
      )}
    </div>
  );
}

function DuplicadoVisor({ duplicados, documentoId, hasWarning }: {
  duplicados: DuplicadoDetalle[]; documentoId: string; hasWarning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [forcing, setForcing] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [inserted, setInserted] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  if (duplicados.length === 0) return null;

  async function handleForceInsert(dup: DuplicadoDetalle) {
    const key = `${dup.fecha}|${dup.monto}|${dup.descripcion}|${dup.n_documento ?? ""}`;
    setForcing(key);
    try {
      const res = await fetch("/api/forzar-movimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: documentoId, fecha: dup.fecha, descripcion: dup.descripcion, monto: dup.monto, tipo_flujo: dup.tipo_flujo }),
      });
      if (res.ok) { setInserted((prev) => new Set(prev).add(key)); toast("Movimiento agregado"); }
      else toast("Error al agregar", "error");
    } catch { toast("Error al agregar", "error"); }
    setForcing(null); setConfirmId(null);
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      {/* Warning for false duplicates */}
      {hasWarning && (
        <div className="flex items-start gap-1.5 text-[10px] text-[#F59E0B] bg-[#FFF8ED] dark:bg-[#F59E0B]/10 rounded-lg px-2.5 py-2">
          <Warning size={12} weight="fill" className="shrink-0 mt-0.5" />
          <span>Esta cartola tiene transferencias del mismo monto y descripción. Verifica que no sean operaciones distintas de diferentes personas.</span>
        </div>
      )}

      <button onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-[#F59E0B] hover:text-[#D97706] transition-colors">
        <ArrowUUpLeft size={12} weight="bold" />
        <span>Ver {duplicados.length} omitido{duplicados.length !== 1 ? "s" : ""}</span>
        <CaretDown size={10} weight="bold" className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="space-y-1.5 animate-fade-in">
          {duplicados.map((dup, idx) => {
            const key = `${dup.fecha}|${dup.monto}|${dup.descripcion}|${dup.n_documento ?? ""}`;
            const isInserted = inserted.has(key);
            const isConfirming = confirmId === key;

            return (
              <div key={idx} className={`rounded-lg bg-[var(--surface)] px-3 py-2 text-[10px] space-y-1 ${isInserted ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[var(--foreground)] truncate">{dup.descripcion}</p>
                    <div className="flex items-center gap-2 text-[var(--muted-light)] mt-0.5">
                      <span>{formatFechaCorta(dup.fecha)}</span>
                      <span className="tabular-nums">{fmt(dup.monto)}</span>
                      {dup.n_documento && <span className="text-[var(--muted)]">#{dup.n_documento}</span>}
                    </div>
                  </div>
                  {!isInserted && !isConfirming && (
                    <button onClick={() => setConfirmId(key)} disabled={!!forcing}
                      className="btn-press shrink-0 text-[9px] text-[#E8553E] bg-[var(--accent-light)] hover:bg-[#FFE4E0] rounded px-2 py-1 transition-colors">
                      Agregar
                    </button>
                  )}
                  {isInserted && <span className="text-[9px] text-[#22C55E]">Agregado</span>}
                </div>

                {/* Motivo */}
                <p className="text-[var(--muted-light)] italic">{dup.motivo}</p>

                {/* Origin */}
                {dup.origen_documento_nombre !== "Mismo lote" && (
                  <p className="text-[var(--muted-light)] flex items-center gap-1">
                    <Warning size={10} className="text-[#F59E0B] shrink-0" />
                    En {dup.origen_documento_nombre}
                    {dup.origen_documento_fecha && ` (${formatFechaCorta(dup.origen_documento_fecha)})`}
                  </p>
                )}

                {isConfirming && (
                  <div className="bg-[var(--accent-light)] rounded-lg px-2.5 py-2 space-y-1.5 animate-fade-in">
                    <p className="text-[var(--foreground)]">
                      Este movimiento ya existe en {dup.origen_documento_nombre}. Agregarlo puede crear duplicados contables.
                    </p>
                    <div className="flex gap-1.5">
                      <button onClick={() => handleForceInsert(dup)} disabled={!!forcing}
                        className="btn-press text-[9px] bg-[#E8553E] text-white rounded px-2 py-1 disabled:opacity-50">
                        {forcing === key ? "..." : "Confirmar"}
                      </button>
                      <button onClick={() => setConfirmId(null)}
                        className="btn-press text-[9px] bg-[var(--surface)] text-[var(--muted)] rounded px-2 py-1">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UndoButton({ documentoId, estado, onUndo }: { documentoId: string; estado: string; onUndo: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  if (estado !== "procesado" && estado !== "error" && estado !== "subido") return null;

  // "subido" means already undone — show Reprocess
  if (estado === "subido") {
    return (
      <button onClick={async () => {
        setLoading(true);
        try {
          const res = await fetch("/api/procesar-documento", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ documento_id: documentoId }),
          });
          if (res.ok) { toast("Reprocesando..."); onUndo(); }
          else toast("Error al reprocesar", "error");
        } catch { toast("Error al reprocesar", "error"); }
        setLoading(false);
      }} disabled={loading}
        className="btn-press flex items-center gap-1 text-[10px] text-[#E8553E] hover:text-[var(--accent-hover)] transition-colors mt-1">
        <Play size={10} weight="fill" /> {loading ? "..." : "Reprocesar"}
      </button>
    );
  }

  async function handleUndo() {
    setLoading(true);
    try {
      const res = await fetch("/api/deshacer-documento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: documentoId }),
      });
      if (res.ok) { toast("Análisis eliminado"); onUndo(); }
      else toast("Error al deshacer", "error");
    } catch { toast("Error al deshacer", "error"); }
    setLoading(false); setConfirming(false);
  }

  return (
    <div className="mt-1">
      {!confirming ? (
        <button onClick={() => setConfirming(true)}
          className="btn-press flex items-center gap-1 text-[10px] text-[var(--muted-light)] hover:text-[#E8553E] transition-colors">
          <ArrowCounterClockwise size={10} weight="bold" /> Deshacer
        </button>
      ) : (
        <div className="bg-[var(--accent-light)] rounded-lg px-2.5 py-2 text-[10px] space-y-1.5 animate-fade-in">
          <p className="text-[var(--foreground)]">
            Se borrarán los movimientos, propuestas y progreso. Podrás subirlo de nuevo corregido.
          </p>
          <div className="flex gap-1.5">
            <button onClick={handleUndo} disabled={loading}
              className="btn-press text-[9px] bg-[#E8553E] text-white rounded px-2 py-1 disabled:opacity-50">
              {loading ? "..." : "Confirmar"}
            </button>
            <button onClick={() => setConfirming(false)}
              className="btn-press text-[9px] bg-[var(--surface)] text-[var(--muted)] rounded px-2 py-1">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DocumentList({ documentos, onDocumentoUpdate }: DocumentListProps) {
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
        const duplicados = progreso?.duplicados_detalle ?? [];
        const dupCount = progreso?.duplicados_saltados ?? 0;
        const hasWarning = progreso?.falsos_duplicados_warning ?? false;

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

            {progreso?.estado === "error" && (
              <p className="text-xs text-[#E8553E] mt-1 truncate">Error: {progreso.error}</p>
            )}

            {/* Duplicates visor */}
            {doc.estado === "procesado" && dupCount > 0 && (
              duplicados.length > 0 ? (
                <DuplicadoVisor duplicados={duplicados} documentoId={doc.id} hasWarning={hasWarning} />
              ) : (
                <p className="text-[10px] text-[#F59E0B] mt-1 flex items-center gap-1">
                  <ArrowUUpLeft size={10} weight="bold" />
                  {dupCount} movimiento{dupCount !== 1 ? "s" : ""} ya existía{dupCount !== 1 ? "n" : ""} en otras cartolas
                </p>
              )
            )}

            {/* Undo / Reprocess */}
            <UndoButton documentoId={doc.id} estado={doc.estado} onUndo={() => onDocumentoUpdate?.()} />
          </div>
        );
      })}
    </div>
  );
}
