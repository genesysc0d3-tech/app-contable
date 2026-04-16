"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { PaperPlaneTilt, CheckCircle, Warning, ArrowClockwise, FunnelSimple } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

interface PendienteItem {
  id: string;
  descripcion: string;
  fecha: string;
  receptor_rut: string | null;
  receptor_nombre: string | null;
  monto_total: number;
  listo_emitir: boolean;
  motivo_no_listo: string | null;
}

interface PendientesResponse {
  ok: boolean;
  items: PendienteItem[];
  totales: {
    total_pendientes: number;
    listas_emitir: number;
    bloqueadas: number;
    monto_total: number;
    monto_listo: number;
  };
}

interface BatchResult {
  ok: boolean;
  procesadas: number;
  exitos: number;
  fallos: number;
  monto_emitido: number;
  resultados: { propuesta_id: string; ok: boolean; folio?: number; error_message?: string }[];
}

type Filtro = "todas" | "listas" | "bloqueadas";

export default function EmitirBoletaForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = useState<PendienteItem[]>([]);
  const [totales, setTotales] = useState<PendientesResponse["totales"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [emitiendo, setEmitiendo] = useState(false);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [filtro, setFiltro] = useState<Filtro>("listas");
  const [progreso, setProgreso] = useState<{ procesadas: number; total: number } | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/intermediaria/pendientes-emision", { cache: "no-store" });
      const j = (await res.json()) as PendientesResponse;
      if (j.ok) {
        setItems(j.items);
        setTotales(j.totales);
        // Auto-seleccionar las listas en el primer load
        setSeleccionadas((prev) => {
          if (prev.size > 0) return prev;
          return new Set(j.items.filter((i) => i.listo_emitir).map((i) => i.id));
        });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error cargando pendientes", "error");
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { cargar(); }, [cargar]);

  const filtradas = useMemo(() => {
    if (filtro === "listas") return items.filter((i) => i.listo_emitir);
    if (filtro === "bloqueadas") return items.filter((i) => !i.listo_emitir);
    return items;
  }, [items, filtro]);

  const idsSelEmitibles = useMemo(
    () => filtradas.filter((i) => i.listo_emitir && seleccionadas.has(i.id)).map((i) => i.id),
    [filtradas, seleccionadas],
  );
  const montoSeleccionado = useMemo(() => {
    return idsSelEmitibles.reduce((s, id) => s + (items.find((i) => i.id === id)?.monto_total ?? 0), 0);
  }, [idsSelEmitibles, items]);

  function toggleOne(id: string) {
    setSeleccionadas((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    const visiblesEmitibles = filtradas.filter((i) => i.listo_emitir).map((i) => i.id);
    const allSelected = visiblesEmitibles.every((id) => seleccionadas.has(id));
    setSeleccionadas((prev) => {
      const n = new Set(prev);
      if (allSelected) {
        for (const id of visiblesEmitibles) n.delete(id);
      } else {
        for (const id of visiblesEmitibles) n.add(id);
      }
      return n;
    });
  }

  async function emitirSeleccionadas() {
    if (idsSelEmitibles.length === 0 || emitiendo) return;
    setEmitiendo(true);
    setProgreso({ procesadas: 0, total: idsSelEmitibles.length });
    try {
      const res = await fetch("/api/intermediaria/emitir-lote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propuesta_ids: idsSelEmitibles }),
      });
      const j = (await res.json()) as BatchResult;
      if (!res.ok || !j.ok) {
        toast("Error en la emisión en lote", "error");
      } else {
        const msg = j.fallos === 0
          ? `${j.exitos} boleta${j.exitos !== 1 ? "s" : ""} emitida${j.exitos !== 1 ? "s" : ""} ($${j.monto_emitido.toLocaleString("es-CL")})`
          : `${j.exitos} emitidas, ${j.fallos} con error`;
        toast(msg, j.fallos > 0 ? "error" : undefined);
        // Si hubo errores, log el primero
        if (j.fallos > 0) {
          const firstErr = j.resultados.find((r) => !r.ok);
          if (firstErr) console.error("[emitir-lote] primer error:", firstErr);
        }
      }
      setSeleccionadas(new Set());
      router.refresh();
      await cargar();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error de red", "error");
    }
    setEmitiendo(false);
    setProgreso(null);
  }

  if (loading) {
    return (
      <div className="px-5 py-10 space-y-2">
        <div className="animate-shimmer h-5 w-48 rounded" />
        <div className="animate-shimmer h-12 rounded-xl" />
        <div className="animate-shimmer h-12 rounded-xl" />
        <div className="animate-shimmer h-12 rounded-xl" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-12 text-center">
        <div className="w-12 h-12 rounded-2xl neo-inset flex items-center justify-center text-[var(--muted)] mb-3">
          <PaperPlaneTilt size={20} weight="light" />
        </div>
        <p className="text-[13px] font-medium text-[var(--foreground)]">
          No hay propuestas listas para emitir
        </p>
        <p className="text-[11px] text-[var(--muted-light)] mt-1 max-w-[280px]">
          Aprobá propuestas tipo <b>boleta</b> en Revisar — aparecen acá automáticamente.
        </p>
      </div>
    );
  }

  return (
    <div className="px-5 py-3 pb-24 space-y-3">
      {/* Stats + filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[20px] font-light tabular-nums text-[var(--foreground)]">
            {totales?.listas_emitir ?? 0}
          </span>
          <span className="text-[11px] text-[var(--muted)]">listas para emitir</span>
        </div>
        {(totales?.bloqueadas ?? 0) > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-[#F59E0B] bg-[#F59E0B]/10 rounded-full px-2 py-0.5 font-medium">
            <Warning size={10} weight="fill" />
            {totales?.bloqueadas} bloqueada{(totales?.bloqueadas ?? 0) !== 1 ? "s" : ""}
          </span>
        )}
        <button
          type="button"
          onClick={cargar}
          className="ml-auto p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors"
          title="Refrescar"
          aria-label="Refrescar"
        >
          <ArrowClockwise size={14} weight="bold" />
        </button>
      </div>

      {/* Filtros pills */}
      <div className="flex items-center gap-1 text-[10px]">
        <FunnelSimple size={11} weight="bold" className="text-[var(--muted-light)]" />
        {([
          { id: "listas" as Filtro, label: `Listas (${totales?.listas_emitir ?? 0})` },
          { id: "bloqueadas" as Filtro, label: `Bloqueadas (${totales?.bloqueadas ?? 0})` },
          { id: "todas" as Filtro, label: `Todas (${items.length})` },
        ]).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={`px-2 py-1 rounded-md font-semibold transition-colors ${
              filtro === f.id
                ? "bg-[var(--accent-light)] text-[#E8553E]"
                : "text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Toggle seleccionar todas */}
      {filtradas.some((i) => i.listo_emitir) && (
        <label className="flex items-center gap-2 text-[11px] text-[var(--muted)] cursor-pointer">
          <input
            type="checkbox"
            checked={filtradas.filter((i) => i.listo_emitir).every((i) => seleccionadas.has(i.id))}
            onChange={toggleAll}
            className="w-3.5 h-3.5 rounded accent-[#E8553E]"
          />
          <span>Seleccionar todas las visibles ({filtradas.filter((i) => i.listo_emitir).length})</span>
        </label>
      )}

      {/* Lista */}
      <div className="space-y-1.5">
        {filtradas.map((it) => {
          const sel = seleccionadas.has(it.id);
          const disabled = !it.listo_emitir;
          return (
            <div
              key={it.id}
              onClick={() => !disabled && toggleOne(it.id)}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all ${
                disabled
                  ? "border-[#F59E0B]/30 bg-[#F59E0B]/5 cursor-not-allowed opacity-70"
                  : sel
                  ? "border-[#E8553E] bg-[var(--accent-light)] cursor-pointer"
                  : "border-[var(--border)] bg-transparent hover:border-[var(--muted-light)] cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={sel}
                disabled={disabled}
                onChange={() => toggleOne(it.id)}
                onClick={(e) => e.stopPropagation()}
                className="w-3.5 h-3.5 rounded accent-[#E8553E] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-[var(--foreground)] truncate font-medium">{it.descripcion}</p>
                <p className="text-[10px] text-[var(--muted-light)] truncate mt-0.5">
                  {it.receptor_nombre ?? "Sin receptor"}
                  {it.receptor_rut ? ` · ${it.receptor_rut}` : ""}
                  <span className="text-[var(--muted-light)] ml-1">· {formatFecha(it.fecha)}</span>
                </p>
                {disabled && it.motivo_no_listo && (
                  <p className="text-[10px] text-[#F59E0B] mt-0.5 flex items-center gap-1">
                    <Warning size={9} weight="fill" />
                    {it.motivo_no_listo}
                  </p>
                )}
              </div>
              <p className="text-[12px] tabular-nums font-semibold text-[var(--foreground)] shrink-0">
                ${it.monto_total.toLocaleString("es-CL")}
              </p>
            </div>
          );
        })}
      </div>

      {/* Sticky bar de acción */}
      {idsSelEmitibles.length > 0 && (
        <div className="sticky bottom-2 -mx-5 px-5 z-10 mt-3 animate-fade-in-up">
          <div className="rounded-2xl bg-[var(--neo-bg)] border border-[var(--border)] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.25)] dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6)] flex items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-[var(--muted)] leading-tight">
              {idsSelEmitibles.length} seleccionada{idsSelEmitibles.length !== 1 ? "s" : ""}
              {progreso && ` · ${progreso.procesadas}/${progreso.total} en proceso`}
            </p>
            <p className="text-[14px] font-semibold tabular-nums text-[var(--foreground)] leading-tight mt-0.5">
              Total: ${montoSeleccionado.toLocaleString("es-CL")}
            </p>
          </div>
          <button
            type="button"
            onClick={emitirSeleccionadas}
            disabled={emitiendo}
            className="btn-press flex items-center gap-2 rounded-xl bg-[#E8553E] text-white font-semibold text-[12px] px-4 py-2.5 disabled:opacity-50 hover:bg-[var(--accent-hover)] transition-colors shrink-0"
          >
            {emitiendo ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Emitiendo...
              </>
            ) : (
              <>
                <CheckCircle size={14} weight="bold" />
                Emitir {idsSelEmitibles.length}
              </>
            )}
          </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatFecha(d: string): string {
  if (!d) return "";
  const date = new Date(d.length === 10 ? d + "T00:00:00" : d);
  if (isNaN(date.getTime())) return d;
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${date.getDate()} ${meses[date.getMonth()]}`;
}
