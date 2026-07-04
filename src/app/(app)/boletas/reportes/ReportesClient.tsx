"use client";

import { useEffect, useMemo, useState } from "react";
import { DownloadSimple, ArrowClockwise } from "@phosphor-icons/react";
import { useToast } from "@/components/Toast";

interface RCVRow {
  id: string;
  tipo_dte: number;
  folio: number;
  fecha_emision: string;
  receptor_rut: string | null;
  receptor_razon_social: string | null;
  monto_neto: number;
  monto_exento: number;
  iva: number;
  monto_total: number;
  estado: string;
}

interface RCVResponse {
  ok: boolean;
  mes: string;
  resumen_por_tipo: Record<string, { docs: number; neto: number; exento: number; iva: number; total: number }>;
  totales: { docs: number; neto: number; exento: number; iva: number; total: number };
  detalle: RCVRow[];
}

function mesActual(): string {
  return new Date().toISOString().slice(0, 7);
}

function tipoLabel(t: number): string {
  if (t === 39) return "Boleta afecta";
  if (t === 41) return "Boleta exenta";
  if (t === 61) return "Nota de crédito";
  return `Tipo ${t}`;
}

export default function ReportesClient() {
  const { toast } = useToast();
  const [mes, setMes] = useState(mesActual());
  const [data, setData] = useState<RCVResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sii-mock/rcv?mes=${mes}`, { cache: "no-store" });
        const j = (await res.json()) as RCVResponse;
        if (cancelled) return;
        if (!j.ok) toast("Error al cargar reporte", "error");
        else setData(j);
      } catch (err) {
        if (cancelled) return;
        toast(err instanceof Error ? err.message : "Error de red", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mes, reloadKey, toast]);

  function recargar() {
    setReloadKey((k) => k + 1);
  }

  const csv = useMemo(() => {
    if (!data) return "";
    const header = ["Tipo DTE", "Folio", "Fecha", "RUT receptor", "Razón social", "Neto", "Exento", "IVA", "Total", "Estado"];
    const rows = data.detalle.map((r) => [
      r.tipo_dte,
      r.folio,
      r.fecha_emision,
      r.receptor_rut ?? "",
      (r.receptor_razon_social ?? "").replace(/"/g, '""'),
      r.monto_neto,
      r.monto_exento,
      r.iva,
      r.monto_total,
      r.estado,
    ]);
    return [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  }, [data]);

  function descargarCSV() {
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `rcv-ventas-${mes}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="month"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          className="px-3 py-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm"
        />
        <button
          onClick={recargar}
          className="btn-press p-2 rounded-lg bg-black/5 dark:bg-white/10 text-sm"
          title="Refrescar"
          aria-label="Refrescar"
        >
          <ArrowClockwise size={14} weight="bold" className={loading ? "animate-spin" : ""} />
        </button>
        <button
          onClick={descargarCSV}
          disabled={!data || data.detalle.length === 0}
          className="btn-press ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#E8553E] text-white text-sm font-semibold disabled:opacity-40"
        >
          <DownloadSimple size={14} weight="bold" />
          CSV
        </button>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(data.resumen_por_tipo).map(([tipo, r]) => (
              <div key={tipo} className="p-3 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10">
                <div className="text-xs text-[#888] dark:text-white/60 mb-1">{tipoLabel(Number(tipo))}</div>
                <div className="text-lg font-bold tabular-nums">{r.docs}</div>
                <div className="text-xs text-[#888] dark:text-white/60">docs</div>
                <div className="mt-2 text-xs tabular-nums">
                  <div>Neto: ${r.neto.toLocaleString("es-CL")}</div>
                  <div>Exento: ${r.exento.toLocaleString("es-CL")}</div>
                  <div>IVA: ${r.iva.toLocaleString("es-CL")}</div>
                  <div className="font-semibold mt-1">Total: ${r.total.toLocaleString("es-CL")}</div>
                </div>
              </div>
            ))}
            {Object.keys(data.resumen_por_tipo).length === 0 && (
              <div className="col-span-3 p-6 text-center text-sm text-[#888] dark:text-white/60 border border-dashed border-black/10 dark:border-white/10 rounded-xl">
                Sin boletas emitidas en {mes}
              </div>
            )}
          </div>

          {data.detalle.length > 0 && (
            <div className="rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 overflow-hidden">
              <div className="px-4 py-3 border-b border-black/5 dark:border-white/10 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Detalle ({data.totales.docs})</h2>
                <span className="text-xs tabular-nums font-semibold">${data.totales.total.toLocaleString("es-CL")}</span>
              </div>
              <div className="divide-y divide-black/5 dark:divide-white/10 max-h-[60vh] overflow-y-auto">
                {data.detalle.map((r) => (
                  <div key={r.id} className="px-4 py-2.5 flex items-center gap-2 text-xs">
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      r.tipo_dte === 41 ? "bg-[#3B82F6]/15 text-[#3B82F6]" :
                      r.tipo_dte === 61 ? "bg-[#A855F7]/15 text-[#A855F7]" :
                      "bg-[#E8553E]/15 text-[#E8553E]"
                    }`}>
                      {r.tipo_dte}
                    </span>
                    <span className="font-semibold tabular-nums">#{r.folio}</span>
                    <span className="text-[#888] dark:text-white/60">{r.fecha_emision}</span>
                    <span className="flex-1 truncate">{r.receptor_razon_social ?? "—"}</span>
                    <span className="tabular-nums font-medium">${r.monto_total.toLocaleString("es-CL")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
