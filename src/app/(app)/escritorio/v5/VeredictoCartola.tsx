"use client";

import { useState } from "react";
import { fmt, type Propuesta } from "./revisar-shared";

// Visor RESUMEN de una cartola (documento multi-tx) — espejo de VeredictoCard pero
// para el conjunto: izquierda = el archivo, centro = agregados (nº tx · total · split
// exenta/afecta · preparación), derecha = Editar (abre la grilla) + Aprobar (manda a
// Emitir cuando el documento está completamente decidido). El detalle tx-por-tx vive
// en el popup Editar, no acá. Mismos tamaños/tokens que VeredictoCard = misma familia.

const CB_CSS = `
.vcart-cb{cursor:pointer;border-radius:11px;font-weight:700;width:100%;padding:1.05em 1em;display:flex;align-items:center;justify-content:center;gap:9px;line-height:1.4;transition:box-shadow .18s,filter .15s,transform .1s;box-shadow:5px 5px 12px rgba(0,0,0,.45),-4px -4px 10px rgba(255,255,255,.025);}
.vcart-cb svg{width:1.05em;height:1.05em;flex-shrink:0;}
.vcart-cb:hover:not(:disabled){filter:brightness(1.07);}
.vcart-cb:active:not(:disabled){box-shadow:inset 4px 4px 11px rgba(0,0,0,.5),inset -3px -3px 9px rgba(255,255,255,.04);filter:brightness(.92);transform:translateY(1px);}
.vcart-cb:disabled{opacity:.5;cursor:default;}
`;

const divider = { borderTop: "1px solid var(--border)", margin: "0.7em 0" } as const;

export default function VeredictoCartola({
  doc, propuestas, tipoMix, empresaId: _empresaId, onClose, onEditar, onAprobar, busy = false,
}: {
  doc: { id: string; nombre_archivo: string; movimientos_detectados: number | null };
  propuestas: Propuesta[];
  tipoMix?: { afectas: number; exentas: number; gastos: number } | undefined;
  empresaId: string;
  onClose: () => void;
  onEditar: () => void;
  onAprobar: () => void;
  busy?: boolean;
}) {
  const count = propuestas.length || (doc.movimientos_detectados ?? 0);
  const total = propuestas.reduce((s, p) => s + (p.total ?? p.movimientos_raw?.monto ?? 0), 0);

  // Split exenta/afecta: del agregado server-side si está, si no lo cuento acá.
  const esExenta = (p: Propuesta) => {
    const t = p.tipo_dte;
    if (t === 41) return true;
    if (t === 39) return false;
    const tp = p.tipo_propuesto ?? "";
    return tp === "exenta" || tp === "compraventa_crypto" || tp === "operacion_forex";
  };
  const exentas = tipoMix?.exentas ?? propuestas.filter(esExenta).length;
  const afectas = tipoMix?.afectas ?? propuestas.filter((p) => !esExenta(p)).length;

  // "Listo" = estado='listo' (preparada, staged, aún NO en Emitir). El Aprobar
  // atómico SOLO promueve estas → el desglose de la confirmación se calcula sobre
  // ellas, no sobre toda la composición del doc (que puede incluir ya-aprobadas).
  const listasProps = propuestas.filter((p) => p.estado === "listo");
  const listas = listasProps.length;
  const totalListas = listasProps.reduce((s, p) => s + (p.total ?? p.movimientos_raw?.monto ?? 0), 0);
  const afectasListas = listasProps.filter((p) => !esExenta(p)).length;
  const exentasListas = listasProps.filter(esExenta).length;
  // 'editado' es borrador (no emitible): cuenta como pendiente para que el
  // Aprobar atómico no lo deje atrás en silencio.
  const pendientes = propuestas.filter((p) => p.estado === "pendiente" || p.estado === "editado").length;
  const todasListas = count > 0 && pendientes === 0;
  // Solo se puede aprobar si de verdad hay algo staged (evita 'Aprobar 0' cuando la
  // cartola ya fue enviada entera a Emitir: pendientes===0 pero listas===0).
  const puedeAprobar = todasListas && listas > 0;
  const dotColor = todasListas ? "#22c55e" : pendientes < count ? "#f59e0b" : "var(--text3)";
  // Aprobar atómico = manda a Emitir (gatillo real hacia el SII). Confirmación en
  // dos pasos con el desglose para prevenir un click accidental sobre 600 tx.
  const [confirming, setConfirming] = useState(false);

  return (
    <div style={{ display: "flex", gap: "1.4em", alignItems: "stretch", padding: "0.85em 18px", fontSize: "clamp(9px, 1.3vh, 12.5px)", height: "100%" }}>
      <style>{CB_CSS}</style>

      {/* IZQUIERDA: el archivo (chip; Stage 4 = mini-preview del Excel). Click = Editar. */}
      <button onClick={onEditar} title="Editar transacciones"
        style={{ width: "clamp(120px, 17vh, 190px)", flexShrink: 0, alignSelf: "stretch", minHeight: "8em", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-muted)", cursor: "pointer", padding: "0.9em", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.55em", position: "relative", color: "var(--text2)" }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: .85 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13h8M8 17h5" /></svg>
        <div style={{ fontSize: "0.82em", fontWeight: 700, color: "var(--text)", textAlign: "center", lineHeight: 1.25, maxWidth: "100%", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{doc.nombre_archivo}</div>
        <div style={{ fontSize: "0.72em", color: "var(--text3)" }}>{count} movimientos</div>
        <span style={{ position: "absolute", right: 6, bottom: 6, fontSize: "0.62em", fontWeight: 700, color: "#fff", background: "rgba(0,0,0,.55)", borderRadius: 5, padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: 3 }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>editar
        </span>
      </button>

      {/* PRINCIPAL: header + agregados */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.5em" }}>
          <span style={{ fontSize: "1.5em", fontWeight: 600, color: "var(--text2)", letterSpacing: "-.02em", lineHeight: 1 }}>Cartola</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.98em", fontWeight: 800, color: dotColor }}>
            <span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: dotColor }} />{listas}/{count} listas
          </span>
          <button onClick={onClose} title="Cerrar" style={{ width: "2.15em", height: "2.15em", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Héroe: el conteo (como el monto de una tx suelta) */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: "3em", fontWeight: 800, color: "var(--text)", letterSpacing: "-.04em", lineHeight: 1 }}>{count}</span>
          <span style={{ fontSize: "1em", fontWeight: 600, color: "var(--text3)" }}>movimientos</span>
          <span style={{ marginLeft: "auto", fontSize: "1.18em", color: "var(--text2)" }}>total <b style={{ color: "var(--text)" }}>{fmt(total)}</b></span>
        </div>

        <div style={divider} />

        {/* Split exenta/afecta (readout, no toggle) */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {exentas > 0 && <span style={{ fontSize: "0.9em", fontWeight: 700, padding: "0.34em 0.8em", borderRadius: 8, background: "rgba(91,156,246,.13)", color: "#5b9cf6" }}>Exenta · {exentas}</span>}
          {afectas > 0 && <span style={{ fontSize: "0.9em", fontWeight: 700, padding: "0.34em 0.8em", borderRadius: 8, background: "rgba(34,197,94,.13)", color: "#22c55e" }}>Afecta · {afectas}</span>}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12, fontSize: "1.02em", color: "var(--text2)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: "#22c55e" }} />{listas} listas</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: pendientes > 0 ? "#f59e0b" : "var(--text3)" }} />{pendientes} pendientes</span>
          </span>
        </div>
      </div>

      {/* ACCIONES */}
      <div style={{ width: "clamp(160px, 30%, 285px)", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.1em", borderLeft: "1px solid var(--border)", paddingLeft: "1.4em" }}>
        <button className="vcart-cb" onClick={onEditar} disabled={busy} style={{ background: "var(--bg-muted)", color: "var(--text)", fontSize: "1.12em" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>Editar
        </button>
        {puedeAprobar ? (
          confirming ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.55em" }}>
              <div style={{ fontSize: "0.82em", color: "var(--text2)", lineHeight: 1.45, textAlign: "center" }}>
                Vas a emitir <b style={{ color: "var(--text)" }}>{listas}</b>
                {afectasListas > 0 && <> · afecta {afectasListas}</>}
                {exentasListas > 0 && <> · exenta {exentasListas}</>}
                <br />total <b style={{ color: "var(--text)" }}>{fmt(totalListas)}</b>
              </div>
              <button className="vcart-cb" onClick={() => { setConfirming(false); onAprobar(); }} disabled={busy} style={{ background: "#E8553E", color: "#fff", fontSize: "1.05em" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Confirmar emisión
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy} style={{ border: "1px solid var(--border)", borderRadius: 11, background: "transparent", color: "var(--text2)", fontSize: "0.9em", fontWeight: 600, padding: "0.55em", cursor: "pointer" }}>Cancelar</button>
            </div>
          ) : (
            <button className="vcart-cb" onClick={() => setConfirming(true)} disabled={busy} style={{ background: "#E8553E", color: "#fff", fontSize: "1.12em" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Aprobar {listas}
            </button>
          )
        ) : pendientes > 0 ? (
          <div style={{ fontSize: "0.85em", color: "var(--text3)", fontWeight: 600, textAlign: "center", lineHeight: 1.4 }}>Deja listas las {pendientes} en <b>Editar</b> para aprobar</div>
        ) : (
          <div style={{ fontSize: "0.85em", color: "var(--text3)", fontWeight: 600, textAlign: "center", lineHeight: 1.4 }}>Todo enviado a Emitir</div>
        )}
      </div>
    </div>
  );
}
