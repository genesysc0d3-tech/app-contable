"use client";

import { useState, useEffect, useCallback } from "react";
import type { ResumenMes, PropuestaAprobada } from "./actions";
import {
  getResumenMes,
  getHistorico6Meses,
  getPropuestasAprobadas,
} from "./actions";
import { FilePdf, ShareNetwork, CaretRight } from "@phosphor-icons/react";

interface ResumenClientProps {
  empresaId: string;
  empresaNombre: string;
  initialResumen: ResumenMes;
  initialHistorico: { mes: number; anio: number; ingresos: number; egresos: number }[];
  initialMes: number;
  initialAnio: number;
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const TIPO_LABEL: Record<string, string> = {
  boleta: "Boleta",
  factura: "Factura",
  gasto: "Gasto",
  registro_crypto: "Crypto",
  ignorar: "No comercial",
};

type Vista = "diario" | "semanal" | "mensual" | "anual" | "todo";

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

// --- Subcomponents ---

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2.5 text-center">
      <p className="text-[10px] text-[var(--muted-light)]">{label}</p>
      <p className={`text-sm font-semibold mt-0.5 ${color ?? "text-[var(--foreground)]"}`}>{value}</p>
    </div>
  );
}

function BarChart({
  data,
}: {
  data: { mes: number; anio: number; ingresos: number; egresos: number }[];
}) {
  const max = Math.max(...data.flatMap((d) => [d.ingresos, d.egresos]), 1);

  return (
    <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none border border-[var(--border)] p-4">
      <p className="text-xs text-[var(--muted)] mb-3">Últimos 6 meses</p>
      <div className="flex items-end gap-2 h-32">
        {data.map((d) => (
          <div key={`${d.anio}-${d.mes}`} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex gap-0.5 items-end" style={{ height: "100px" }}>
              <div
                className="flex-1 bg-[#22C55E] rounded-t"
                style={{ height: `${(d.ingresos / max) * 100}%`, minHeight: d.ingresos > 0 ? "2px" : 0 }}
              />
              <div
                className="flex-1 bg-[#E8553E]/50 rounded-t"
                style={{ height: `${(d.egresos / max) * 100}%`, minHeight: d.egresos > 0 ? "2px" : 0 }}
              />
            </div>
            <span className="text-[9px] text-[var(--muted-light)]">
              {MESES[d.mes - 1]?.slice(0, 3)}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-4 mt-2 justify-center">
        <span className="text-[10px] text-[var(--muted-light)] flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[#22C55E]" /> Ingresos
        </span>
        <span className="text-[10px] text-[var(--muted-light)] flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-[#E8553E]/50" /> Egresos
        </span>
      </div>
    </div>
  );
}

function TipoPieTable({ porTipo }: { porTipo: Record<string, { count: number; total: number }> }) {
  const entries = Object.entries(porTipo).sort((a, b) => b[1].total - a[1].total);
  if (entries.length === 0) return null;

  return (
    <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border)]">
        <p className="text-xs text-[var(--muted)]">Por tipo tributario</p>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {entries.map(([tipo, { count, total }]) => (
          <div key={tipo} className="px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--muted)]">{TIPO_LABEL[tipo] ?? tipo}</span>
              <span className="text-[10px] text-[var(--muted-light)]">{count}</span>
            </div>
            <span className="text-xs font-medium text-[var(--foreground)]">{fmt(total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BorradorF29({
  resumen,
  mes,
  anio,
  empresaNombre,
}: {
  resumen: ResumenMes;
  mes: number;
  anio: number;
  empresaNombre: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const ppm = Math.round(resumen.totalIngresos * 0.0025);
  const ivaPagar = Math.max(0, Math.round(resumen.ivaDebito - resumen.ivaCredito));
  const totalPagar = ivaPagar + ppm;

  const textoF29 = [
    `BORRADOR F29 — ${MESES[mes - 1]} ${anio}`,
    `Empresa: ${empresaNombre}`,
    ``,
    `Línea 1  - Débito fiscal (IVA ventas): ${fmt(resumen.ivaDebito)}`,
    `Línea 20 - Crédito fiscal (IVA compras): ${fmt(resumen.ivaCredito)}`,
    `Línea 48 - IVA a pagar: ${fmt(ivaPagar)}`,
    `Línea 142 - PPM (0,25% ingresos brutos): ${fmt(ppm)}`,
    ``,
    `Total a pagar: ${fmt(totalPagar)}`,
    ``,
    `⚠️ Este es un borrador estimado. Debe ser revisado y presentado por un contador habilitado.`,
  ].join("\n");

  function handleCopiar() {
    navigator.clipboard.writeText(textoF29);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none border border-[var(--border)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[var(--surface)] transition-colors"
      >
        <span
          className="text-[var(--muted-light)] text-sm transition-transform duration-200"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        <span className="text-sm font-medium text-[var(--foreground)]">
          Borrador F29 — {MESES[mes - 1]} {anio}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="space-y-2">
            <Row label="Línea 1 — Débito fiscal (IVA ventas)" value={fmt(resumen.ivaDebito)} />
            <Row label="Línea 20 — Crédito fiscal (IVA compras)" value={fmt(resumen.ivaCredito)} />
            <Row label="Línea 48 — IVA a pagar" value={fmt(ivaPagar)} highlight />
            <Row label="Línea 142 — PPM (0,25% ingresos brutos)" value={fmt(ppm)} />
            <div className="border-t border-[var(--border)] pt-2">
              <Row label="Total a pagar mes" value={fmt(totalPagar)} highlight />
            </div>
          </div>

          <p className="text-[10px] text-[#F59E0B]/60 bg-[#FFF8ED] rounded-lg px-3 py-2">
            Este es un borrador estimado. Debe ser revisado y presentado por un contador habilitado.
          </p>

          <button
            onClick={handleCopiar}
            className="w-full rounded-xl bg-[var(--accent-light)] hover:bg-blue-500/30 px-4 py-2.5 text-xs font-medium text-[#E8553E] transition-colors"
          >
            <ShareNetwork size={14} weight="bold" className="inline mr-1 -mt-0.5" />{copied ? "Copiado al portapapeles" : "Compartir con contador"}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <span className={`text-xs font-medium ${highlight ? "text-[var(--foreground)]" : "text-[var(--muted)]"}`}>
        {value}
      </span>
    </div>
  );
}

// --- Historico views ---

function HistoricoSection({ empresaId }: { empresaId: string }) {
  const [vista, setVista] = useState<Vista>("mensual");
  const [fecha, setFecha] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  const [mesH, setMesH] = useState(new Date().getMonth() + 1);
  const [anioH, setAnioH] = useState(new Date().getFullYear());
  const [propuestas, setPropuestas] = useState<PropuestaAprobada[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const PAGE_SIZE = 30;

  const fetchData = useCallback(async () => {
    setLoading(true);
    let desde: string | undefined;
    let hasta: string | undefined;

    if (vista === "diario") {
      desde = fecha;
      const next = new Date(fecha);
      next.setDate(next.getDate() + 1);
      hasta = next.toISOString().slice(0, 10);
    } else if (vista === "semanal") {
      const d = new Date(fecha);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 7);
      desde = monday.toISOString().slice(0, 10);
      hasta = sunday.toISOString().slice(0, 10);
    } else if (vista === "mensual") {
      desde = `${anioH}-${String(mesH).padStart(2, "0")}-01`;
      const em = mesH === 12 ? 1 : mesH + 1;
      const ea = mesH === 12 ? anioH + 1 : anioH;
      hasta = `${ea}-${String(em).padStart(2, "0")}-01`;
    } else if (vista === "anual") {
      desde = `${anioH}-01-01`;
      hasta = `${anioH + 1}-01-01`;
    }
    // "todo" -> no date filters

    const res = await getPropuestasAprobadas(
      empresaId,
      desde,
      hasta,
      vista === "todo" ? PAGE_SIZE : undefined,
      vista === "todo" ? page * PAGE_SIZE : undefined
    );
    setPropuestas(res.data);
    setTotal(res.total);
    setLoading(false);
  }, [empresaId, vista, fecha, mesH, anioH, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-3">
      {/* Vista selector */}
      <div className="flex gap-1 overflow-x-auto">
        {(["diario", "semanal", "mensual", "anual", "todo"] as Vista[]).map((v) => (
          <button
            key={v}
            onClick={() => { setVista(v); setPage(0); }}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-medium transition-colors ${
              vista === v ? "bg-[var(--accent-light)] text-[#E8553E]" : "bg-[var(--surface)] text-[var(--muted-light)] hover:bg-[var(--surface)]"
            }`}
          >
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* Period selector */}
      {(vista === "diario" || vista === "semanal") && (
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:border-[var(--accent)]"
        />
      )}
      {(vista === "mensual" || vista === "anual") && (
        <div className="flex gap-2">
          {vista === "mensual" && (
            <select
              value={mesH}
              onChange={(e) => setMesH(Number(e.target.value))}
              className="flex-1 rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent)]"
            >
              {MESES.map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
          )}
          <select
            value={anioH}
            onChange={(e) => setAnioH(Number(e.target.value))}
            className={`${vista === "mensual" ? "w-24" : "flex-1"} rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--accent)]`}
          >
            {[2024, 2025, 2026, 2027].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <p className="text-center text-[var(--muted-light)] text-xs py-8">Cargando...</p>
      ) : propuestas.length === 0 ? (
        <p className="text-center text-[var(--muted-light)] text-xs py-8">Sin movimientos aprobados</p>
      ) : (
        <div className="rounded-[20px] bg-white dark:bg-white/5 shadow-[var(--card-shadow)] dark:shadow-none border border-[var(--border)] overflow-hidden">
          <div className="divide-y divide-[var(--border)]">
            {propuestas.map((p) => {
              const mov = p.movimientos_raw;
              return (
                <div key={p.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--foreground)] truncate">{mov.descripcion}</p>
                    <div className="flex gap-2 mt-0.5 text-[10px] text-[var(--muted-light)]">
                      <span>{mov.fecha}</span>
                      <span>{TIPO_LABEL[p.tipo_propuesto] ?? p.tipo_propuesto}</span>
                      {p.receptor_nombre && <span className="truncate">{p.receptor_nombre}</span>}
                    </div>
                  </div>
                  <span className={`text-xs font-medium shrink-0 ${
                    mov.tipo_flujo === "entrada" ? "text-[#22C55E]" : "text-[#E8553E]"
                  }`}>
                    {mov.tipo_flujo === "entrada" ? "+" : "-"}{fmt(mov.monto)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination for "todo" */}
      {vista === "todo" && total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg bg-[var(--surface)] hover:bg-[var(--surface)] disabled:opacity-30 px-3 py-1.5 text-[10px] text-[var(--muted)] transition-colors"
          >
            Anterior
          </button>
          <span className="text-[10px] text-[var(--muted-light)]">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= total}
            className="rounded-lg bg-[var(--surface)] hover:bg-[var(--surface)] disabled:opacity-30 px-3 py-1.5 text-[10px] text-[var(--muted)] transition-colors"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

// --- PDF Export ---

async function exportarPDF(
  empresaNombre: string,
  mes: number,
  anio: number,
  resumen: ResumenMes
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  const ppm = Math.round(resumen.totalIngresos * 0.0025);
  const ivaPagar = Math.max(0, Math.round(resumen.ivaDebito - resumen.ivaCredito));
  const totalPagar = ivaPagar + ppm;

  let y = 20;
  doc.setFontSize(16);
  doc.text(`Resumen Mensual — ${MESES[mes - 1]} ${anio}`, 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(empresaNombre, 14, y);
  y += 12;

  // Resumen table
  doc.setFontSize(12);
  doc.text("Resumen", 14, y);
  y += 8;
  doc.setFontSize(10);
  const rows = [
    ["Total ingresos", fmt(resumen.totalIngresos)],
    ["Total egresos", fmt(resumen.totalEgresos)],
    ["Resultado del mes", fmt(resumen.resultado)],
    ["IVA débito", fmt(resumen.ivaDebito)],
    ["IVA crédito", fmt(resumen.ivaCredito)],
  ];
  for (const [label, val] of rows) {
    doc.text(label, 14, y);
    doc.text(val, 120, y);
    y += 6;
  }
  y += 6;

  // Por tipo
  const tipos = Object.entries(resumen.porTipo);
  if (tipos.length > 0) {
    doc.setFontSize(12);
    doc.text("Por tipo tributario", 14, y);
    y += 8;
    doc.setFontSize(10);
    for (const [tipo, { count, total }] of tipos) {
      doc.text(`${TIPO_LABEL[tipo] ?? tipo} (${count})`, 14, y);
      doc.text(fmt(total), 120, y);
      y += 6;
    }
    y += 6;
  }

  // F29
  doc.setFontSize(12);
  doc.text(`Borrador F29 — ${MESES[mes - 1]} ${anio}`, 14, y);
  y += 8;
  doc.setFontSize(10);
  const f29Rows = [
    ["Línea 1 — Débito fiscal", fmt(resumen.ivaDebito)],
    ["Línea 20 — Crédito fiscal", fmt(resumen.ivaCredito)],
    ["Línea 48 — IVA a pagar", fmt(ivaPagar)],
    ["Línea 142 — PPM (0,25%)", fmt(ppm)],
    ["Total a pagar", fmt(totalPagar)],
  ];
  for (const [label, val] of f29Rows) {
    doc.text(label, 14, y);
    doc.text(val, 120, y);
    y += 6;
  }
  y += 6;
  doc.setFontSize(8);
  doc.text("Este es un borrador estimado. Debe ser revisado por un contador habilitado.", 14, y);

  doc.save(`resumen-${anio}-${String(mes).padStart(2, "0")}.pdf`);
}

// --- Main component ---

export default function ResumenClient({
  empresaId,
  empresaNombre,
  initialResumen,
  initialHistorico,
  initialMes,
  initialAnio,
}: ResumenClientProps) {
  const [mes, setMes] = useState(initialMes);
  const [anio, setAnio] = useState(initialAnio);
  const [resumen, setResumen] = useState<ResumenMes>(initialResumen);
  const [historico, setHistorico] = useState(initialHistorico);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mes === initialMes && anio === initialAnio) return;
    setLoading(true);
    Promise.all([
      getResumenMes(empresaId, anio, mes),
      getHistorico6Meses(empresaId, anio, mes),
    ]).then(([r, h]) => {
      setResumen(r);
      setHistorico(h);
      setLoading(false);
    });
  }, [empresaId, mes, anio, initialMes, initialAnio]);

  return (
    <div className="flex-1 pb-20">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold text-[var(--foreground)]">Resumen</h1>
            <p className="text-sm text-[var(--muted)] mt-0.5">{empresaNombre}</p>
          </div>
          <button
            onClick={() => exportarPDF(empresaNombre, mes, anio, resumen)}
            className="rounded-xl bg-[#E8553E] hover:bg-[var(--accent-hover)] px-4 py-2.5 text-xs font-semibold text-white transition-colors"
          >
            <FilePdf size={16} weight="bold" className="inline mr-1 -mt-0.5" />Exportar PDF
          </button>
        </div>

        {/* Month/Year selector */}
        <div className="flex gap-2">
          <select
            value={mes}
            onChange={(e) => setMes(Number(e.target.value))}
            className="flex-1 rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--accent)]"
          >
            {MESES.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            className="w-24 rounded-xl bg-[var(--surface)] border border-[var(--border)] px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[var(--accent)]"
          >
            {[2024, 2025, 2026, 2027].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="text-center text-[var(--muted-light)] text-xs py-8">Cargando...</p>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-2">
              <Card label="Ingresos" value={fmt(resumen.totalIngresos)} color="text-[#22C55E]" />
              <Card label="Egresos" value={fmt(resumen.totalEgresos)} color="text-[#E8553E]" />
              <Card label="IVA débito" value={fmt(resumen.ivaDebito)} />
              <Card label="IVA crédito" value={fmt(resumen.ivaCredito)} />
            </div>
            <Card
              label="Resultado del mes"
              value={fmt(resumen.resultado)}
              color={resumen.resultado >= 0 ? "text-[#22C55E]" : "text-[#E8553E]"}
            />

            {/* Bar chart */}
            <BarChart data={historico} />

            {/* Por tipo */}
            <TipoPieTable porTipo={resumen.porTipo} />

            {/* Borrador F29 */}
            <BorradorF29
              resumen={resumen}
              mes={mes}
              anio={anio}
              empresaNombre={empresaNombre}
            />
          </>
        )}

        {/* Historico */}
        <div className="border-t border-[var(--border)] pt-4">
          <h2 className="text-lg font-semibold text-[var(--foreground)] mb-3">Histórico</h2>
          <HistoricoSection empresaId={empresaId} />
        </div>
      </div>
    </div>
  );
}
