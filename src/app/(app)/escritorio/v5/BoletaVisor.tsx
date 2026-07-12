"use client";

import { fmt, fmtShort } from "./revisar-shared";

const divider = { borderTop: "1px solid var(--border)", margin: "0.6em 0" } as const;
const SIN_INFO = "Sin información";

// Boleta ya emitida (subset de boletas_emitidas que carga mesa-data en boletasView).
export type BoletaEmitida = {
  id: string;
  folio: number;
  tipo_dte: number;
  fecha_emision: string | null;
  created_at: string | null;
  receptor_rut: string | null;
  receptor_razon_social: string | null;
  monto_total: number;
  monto_neto: number | null;
  monto_exento: number | null;
  iva: number | null;
  estado: string;
  detalle?: string;
};

const ESTADO_META: Record<string, { label: string; color: string; bg: string }> = {
  aceptado: { label: "Aceptada por el SII", color: "var(--green)", bg: "rgba(34,197,94,.14)" },
  aceptado_reparos: { label: "Aceptada con reparos", color: "var(--amber)", bg: "rgba(245,158,11,.14)" },
  rechazado: { label: "Rechazada por el SII", color: "var(--red)", bg: "rgba(239,68,68,.14)" },
  anulada: { label: "Anulada", color: "var(--text3)", bg: "var(--bg-muted)" },
};

const TIPO_META: Record<number, { label: string; color: string }> = {
  39: { label: "Afecta · con IVA · 39", color: "var(--accent)" },
  41: { label: "Exenta · sin IVA · 41", color: "var(--blue)" },
  61: { label: "Nota de crédito · 61", color: "#c084fc" },
};

const personIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0, color: "var(--text3)" }}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
);
const calendarIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0, color: "var(--text3)" }}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
);

// Visor read-only de una boleta YA emitida: muestra TODA la info (tipo, montos,
// glosa, receptor, fecha, estado). Lo que el SII no tiene → "Sin información".
export default function BoletaVisor({ boleta, onClose, onVerEnBoletas }: {
  boleta: BoletaEmitida; onClose: () => void; onVerEnBoletas: () => void;
}) {
  const estado = ESTADO_META[boleta.estado] ?? { label: boleta.estado || SIN_INFO, color: "var(--text2)", bg: "var(--bg-muted)" };
  const tipo = TIPO_META[boleta.tipo_dte] ?? { label: `DTE ${boleta.tipo_dte}`, color: "var(--text2)" };
  const isAfecta = boleta.tipo_dte === 39;
  const neto = boleta.monto_neto ?? (isAfecta ? Math.round(boleta.monto_total / 1.19) : boleta.monto_total);
  const iva = boleta.iva ?? (isAfecta ? boleta.monto_total - neto : 0);
  const receptor = boleta.receptor_razon_social?.trim() || (boleta.receptor_rut ? SIN_INFO : "Consumidor final");
  const glosa = boleta.detalle?.trim() || SIN_INFO;
  const fecha = fmtShort(boleta.fecha_emision ? `${boleta.fecha_emision}T12:00:00` : boleta.created_at);

  return (
    <div style={{ display: "flex", flexDirection: "column", padding: "0.85em 18px", fontSize: "clamp(9px, 1.3vh, 12.5px)", height: "100%" }}>
      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginBottom: "0.5em" }}>
        <span style={{ fontSize: "1.65em", fontWeight: 800, color: "var(--text)", letterSpacing: "-.025em", lineHeight: 1 }}>Boleta #{boleta.folio}</span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.9em", fontWeight: 800, color: estado.color, background: estado.bg, padding: "0.32em 0.7em", borderRadius: 8 }}>
          <span style={{ width: "0.5em", height: "0.5em", borderRadius: "50%", background: estado.color }} />{estado.label}
        </span>
        <button onClick={onClose} title="Cerrar" style={{ width: "2.15em", height: "2.15em", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* BODY */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: "0.55em" }}>
          <span style={{ fontSize: "0.9em", fontWeight: 700, padding: "0.42em 0.95em", borderRadius: 9, background: `color-mix(in srgb, ${tipo.color} 13%, transparent)`, color: tipo.color }}>{tipo.label}</span>
          <span style={{ color: "var(--text2)", fontSize: "1.18em" }}>
            {isAfecta
              ? <>neto {fmt(neto)} · IVA {fmt(iva)} <span style={{ color: "var(--text3)" }}>(19%)</span></>
              : <>exento {fmt(boleta.monto_exento ?? boleta.monto_total)}</>}
          </span>
        </div>
        <div style={{ fontSize: "3em", fontWeight: 800, color: "var(--text)", letterSpacing: "-.04em", lineHeight: 1 }}>{fmt(boleta.monto_total)}</div>
        <div style={divider} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: "1.24em" }}>
          <span style={{ flexShrink: 0, color: "var(--text3)" }}>Detalle</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: glosa === SIN_INFO ? "var(--text3)" : "var(--text)" }} title={glosa}>{glosa}</span>
        </div>
        <div style={divider} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1.22em", color: "var(--text2)", flexWrap: "wrap" }}>
          {personIcon}
          <span style={{ color: receptor === SIN_INFO ? "var(--text3)" : "var(--text2)" }}>{receptor}</span>
          {boleta.receptor_rut && <span style={{ color: "var(--text3)" }}>· {boleta.receptor_rut}</span>}
          <span style={{ color: "var(--text3)" }}>·</span>
          {calendarIcon}
          <span>{fecha}</span>
          <button onClick={onVerEnBoletas} style={{ marginLeft: "auto", fontSize: "0.82em", fontWeight: 700, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0, whiteSpace: "nowrap" }}>Ver en Boletas →</button>
        </div>
      </div>
    </div>
  );
}
