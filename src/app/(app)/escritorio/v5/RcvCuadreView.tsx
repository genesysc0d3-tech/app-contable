"use client";

import { useMemo, useState } from "react";
import type { SearchItem } from "@/lib/tree-structure";
import { chileDateString } from "@/lib/chile-date";
import { chileDisplayDateKey, chileDisplayMonthKey, formatDisplayDateEsCl } from "@/lib/display-date";

// Vista "RCV · Cuadre del mes": cruza lo emitido con massDTE contra el
// Registro de Compras y Ventas del SII. Fase 1: el lado massDTE es real
// (boletas/facturas emitidas del mes); el lado SII queda explícito como
// "aún no descargado" — la descarga la hará la extensión (libreto RCV,
// solo lectura) y llegará como snapshot por período. Cuando exista, las
// filas "a mano" (folios del RCV que no son nuestros) aparecen en gris.
//
// Granularidad del cruce (así lo guarda el SII):
//  - Facturas y notas (33/34/56/61): documento a documento, POR FOLIO.
//  - Boletas (39/41): el SII solo recibe el TOTAL DEL DÍA (RCOF), así que
//    acá también se muestran como resumen diario, no una por una.

const TIPO_LABEL: Record<number, { label: string; cod: string; color: string }> = {
  33: { label: "Factura", cod: "33", color: "var(--amber)" },
  34: { label: "Factura exenta", cod: "34", color: "var(--amber)" },
  56: { label: "Nota de débito", cod: "56", color: "#4aa3a3" },
  61: { label: "Nota de crédito", cod: "61", color: "#8b5cf6" },
};

type FilaCat = "factura" | "boleta" | "nota";
type RcvCat = "todo" | FilaCat;

// Corre un monthKey "YYYY-MM" en ±N meses.
function shiftMonthKey(key: string, delta: number) {
  const [year, month] = key.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Fila = {
  key: string;
  dateKey: string;
  dateLabel: string;
  folio: string;
  tipoLabel: string;
  tipoCod: string;
  tipoColor: string;
  detalle: string;
  detalleSub: string;
  monto: number;
  esNota: boolean;
  cat: FilaCat;
  docCount: number;
};

const CAT_FILTERS: { key: RcvCat; label: string }[] = [
  { key: "todo", label: "Todos" },
  { key: "factura", label: "Facturas" },
  { key: "boleta", label: "Boletas" },
  { key: "nota", label: "Notas" },
];

// Conteo por tipo para las fichas.
function contarPorTipoRcv(items: SearchItem[], monthKey: string) {
  const counts: Record<RcvCat, number> = { todo: 0, factura: 0, boleta: 0, nota: 0 };
  for (const item of items) {
    if (item.type !== "boleta") continue;
    const fecha = String(item.data?.fecha_emision ?? item.fecha ?? "");
    if (chileDisplayMonthKey(fecha) !== monthKey) continue;
    const tipo = Number(item.data?.tipo_dte ?? 39);
    const cat: FilaCat = tipo === 56 || tipo === 61 ? "nota" : TIPO_LABEL[tipo] ? "factura" : "boleta";
    counts[cat] += 1;
    counts.todo += 1;
  }
  return counts;
}

function fmtMoney(n: number) {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function fmtDateLong(fecha: string) {
  return formatDisplayDateEsCl(fecha, { day: "numeric", month: "long", year: "numeric" });
}

export default function RcvCuadreView({ items, notice }: { items: SearchItem[]; notice: string | null }) {
  const [monthKey, setMonthKey] = useState(() => chileDateString().slice(0, 7));
  const [catFilter, setCatFilter] = useState<RcvCat>("todo");
  const esMesActual = monthKey === chileDateString().slice(0, 7);
  const catCounts = useMemo(() => contarPorTipoRcv(items, monthKey), [items, monthKey]);
  const monthLabel = useMemo(() => {
    const label = formatDisplayDateEsCl(`${monthKey}-01`, { month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [monthKey]);

  const { filas } = useMemo(() => {
    // Solo documentos EMITIDOS del mes en curso (fecha de emisión SII).
    const emitidas = items.filter((item) => {
      if (item.type !== "boleta") return false;
      const fecha = String(item.data?.fecha_emision ?? item.fecha ?? "");
      return chileDisplayMonthKey(fecha) === monthKey;
    });

    const individuales: Fila[] = [];
    const boletasPorDia = new Map<string, { count: number; total: number; fecha: string; folioMin: number | null; folioMax: number | null }>();

    for (const item of emitidas) {
      const d = item.data ?? {};
      const fecha = String(d.fecha_emision ?? item.fecha ?? "");
      const dateKey = chileDisplayDateKey(fecha);
      const total = typeof d.monto_total === "number" ? d.monto_total : (item.monto ?? 0);
      const tipoDte = Number(d.tipo_dte ?? 39);

      if (TIPO_LABEL[tipoDte]) {
        // Facturas y notas: cruzan por folio, van una a una.
        const meta = TIPO_LABEL[tipoDte];
        const esNota = tipoDte === 61;
        individuales.push({
          key: item.id,
          dateKey,
          dateLabel: fmtDateLong(fecha),
          // Mismo formato de folio que el resto de la app (#968).
          folio: d.folio ? `#${Number(d.folio)}` : "-",
          tipoLabel: meta.label,
          tipoCod: meta.cod,
          tipoColor: meta.color,
          detalle: String(d.receptor_razon_social ?? item.label),
          detalleSub: d.receptor_rut ? `· ${String(d.receptor_rut)}` : "",
          monto: esNota ? -total : total,
          esNota,
          cat: tipoDte === 56 || tipoDte === 61 ? "nota" : "factura",
          docCount: 1,
        });
      } else {
        // Boletas 39/41: el SII solo ve el total del día (RCOF), pero el RCOF
        // sí reporta el RANGO de folios consumidos — lo mostramos.
        const acc = boletasPorDia.get(dateKey) ?? { count: 0, total: 0, fecha, folioMin: null, folioMax: null };
        acc.count += 1;
        acc.total += total;
        const folio = d.folio != null ? Number(d.folio) : NaN;
        if (!Number.isNaN(folio)) {
          acc.folioMin = acc.folioMin == null ? folio : Math.min(acc.folioMin, folio);
          acc.folioMax = acc.folioMax == null ? folio : Math.max(acc.folioMax, folio);
        }
        boletasPorDia.set(dateKey, acc);
      }
    }

    const resumenes: Fila[] = Array.from(boletasPorDia.entries()).map(([dateKey, acc]) => ({
      key: `boletas-${dateKey}`,
      dateKey,
      dateLabel: fmtDateLong(acc.fecha),
      // Rango de folios del día (lo que el RCOF le informa al SII).
      folio: acc.folioMin == null ? "—" : acc.folioMin === acc.folioMax ? `#${acc.folioMin}` : `#${acc.folioMin}–#${acc.folioMax}`,
      tipoLabel: "Boletas",
      tipoCod: "39",
      tipoColor: "var(--blue)",
      detalle: `Resumen del día · ${acc.count} ${acc.count === 1 ? "boleta" : "boletas"}`,
      detalleSub: "· RCOF",
      monto: acc.total,
      esNota: false,
      cat: "boleta" as const,
      docCount: acc.count,
    }));

    const filas = [...individuales, ...resumenes].sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.folio.localeCompare(a.folio));
    return { filas };
  }, [items, monthKey]);

  const filasFiltradas = useMemo(() => catFilter === "todo" ? filas : filas.filter((f) => f.cat === catFilter), [catFilter, filas]);

  const grupos = useMemo(() => {
    const map = new Map<string, Fila[]>();
    for (const fila of filasFiltradas) map.set(fila.dateLabel, [...(map.get(fila.dateLabel) ?? []), fila]);
    return Array.from(map.entries());
  }, [filasFiltradas]);

  // El resumen sigue al filtro: si miras solo Facturas, el conteo y el total
  // son de facturas.
  const { totalDocs, totalMonto } = useMemo(() => {
    let docs = 0;
    let monto = 0;
    for (const fila of filasFiltradas) { docs += fila.docCount; monto += fila.monto; }
    return { totalDocs: docs, totalMonto: monto };
  }, [filasFiltradas]);

  const filtroLabel = CAT_FILTERS.find((f) => f.key === catFilter)?.label ?? "Todos";

  return (
    <div style={{ minHeight: 0, overflow: "auto", padding: "14px 18px 28px", background: "var(--surface)" }}>
      {/* Barra D2 (elección del fundador): tres segmentos delgados en un
          renglón — datos | mando (mes + fichas) | estado (el amarillo). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {/* Segmento de datos */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "7px 14px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-muted)" }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-.02em", color: "var(--accent)", fontVariantNumeric: "tabular-nums lining-nums" }}>{totalDocs}</span>
            <span style={{ fontSize: 9, color: "var(--text2)", fontWeight: 700 }}>{catFilter === "todo" ? "emitidos" : filtroLabel.toLowerCase()}</span>
          </span>
          <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--border)" }} />
          <span style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 15, fontWeight: 900, letterSpacing: "-.02em", color: "var(--text)", fontVariantNumeric: "tabular-nums lining-nums" }}>{fmtMoney(totalMonto)}</span>
            <span style={{ fontSize: 9, color: "var(--text2)", fontWeight: 700 }}>total</span>
          </span>
          <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--border)" }} />
          <span style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: "var(--text3)" }}>—</span>
            <span style={{ fontSize: 9, color: "var(--text2)", fontWeight: 700 }}>RCV del SII · sin descargar aún</span>
          </span>
        </div>
        {/* Segmento de mando: mes + fichas */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "7px 14px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-muted)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <MonthNavButton label="Mes anterior" onClick={() => setMonthKey((m) => shiftMonthKey(m, -1))}>‹</MonthNavButton>
            <span style={{ minWidth: 96, textAlign: "center", fontSize: 10, fontWeight: 850, color: "var(--text)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{monthLabel}</span>
            <MonthNavButton label="Mes siguiente" disabled={esMesActual} onClick={() => setMonthKey((m) => shiftMonthKey(m, 1))}>›</MonthNavButton>
          </div>
          {CAT_FILTERS.map((f) => {
            const active = catFilter === f.key;
            return (
              <button key={f.key} onClick={() => setCatFilter(f.key)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 999, border: active ? "1px solid rgba(232,85,62,.45)" : "1px solid var(--border)", background: active ? "rgba(232,85,62,.11)" : "var(--surface)", color: active ? "var(--accent)" : "var(--text2)", fontSize: 9, fontWeight: 850, cursor: "pointer", transition: "all .18s ease" }}>
                {f.label}
                <span style={{ fontSize: 8, color: active ? "var(--accent)" : "var(--text3)", fontVariantNumeric: "tabular-nums" }}>{catCounts[f.key]}</span>
              </button>
            );
          })}
        </div>
        {/* Segmento de estado: el amarillo, resumido (detalle en tooltip) */}
        <div title="Cuadre parcial: el RCV del SII aún no se descarga, y las boletas de hoy entran al cierre del día (vía RCOF). El cuadre definitivo queda al terminar el mes, antes del F29." style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", border: "1px solid rgba(245,158,11,.28)", borderRadius: 999, background: "rgba(245,158,11,.06)", color: "var(--amber)", fontSize: 9, fontWeight: 850, whiteSpace: "nowrap", alignSelf: "center" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--amber)", flex: "none" }} />
          <span>{esMesActual ? "Parcial · RCV sin descargar" : "RCV sin descargar"}</span>
        </div>
      </div>

      {notice && (
        <div style={{ marginTop: 10, padding: "11px 14px", borderRadius: 12, border: "1px solid rgba(232,85,62,.24)", background: "rgba(232,85,62,.07)", fontSize: 10.5, color: "var(--text)", fontWeight: 700 }}>
          {notice}
        </div>
      )}

      {/* Tabla del período */}
      {filasFiltradas.length === 0 ? (
        <div style={{ marginTop: 24, padding: 36, textAlign: "center", color: "var(--text2)", fontSize: 11, border: "1px dashed var(--border)", borderRadius: 14 }}>
          {filas.length === 0 ? `Sin documentos emitidos con massDTE en ${monthLabel}. Cuando emitas, acá se cuadran contra el RCV del SII.` : "Sin documentos de este tipo en el mes."}
        </div>
      ) : (
        <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 720 }}>
              <div style={{ display: "grid", gridTemplateColumns: COLUMNS, gap: 10, alignItems: "center", padding: "9px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text2)", fontSize: 8, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".09em" }}>
                <span>Folio</span><span>Tipo</span><span>Detalle</span><span style={{ textAlign: "right" }}>Monto</span><span>Origen</span>
              </div>
              {grupos.map(([label, filasDia]) => (
                <section key={label}>
                  <div style={{ padding: "7px 14px", borderBottom: "1px solid var(--border)", background: "color-mix(in srgb, var(--bg-muted) 72%, var(--surface))", color: "var(--text2)", fontSize: 10, fontWeight: 850 }}>{label}</div>
                  {filasDia.map((fila) => <FilaRow key={fila.key} fila={fila} />)}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Leyenda */}
      <div style={{ marginTop: 12, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", fontSize: 9.5, color: "var(--text2)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}><Swatch massdte /> Emitido con massDTE</span>
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}><Swatch /> Por otro carril (aparece al descargar el RCV)</span>
        <span style={{ color: "var(--text3)" }}>Facturas y notas cruzan por folio · boletas por total del día (RCOF)</span>
      </div>
    </div>
  );
}

const COLUMNS = "118px 150px minmax(220px,1fr) 110px 150px";

function FilaRow({ fila }: { fila: Fila }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: COLUMNS, gap: 10, alignItems: "center", minHeight: 42, padding: "6px 14px", borderBottom: "1px solid color-mix(in srgb, var(--border) 62%, transparent)", background: "linear-gradient(90deg, rgba(232,85,62,.055), transparent 70%)", boxShadow: "inset 2px 0 0 var(--accent)" }}>
      <span style={{ fontSize: 10, fontWeight: 850, color: "var(--text)", fontVariantNumeric: "tabular-nums lining-nums" }}>{fila.folio}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: fila.tipoColor, flex: "none" }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: "var(--text)" }}>{fila.tipoLabel}</span>
        <span style={{ fontSize: 9, color: "var(--text3)" }}>{fila.tipoCod}</span>
      </span>
      <span style={{ minWidth: 0, fontSize: 10.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {fila.detalle} <span style={{ color: "var(--text3)", fontSize: 9.5 }}>{fila.detalleSub}</span>
      </span>
      <span style={{ textAlign: "right", fontSize: 11, fontWeight: 850, color: fila.esNota ? "var(--red)" : "var(--text)", fontVariantNumeric: "tabular-nums lining-nums" }}>{fila.esNota ? `−${fmtMoney(Math.abs(fila.monto))}` : fmtMoney(fila.monto)}</span>
      <span style={{ display: "inline-flex", width: "fit-content", alignItems: "center", gap: 6, fontSize: 9.5, fontWeight: 850, padding: "3px 9px", borderRadius: 999, background: "rgba(232,85,62,.12)", border: "1px solid rgba(232,85,62,.3)", color: "var(--accent)" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }} />massDTE
      </span>
    </div>
  );
}

function MonthNavButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button title={label} aria-label={label} disabled={disabled} onClick={onClick} style={{ width: 22, height: 22, borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", color: disabled ? "var(--text3)" : "var(--text)", display: "grid", placeItems: "center", cursor: disabled ? "default" : "pointer", fontSize: 12, fontWeight: 900, lineHeight: 1, opacity: disabled ? 0.5 : 1, transition: "all .18s ease" }}>{children}</button>;
}

function Swatch({ massdte }: { massdte?: boolean }) {
  return <span style={{ width: 20, height: 12, borderRadius: 4, background: massdte ? "rgba(232,85,62,.1)" : "var(--surface)", border: "1px solid var(--border)", boxShadow: massdte ? "inset 2px 0 0 var(--accent)" : "none", flex: "none" }} />;
}
