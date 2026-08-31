"use client";

import { useMemo } from "react";
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
};

function fmtMoney(n: number) {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

function fmtDateLong(fecha: string) {
  return formatDisplayDateEsCl(fecha, { day: "numeric", month: "long", year: "numeric" });
}

export default function RcvCuadreView({ items, notice, onActualizar }: { items: SearchItem[]; notice: string | null; onActualizar: () => void }) {
  const monthKey = chileDateString().slice(0, 7);
  const monthLabel = useMemo(() => {
    const label = formatDisplayDateEsCl(`${monthKey}-01`, { month: "long", year: "numeric" });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [monthKey]);

  const { filas, totalDocs, totalMonto } = useMemo(() => {
    // Solo documentos EMITIDOS del mes en curso (fecha de emisión SII).
    const emitidas = items.filter((item) => {
      if (item.type !== "boleta") return false;
      const fecha = String(item.data?.fecha_emision ?? item.fecha ?? "");
      return chileDisplayMonthKey(fecha) === monthKey;
    });

    const individuales: Fila[] = [];
    const boletasPorDia = new Map<string, { count: number; total: number; fecha: string }>();
    let docs = 0;
    let monto = 0;

    for (const item of emitidas) {
      const d = item.data ?? {};
      const fecha = String(d.fecha_emision ?? item.fecha ?? "");
      const dateKey = chileDisplayDateKey(fecha);
      const total = typeof d.monto_total === "number" ? d.monto_total : (item.monto ?? 0);
      const tipoDte = Number(d.tipo_dte ?? 39);
      docs += 1;

      if (TIPO_LABEL[tipoDte]) {
        // Facturas y notas: cruzan por folio, van una a una.
        const meta = TIPO_LABEL[tipoDte];
        const esNota = tipoDte === 61;
        monto += esNota ? -total : total;
        individuales.push({
          key: item.id,
          dateKey,
          dateLabel: fmtDateLong(fecha),
          folio: d.folio ? String(d.folio).padStart(7, "0") : "-",
          tipoLabel: meta.label,
          tipoCod: meta.cod,
          tipoColor: meta.color,
          detalle: String(d.receptor_razon_social ?? item.label),
          detalleSub: d.receptor_rut ? `· ${String(d.receptor_rut)}` : "",
          monto: esNota ? -total : total,
          esNota,
        });
      } else {
        // Boletas 39/41: el SII solo ve el total del día (RCOF).
        monto += total;
        const acc = boletasPorDia.get(dateKey) ?? { count: 0, total: 0, fecha };
        acc.count += 1;
        acc.total += total;
        boletasPorDia.set(dateKey, acc);
      }
    }

    const resumenes: Fila[] = Array.from(boletasPorDia.entries()).map(([dateKey, acc]) => ({
      key: `boletas-${dateKey}`,
      dateKey,
      dateLabel: fmtDateLong(acc.fecha),
      folio: "—",
      tipoLabel: "Boletas",
      tipoCod: "39",
      tipoColor: "var(--blue)",
      detalle: `Resumen del día · ${acc.count} ${acc.count === 1 ? "boleta" : "boletas"}`,
      detalleSub: "· RCOF",
      monto: acc.total,
      esNota: false,
    }));

    const filas = [...individuales, ...resumenes].sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.folio.localeCompare(a.folio));
    return { filas, totalDocs: docs, totalMonto: monto };
  }, [items, monthKey]);

  const grupos = useMemo(() => {
    const map = new Map<string, Fila[]>();
    for (const fila of filas) map.set(fila.dateLabel, [...(map.get(fila.dateLabel) ?? []), fila]);
    return Array.from(map.entries());
  }, [filas]);

  return (
    <div style={{ minHeight: 0, overflow: "auto", padding: "14px 18px 28px", background: "var(--surface)" }}>
      {/* Resumen del cuadre */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", padding: "13px 16px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--bg-muted)" }}>
        <Stat n={String(totalDocs)} nColor="var(--accent)" label={`Emitidos con massDTE · ${monthLabel}`} />
        <Sep />
        <Stat n={fmtMoney(totalMonto)} nColor="var(--text)" label="Total emitido del mes" />
        <Sep />
        <Stat n="—" nColor="var(--text3)" label="En el RCV del SII · sin descargar" />
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "7px 13px", borderRadius: 11, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.28)", color: "var(--amber)", fontSize: 10, fontWeight: 850 }}>
          Cuadre pendiente del RCV
        </span>
      </div>

      {/* Aviso: parcial + boletas del día + estado del carril de descarga */}
      <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", borderRadius: 12, border: "1px solid rgba(245,158,11,.22)", background: "rgba(245,158,11,.07)", fontSize: 10.5, lineHeight: 1.55, color: "var(--text2)" }}>
        <span style={{ color: "var(--amber)", fontWeight: 900 }}>⚠</span>
        <span>
          <b style={{ color: "var(--text)" }}>{monthLabel} está en curso: este cuadre es parcial.</b> Las <b style={{ color: "var(--text)" }}>boletas de hoy todavía no aparecen</b> en el RCV — el SII las recibe al cierre del día (vía RCOF). El cuadre definitivo queda al terminar el mes, antes del F29.
        </span>
      </div>

      {notice && (
        <div style={{ marginTop: 10, padding: "11px 14px", borderRadius: 12, border: "1px solid rgba(232,85,62,.24)", background: "rgba(232,85,62,.07)", fontSize: 10.5, color: "var(--text)", fontWeight: 700 }}>
          {notice}
        </div>
      )}

      {/* Tabla del período */}
      {filas.length === 0 ? (
        <div style={{ marginTop: 24, padding: 36, textAlign: "center", color: "var(--text2)", fontSize: 11, border: "1px dashed var(--border)", borderRadius: 14 }}>
          Sin documentos emitidos con massDTE en {monthLabel}. Cuando emitas, acá se cuadran contra el RCV del SII.
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
        <button onClick={onActualizar} style={{ marginLeft: "auto", border: "1px solid rgba(232,85,62,.35)", borderRadius: 10, background: "rgba(232,85,62,.1)", color: "var(--accent)", padding: "7px 12px", fontSize: 10, fontWeight: 900, cursor: "pointer" }}>↻ Actualizar RCV</button>
      </div>
    </div>
  );
}

const COLUMNS = "90px 150px minmax(220px,1fr) 110px 150px";

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

function Stat({ n, nColor, label }: { n: string; nColor: string; label: string }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-.02em", color: nColor, fontVariantNumeric: "tabular-nums lining-nums" }}>{n}</span>
      <span style={{ fontSize: 9, color: "var(--text2)", fontWeight: 700 }}>{label}</span>
    </span>
  );
}

function Sep() {
  return <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />;
}

function Swatch({ massdte }: { massdte?: boolean }) {
  return <span style={{ width: 20, height: 12, borderRadius: 4, background: massdte ? "rgba(232,85,62,.1)" : "var(--surface)", border: "1px solid var(--border)", boxShadow: massdte ? "inset 2px 0 0 var(--accent)" : "none", flex: "none" }} />;
}
