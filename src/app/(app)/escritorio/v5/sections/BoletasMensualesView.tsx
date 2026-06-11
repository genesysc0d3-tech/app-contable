"use client";

import { useState, useMemo } from "react";
import PreviewBoletaButton from "@/components/boletas/PreviewBoletaButton";
import DescargarBoletaButton from "@/components/boletas/DescargarBoletaButton";

export interface BoletaRow {
  id: string; folio: number | null; tipo_dte: number; fecha_emision: string; created_at?: string | null;
  receptor_razon_social: string | null; monto_total: number; estado: string;
}

function fmt(n: number) { return `$${Math.round(n).toLocaleString("es-CL")}`; }

function fmtDate(s?: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" }).replace(/\./g, "");
}

const TIPO_BADGE: Record<number, { label: string; color: string; bg: string }> = {
  39: { label: "AFECTA", color: "#E8553E", bg: "rgba(232,85,62,.1)" },
  41: { label: "EXENTA", color: "#3B82F6", bg: "rgba(59,130,246,.1)" },
  61: { label: "NC", color: "#7C3AED", bg: "rgba(124,58,237,.1)" },
};

export default function BoletasMensualesView({ boletas, month, year }: {
  boletas: BoletaRow[];
  month: number; year: number;
  onPrevMonth: () => void; onNextMonth: () => void;
}) {
  const [search, setSearch] = useState("");

  const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  // Global search across ALL boletas
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return boletas.filter(b => {
      const folio = String(b.folio ?? "");
      const receptor = (b.receptor_razon_social ?? "").toLowerCase();
      const monto = fmt(b.monto_total).toLowerCase();
      return folio.includes(q) || receptor.includes(q) || monto.includes(q) || q.includes(folio);
    }).sort((a, b) => (b.folio ?? 0) - (a.folio ?? 0));
  }, [boletas, search]);

  // Month filter (only when no search)
  const monthFiltered = useMemo(() => {
    return boletas.filter(b => {
      const emision = new Date(b.fecha_emision);
      const edicion = new Date(b.created_at ?? b.fecha_emision);
      const matchesEmision = emision.getFullYear() === year && emision.getMonth() === month;
      const matchesEdicion = edicion.getFullYear() === year && edicion.getMonth() === month;
      return matchesEmision || matchesEdicion;
    }).sort((a, b) => (b.folio ?? 0) - (a.folio ?? 0));
  }, [boletas, year, month]);

  const displayed = searchResults ?? monthFiltered;

  const stats = useMemo(() => {
    let total = 0, emitidas = 0, anuladas = 0;
    for (const b of displayed) {
      if (b.estado === "anulada") anuladas++;
      else { emitidas++; total += b.monto_total; }
    }
    return { emitidas, anuladas, total };
  }, [displayed]);

  return (
    <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Search */}
      <div style={{ position: "relative" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por folio, receptor o monto..."
          style={{
            width: "100%", padding: "8px 10px 8px 30px", borderRadius: 6,
            border: "1px solid var(--border)", background: "var(--bg-muted)",
            color: "var(--text)", fontSize: 10, outline: "none",
          }} />
        {search && (
          <button onClick={() => setSearch("")}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 12 }}>
            ✕
          </button>
        )}
      </div>

      {/* Stats */}
      {!search && (
        <div style={{ display: "flex", gap: 16, fontSize: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)" }} />
            {stats.emitidas} emitida{stats.emitidas !== 1 ? "s" : ""}
          </span>
          {stats.anuladas > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#ef4444" }} />
              {stats.anuladas} anulada{stats.anuladas !== 1 ? "s" : ""}
            </span>
          )}
          <span style={{ marginLeft: "auto", fontWeight: 600, color: "var(--text)" }}>
            Total {fmt(stats.total)}
          </span>
        </div>
      )}

      {search && searchResults && (
        <div style={{ fontSize: 10, color: "var(--text2)" }}>
          {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""} para &ldquo;{search}&rdquo;
        </div>
      )}

      {/* Table */}
      {displayed.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", fontSize: 11, color: "var(--text2)" }}>
          {search ? "No se encontraron boletas con ese criterio" : `No hay boletas con emisión, edición o subida en ${monthNames[month].toLowerCase()} ${year}`}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "58px 62px minmax(150px,1fr) 78px 82px 82px 70px 58px", gap: 8, alignItems: "center", padding: "7px 10px", color: "var(--text2)", fontSize: 8, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>
            <span>Folio</span><span>Tipo</span><span>Receptor</span><span>Estado</span><span>Emisión SII</span><span>Edición/Subida</span><span style={{ textAlign: "right" }}>Monto</span><span />
          </div>
          {displayed.map(b => {
            const anulada = b.estado === "anulada";
            const badge = TIPO_BADGE[b.tipo_dte] ?? { label: `DTE ${b.tipo_dte}`, color: "var(--text2)", bg: "var(--bg-muted)" };
            return (
              <div key={b.id} style={{
                display: "grid", gridTemplateColumns: "58px 62px minmax(150px,1fr) 78px 82px 82px 70px 58px", gap: 8, alignItems: "center",
                padding: "8px 10px", borderRadius: 6,
                background: anulada ? "rgba(239,68,68,.02)" : "rgba(255,255,255,.02)",
                border: "1px solid var(--border)", opacity: anulada ? .5 : 1,
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text2)", minWidth: 30, fontVariantNumeric: "tabular-nums" }}>
                  #{b.folio}
                </span>
                <span style={{
                  fontSize: 7, padding: "1px 5px", borderRadius: 3, fontWeight: 700,
                  background: badge.bg, color: badge.color, flexShrink: 0,
                }}>
                  {badge.label}
                </span>
                <span style={{ fontSize: 10, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {b.receptor_razon_social ?? "Sin receptor"}
                </span>
                <span style={{ width: "fit-content", padding: "3px 7px", borderRadius: 999, background: anulada ? "rgba(239,68,68,.1)" : "rgba(34,197,94,.1)", color: anulada ? "#ef4444" : "#22c55e", fontSize: 9, fontWeight: 850 }}>
                  {anulada ? "Anulada" : "Emitida"}
                </span>
                <span style={{ fontSize: 10, color: "var(--text)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {fmtDate(b.fecha_emision)}
                </span>
                <span style={{ fontSize: 10, color: "var(--text2)", fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
                  {fmtDate(b.created_at)}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text)", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                  {fmt(b.monto_total)}
                </span>
                <div style={{ display: "flex", gap: 1 }}>
                  <PreviewBoletaButton id={b.id} />
                  <DescargarBoletaButton id={b.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
