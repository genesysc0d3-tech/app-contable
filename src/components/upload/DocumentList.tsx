"use client";

import { useState } from "react";
import type { DocumentoSubido } from "@/lib/upload";
import type { ProgresoIA, DuplicadoDetalle, TipoDuplicado } from "@/lib/ai/types";
import { FileText, FileXls, Image, ChatText, File, CaretDown, Warning, ArrowUUpLeft, ArrowCounterClockwise, Play, Info, XCircle, WarningCircle, EyeSlash, Eye } from "@phosphor-icons/react";
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

function ProgresoBar({ progreso, estado }: { progreso: ProgresoIA | null; estado: string }) {
  // Show for "procesando" state even if progreso is empty
  if (estado !== "procesando" && (!progreso || progreso.estado === "completado" || progreso.estado === "error")) return null;

  const lote_actual = progreso?.lote_actual;
  const total_lotes = progreso?.total_lotes;
  const movimientos_encontrados = progreso?.movimientos_encontrados;
  const hasProgress = !!total_lotes && !!lote_actual;
  const pct = hasProgress ? ((lote_actual as number) / (total_lotes as number)) * 100 : 0;

  // Phase labels
  let label = "Preparando documento...";
  if (hasProgress && pct < 100) label = `Analizando lote ${lote_actual} de ${total_lotes}`;
  else if (hasProgress && pct >= 100 && !movimientos_encontrados) label = "Detectando duplicados...";
  else if (movimientos_encontrados && movimientos_encontrados > 0 && estado === "procesando") label = "Guardando movimientos...";

  return (
    <div className="mt-2 space-y-1.5">
      {/* Progress bar with animation */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
          {hasProgress ? (
            <div className="h-full bg-[#E8553E] rounded-full transition-all duration-700 ease-out"
              style={{ width: `${Math.max(pct, 5)}%` }} />
          ) : (
            <div className="h-full bg-[#E8553E] rounded-full animate-progress-indeterminate" />
          )}
        </div>
        {hasProgress && (
          <span className="text-[10px] text-[var(--muted)] shrink-0 tabular-nums font-medium">
            {Math.round(pct)}%
          </span>
        )}
      </div>

      {/* Status label */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-[var(--muted-light)] flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#E8553E] animate-pulse" />
          {label}
        </p>
        {movimientos_encontrados !== undefined && movimientos_encontrados > 0 && (
          <p className="text-[10px] text-[var(--foreground)] font-medium tabular-nums">
            {movimientos_encontrados} encontrados
          </p>
        )}
      </div>
    </div>
  );
}

function DuplicadoVisor({ duplicados, documentoId, hasWarning }: {
  duplicados: DuplicadoDetalle[]; documentoId: string; hasWarning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedOcultos, setExpandedOcultos] = useState(false);
  const [forcing, setForcing] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [localOcultos, setLocalOcultos] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const { toast } = useToast();

  function dupKey(dup: DuplicadoDetalle, idx: number) {
    return `${dup.fecha}|${dup.monto}|${dup.descripcion}|${dup.n_documento ?? ""}|${idx}`;
  }

  // Separate into active / hidden
  const allVisible = duplicados.filter((dup, idx) => !removed.has(dupKey(dup, idx)));
  const activos = allVisible.filter((dup) => !dup.oculto && !localOcultos.has(dupKey(dup, duplicados.indexOf(dup))));
  const ocultos = allVisible.filter((dup) => dup.oculto || localOcultos.has(dupKey(dup, duplicados.indexOf(dup))));

  if (activos.length === 0 && ocultos.length === 0) return null;

  async function handleForceInsert(dup: DuplicadoDetalle, idx: number) {
    const key = dupKey(dup, idx);
    setForcing(key);
    try {
      const res = await fetch("/api/forzar-movimiento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: documentoId, fecha: dup.fecha, descripcion: dup.descripcion, monto: dup.monto, tipo_flujo: dup.tipo_flujo, motivo: dup.motivo }),
      });
      if (res.ok) { toast("Enviado a revisar"); setRemoved((prev) => new Set(prev).add(key)); }
      else toast("Error al agregar", "error");
    } catch { toast("Error al agregar", "error"); }
    setForcing(null); setConfirmId(null);
  }

  async function handleOcultar(dup: DuplicadoDetalle, idx: number) {
    const key = dupKey(dup, idx);
    setLocalOcultos((prev) => new Set(prev).add(key));
    try {
      await fetch("/api/ocultar-omitido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: documentoId, fecha: dup.fecha, monto: dup.monto, descripcion: dup.descripcion, ocultar: true }),
      });
    } catch { /* persist failed but local state updated */ }
  }

  async function handleRecuperar(dup: DuplicadoDetalle, idx: number) {
    const key = dupKey(dup, idx);
    setLocalOcultos((prev) => { const n = new Set(prev); n.delete(key); return n; });
    try {
      await fetch("/api/ocultar-omitido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: documentoId, fecha: dup.fecha, monto: dup.monto, descripcion: dup.descripcion, ocultar: false }),
      });
    } catch { /* persist failed but local state updated */ }
  }

  // Selectable: non-info activos
  const selectableKeys = activos
    .map((dup) => {
      const origIdx = duplicados.indexOf(dup);
      const dupTipo = (dup as DuplicadoDetalle & { tipo?: TipoDuplicado }).tipo;
      if (dupTipo === "multi_transfer_p2p") return null;
      return { key: dupKey(dup, origIdx), dup, origIdx };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const allSelected = selectableKeys.length > 0 && selectableKeys.every((s) => selected.has(s.key));
  const selectedCount = selectableKeys.filter((s) => selected.has(s.key)).length;

  function toggleSelect(key: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }
  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(selectableKeys.map((s) => s.key)));
  }

  async function handleBatchInsert() {
    const items = selectableKeys.filter((s) => selected.has(s.key));
    if (items.length === 0) return;
    setBatchLoading(true);
    const newRemoved = new Set(removed);
    let ok = 0;
    for (const { key, dup } of items) {
      try {
        const res = await fetch("/api/forzar-movimiento", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documento_id: documentoId, fecha: dup.fecha, descripcion: dup.descripcion, monto: dup.monto, tipo_flujo: dup.tipo_flujo, motivo: dup.motivo }) });
        if (res.ok) { newRemoved.add(key); ok++; }
      } catch { /* skip */ }
    }
    setRemoved(newRemoved); setSelected(new Set());
    if (ok > 0) toast(`${ok} enviado${ok !== 1 ? "s" : ""} a revisar`);
    if (ok < items.length) toast(`${items.length - ok} fallaron`, "error");
    setBatchLoading(false);
  }

  async function handleBatchOcultar() {
    const items = selectableKeys.filter((s) => selected.has(s.key));
    for (const { dup } of items) {
      const origIdx = duplicados.indexOf(dup);
      await handleOcultar(dup, origIdx);
    }
    setSelected(new Set());
    toast(`${items.length} oculto${items.length !== 1 ? "s" : ""}`);
  }

  function renderItem(dup: DuplicadoDetalle, showCheckbox: boolean, showActions: boolean) {
    const origIdx = duplicados.indexOf(dup);
    const key = dupKey(dup, origIdx);
    const isConfirming = confirmId === key;
    const dupTipo = (dup as DuplicadoDetalle & { tipo?: TipoDuplicado }).tipo;
    const isConfirmed = dupTipo === "otro_doc_confirmado" || dupTipo === "mismo_ndoc_mismo_arch" || dupTipo === "mismo_ndoc_otro_arch";
    // Informational: guardado, sin acciones — multi_transfer_p2p o info_only de bypass mode
    const isInfo = dupTipo === "multi_transfer_p2p" || dup.info_only === true;
    const iconColor = isInfo ? "text-[#3B82F6]" : isConfirmed ? "text-[#E8553E]" : "text-[#F59E0B]";
    const IconComp = isInfo ? Info : isConfirmed ? XCircle : WarningCircle;
    const btnLabel = isConfirmed ? "Agregar igual" : "Agregar";

    return (
      <div key={origIdx} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-[10px] space-y-1 animate-fade-in">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {showCheckbox && !isInfo && (
              <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSelect(key)}
                className="w-3 h-3 rounded accent-[#E8553E] shrink-0" />
            )}
            <IconComp size={12} weight="fill" className={`${iconColor} shrink-0`} />
            <div className="flex-1 min-w-0">
              <p className="text-[var(--foreground)] truncate">{dup.descripcion}</p>
              <div className="flex items-center gap-2 text-[var(--muted-light)] mt-0.5">
                <span>{formatFechaCorta(dup.fecha)}</span>
                {dup.monto > 0 && <span className="tabular-nums">{fmt(dup.monto)}</span>}
                {dup.n_documento && <span className="text-[var(--muted)]">#{dup.n_documento}</span>}
              </div>
            </div>
          </div>
          {showActions && !isConfirming && !isInfo && (
            <div className="flex gap-1 shrink-0">
              <button onClick={() => setConfirmId(key)} disabled={!!forcing}
                className="btn-press text-[9px] text-[#E8553E] bg-[var(--accent-light)] hover:bg-[#FFE4E0] rounded px-2 py-1 transition-colors">
                {btnLabel}
              </button>
              <button onClick={() => handleOcultar(dup, origIdx)}
                className="btn-press text-[9px] text-[var(--muted-light)] bg-[var(--surface)] hover:bg-[var(--border)] rounded px-1.5 py-1 transition-colors">
                <EyeSlash size={12} />
              </button>
            </div>
          )}
          {!showActions && (
            <button onClick={() => handleRecuperar(dup, origIdx)}
              className="btn-press text-[9px] text-[#3B82F6] hover:text-[#2563EB] transition-colors flex items-center gap-1">
              <Eye size={10} /> Recuperar
            </button>
          )}
        </div>
        {(() => {
          const filaPropia = dup.excel_row ?? (typeof dup.indice_archivo === "number" ? dup.indice_archivo + 1 : undefined);
          const filaConflicto = dup.excel_row_conflicto ?? (typeof dup.indice_conflicto === "number" ? dup.indice_conflicto + 1 : undefined);
          return (
            <>
              {dup.saldo_check === "operaciones_reales" && (
                <p className="text-[10px] text-[#22C55E] font-medium flex items-center gap-1">
                  <WarningCircle size={10} weight="fill" />
                  Operaciones reales confirmadas — la columna SALDO se mueve exactamente {fmt(dup.monto)} entre la fila {filaPropia ?? "?"} y la fila {filaConflicto ?? "?"}. Sugerido: Agregar igual.
                </p>
              )}
              <p className={`italic ${isInfo ? "text-[#3B82F6]" : "text-[var(--muted-light)]"}`}>
                {!isInfo && typeof filaPropia === "number" && (
                  <span className="not-italic font-medium text-[var(--foreground)]">Fila {filaPropia} — </span>
                )}
                {dup.motivo}
              </p>
            </>
          );
        })()}
        {dup.origen_documento_nombre !== "Este archivo" && (
          <p className="text-[var(--muted-light)] flex items-center gap-1">
            <Warning size={10} className="text-[#F59E0B] shrink-0" />
            Ya registrado en {dup.origen_documento_nombre}
            {dup.origen_documento_fecha && ` (${formatFechaCorta(dup.origen_documento_fecha)})`}
          </p>
        )}
        {isConfirming && (
          <div className="bg-[var(--accent-light)] rounded-lg px-2.5 py-2 space-y-1.5 animate-fade-in">
            <p className="text-[var(--foreground)]">Se enviará a /revisar como pendiente. ¿Continuar?</p>
            <div className="flex gap-1.5">
              <button onClick={() => handleForceInsert(dup, origIdx)} disabled={!!forcing}
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
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      {hasWarning && (
        <div className="flex items-start gap-1.5 text-[10px] text-[#F59E0B] bg-[#FFF8ED] dark:bg-[#F59E0B]/10 rounded-lg px-2.5 py-2">
          <Warning size={12} weight="fill" className="shrink-0 mt-0.5" />
          <span>Esta cartola tiene transferencias del mismo monto y descripción. Verifica que no sean operaciones distintas de diferentes personas.</span>
        </div>
      )}

      {/* Active omitidos */}
      {activos.length > 0 && (
        <>
          <button onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-[10px] text-[#F59E0B] hover:text-[#D97706] transition-colors">
            <ArrowUUpLeft size={12} weight="bold" />
            <span>Ver {activos.length} omitido{activos.length !== 1 ? "s" : ""}</span>
            <CaretDown size={10} weight="bold" className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </button>

          {expanded && (
            <div className="space-y-1.5 animate-fade-in">
              {selectableKeys.length > 1 && (
                <div className="flex items-center justify-between px-1 gap-1.5">
                  <label className="flex items-center gap-1.5 text-[10px] text-[var(--muted)] cursor-pointer">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-3 h-3 rounded accent-[#E8553E]" />
                    Seleccionar todos
                  </label>
                  {selectedCount > 0 && (
                    <div className="flex gap-1">
                      <button onClick={handleBatchInsert} disabled={batchLoading}
                        className="btn-press text-[9px] bg-[#E8553E] text-white rounded px-2 py-1 disabled:opacity-50">
                        {batchLoading ? "..." : `Agregar (${selectedCount})`}
                      </button>
                      <button onClick={handleBatchOcultar} disabled={batchLoading}
                        className="btn-press text-[9px] text-[var(--muted)] bg-[var(--surface)] hover:bg-[var(--border)] rounded px-2 py-1">
                        Ocultar ({selectedCount})
                      </button>
                    </div>
                  )}
                </div>
              )}
              {activos.map((dup) => renderItem(dup, true, true))}
            </div>
          )}
        </>
      )}

      {/* Hidden omitidos */}
      {ocultos.length > 0 && (
        <>
          <button onClick={() => setExpandedOcultos(!expandedOcultos)}
            className="flex items-center gap-1.5 text-[10px] text-[var(--muted-light)] hover:text-[var(--muted)] transition-colors">
            <EyeSlash size={12} />
            <span>{ocultos.length} oculto{ocultos.length !== 1 ? "s" : ""}</span>
            <CaretDown size={10} weight="bold" className={`transition-transform duration-200 ${expandedOcultos ? "rotate-180" : ""}`} />
          </button>

          {expandedOcultos && (
            <div className="space-y-1.5 animate-fade-in opacity-60">
              {ocultos.map((dup) => renderItem(dup, false, false))}
            </div>
          )}
        </>
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

            <ProgresoBar progreso={progreso} estado={doc.estado} />

            {progreso?.estado === "error" && (
              <p className="text-xs text-[#E8553E] mt-1 truncate">Error: {progreso.error}</p>
            )}

            {/* Duplicates visor — shown when there are skipped dups OR informational warnings */}
            {doc.estado === "procesado" && (dupCount > 0 || duplicados.length > 0) && (
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
