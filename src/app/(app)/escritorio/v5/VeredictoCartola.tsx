"use client";

import { useState } from "react";
import { FileXls, FilePdf, FileCsv, FileImage, File as FileGenerico, type Icon } from "@phosphor-icons/react";
import { fmt, type Propuesta } from "./revisar-shared";
import { esTipoPropuestoExento } from "@/lib/sii/tipos-propuesta";

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
/* Icono del archivo: lift sutil al hover del chip (mismo spring del dock), sin loops idle. */
.vcart-file .fi-wrap{display:grid;place-items:center;transition:transform .26s cubic-bezier(.34,1.56,.64,1);}
.vcart-file:hover .fi-wrap{transform:translateY(-3px) scale(1.06);}
@media (prefers-reduced-motion: reduce){
  .vcart-file .fi-wrap{transition:none;}
  .vcart-file:hover .fi-wrap{transform:none;}
}
`;

const divider = { borderTop: "1px solid var(--border)", margin: "0.7em 0" } as const;

// Tipo de archivo por extensión → icono Phosphor duotone (la extensión viene
// dibujada en el propio glifo) + color semántico. Reconocimiento al tiro de
// QUÉ subió el usuario (Excel/PDF/CSV/foto) sin leer el nombre.
type FileExt = "xlsx" | "pdf" | "csv" | "img" | "doc";
function extDe(nombre: string): FileExt {
  const n = (nombre ?? "").toLowerCase();
  if (/\.(xlsx?|xlsm)$/.test(n)) return "xlsx";
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".csv")) return "csv";
  if (/\.(png|jpe?g|webp|heic)$/.test(n)) return "img";
  return "doc";
}
const FILE_META: Record<FileExt, { Glifo: Icon; color: string }> = {
  xlsx: { Glifo: FileXls, color: "var(--green)" },
  pdf: { Glifo: FilePdf, color: "var(--red)" },
  csv: { Glifo: FileCsv, color: "var(--blue)" },
  img: { Glifo: FileImage, color: "var(--amber)" },
  doc: { Glifo: FileGenerico, color: "var(--text2)" },
};

export default function VeredictoCartola({
  doc, propuestas, tipoMix, empresaId: _empresaId, onClose, onEditar, onAprobar, busy = false, onEliminar, eliminarArmado = false,
}: {
  doc: { id: string; nombre_archivo: string; movimientos_detectados: number | null };
  propuestas: Propuesta[];
  tipoMix?: { afectas: number; exentas: number; gastos: number } | undefined;
  empresaId: string;
  onClose: () => void;
  onEditar: () => void;
  onAprobar: () => void;
  busy?: boolean;
  /** Eliminar el documento completo de la mesa (solo sin boletas emitidas; dos pasos, estado en el padre). */
  onEliminar?: () => void;
  eliminarArmado?: boolean;
}) {
  const count = propuestas.length || (doc.movimientos_detectados ?? 0);
  const total = propuestas.reduce((s, p) => s + (p.total ?? p.movimientos_raw?.monto ?? 0), 0);

  // Split exenta/afecta: del agregado server-side si está, si no lo cuento acá.
  const esExenta = (p: Propuesta) => {
    const t = p.tipo_dte;
    if (t === 41) return true;
    if (t === 39) return false;
    return esTipoPropuestoExento(p.tipo_propuesto);
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
  const pendientesProps = propuestas.filter((p) => p.estado === "pendiente" || p.estado === "editado");
  const pendientes = pendientesProps.length;
  // Las salidas (gastos) NO llevan boleta: su resolución es RECHAZAR, no "dejar
  // lista". El copy genérico "deja listas las N" inducía a boletear egresos
  // (caso real de beta 2026-08-12: 21 salidas pendientes y la clienta buscando
  // cómo ponerlas en lista).
  const pendientesSalidas = pendientesProps.filter((p) => p.movimientos_raw?.tipo_flujo === "salida").length;
  const guiaPendientes = pendientes === 0
    ? null
    : pendientesSalidas === pendientes
      ? <>Tus {pendientes} pendientes son salidas (gastos): en <b>Editar</b> apriétales <b>Rechazar</b> — no llevan boleta</>
      : pendientesSalidas > 0
        ? <>Resuelve las {pendientes} pendientes en <b>Editar</b>: las ventas déjalas listas y a las salidas apriétales <b>Rechazar</b> (no llevan boleta)</>
        : <>Deja listas las {pendientes} en <b>Editar</b> para aprobar</>;
  const guiaPendientesTexto = pendientes === 0
    ? undefined
    : pendientesSalidas === pendientes
      ? `Tus ${pendientes} pendientes son salidas (gastos): en Editar apriétales Rechazar — no llevan boleta. Con eso se habilita Aprobar.`
      : pendientesSalidas > 0
        ? `Resuelve las ${pendientes} pendientes en Editar: las ventas déjalas listas y a las salidas apriétales Rechazar (no llevan boleta).`
        : `Deja listas las ${pendientes} pendientes en Editar para habilitar Aprobar`;
  const todasListas = count > 0 && pendientes === 0;
  // Solo se puede aprobar si de verdad hay algo staged (evita 'Aprobar 0' cuando la
  // cartola ya fue enviada entera a Emitir: pendientes===0 pero listas===0).
  const puedeAprobar = todasListas && listas > 0;
  const dotColor = todasListas ? "var(--green)" : pendientes < count ? "var(--amber)" : "var(--text3)";
  // Aprobar atómico = manda a Emitir (gatillo real hacia el SII). Confirmación en
  // dos pasos con el desglose para prevenir un click accidental sobre 600 tx.
  const [confirming, setConfirming] = useState(false);

  return (
    <div style={{ display: "flex", gap: "1.4em", alignItems: "stretch", padding: "0.85em 18px", fontSize: "clamp(9px, 1.3vh, 12.5px)", height: "100%" }}>
      <style>{CB_CSS}</style>

      {/* IZQUIERDA: el archivo (chip; Stage 4 = mini-preview del Excel). Click = Editar. */}
      <button className="vcart-file" onClick={onEditar} title="Editar transacciones"
        style={{ width: "clamp(120px, 17vh, 190px)", flexShrink: 0, alignSelf: "stretch", minHeight: "8em", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-muted)", cursor: "pointer", padding: "0.9em", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.55em", position: "relative", color: "var(--text2)" }}>
        {(() => {
          const { Glifo, color } = FILE_META[extDe(doc.nombre_archivo)];
          return (
            <span className="fi-wrap">
              <Glifo size={46} weight="duotone" color={color} />
            </span>
          );
        })()}
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
          {exentas > 0 && <span style={{ fontSize: "0.9em", fontWeight: 700, padding: "0.34em 0.8em", borderRadius: 8, background: "rgba(91,156,246,.13)", color: "var(--blue)" }}>Exenta · {exentas}</span>}
          {afectas > 0 && <span style={{ fontSize: "0.9em", fontWeight: 700, padding: "0.34em 0.8em", borderRadius: 8, background: "rgba(232,85,62,.13)", color: "var(--accent)" }}>Afecta · {afectas}</span>}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12, fontSize: "1.02em", color: "var(--text2)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: "var(--green)" }} />{listas} listas</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: pendientes > 0 ? "var(--amber)" : "var(--text3)" }} />{pendientes} pendientes</span>
          </span>
        </div>
      </div>

      {/* ACCIONES */}
      <div style={{ width: "clamp(160px, 30%, 285px)", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.1em", borderLeft: "1px solid var(--border)", paddingLeft: "1.4em" }}>
        <button className="vcart-cb" onClick={onEditar} disabled={busy} style={{ background: "var(--bg-muted)", color: "var(--text)", fontSize: "1.12em" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>Editar
        </button>
        {confirming && puedeAprobar ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.55em" }}>
            <div style={{ fontSize: "0.82em", color: "var(--text2)", lineHeight: 1.45, textAlign: "center" }}>
              Vas a dejar <b style={{ color: "var(--text)" }}>{listas}</b> listas en <b style={{ color: "var(--text)" }}>Emitir</b>
              {afectasListas > 0 && <> · afecta {afectasListas}</>}
              {exentasListas > 0 && <> · exenta {exentasListas}</>}
              <br />total <b style={{ color: "var(--text)" }}>{fmt(totalListas)}</b>
              <br /><span style={{ fontSize: "0.92em", color: "var(--text3)" }}>El envío al SII se confirma en la pestaña Emitir.</span>
            </div>
            <button className="vcart-cb" onClick={() => { setConfirming(false); onAprobar(); }} disabled={busy} style={{ background: "var(--accent)", color: "#fff", fontSize: "1.05em" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Aprobar y enviar a Emitir
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} style={{ border: "1px solid var(--border)", borderRadius: 11, background: "transparent", color: "var(--text2)", fontSize: "0.9em", fontWeight: 600, padding: "0.55em", cursor: "pointer" }}>Cancelar</button>
          </div>
        ) : (
          <>
            {/* Aprobar SIEMPRE visible: poner las tx listas en el popup Editar es la
                palanca que lo habilita — esa es la barrera hacia Emitir. */}
            <button className="vcart-cb" onClick={() => setConfirming(true)} disabled={busy || !puedeAprobar}
              title={!puedeAprobar ? (pendientes > 0 ? guiaPendientesTexto : "No hay transacciones listas para aprobar") : undefined}
              style={{ background: "var(--accent)", color: "#fff", fontSize: "1.12em" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Aprobar {listas}
            </button>
            {!puedeAprobar && (
              <div style={{ fontSize: "0.85em", color: "var(--text3)", fontWeight: 600, textAlign: "center", lineHeight: 1.4, marginTop: "-0.4em" }}>
                {pendientes > 0 ? guiaPendientes : <>Todo enviado a Emitir</>}
              </div>
            )}
          </>
        )}
        {onEliminar && (
          <button className="vcart-cb" onClick={onEliminar} disabled={busy}
            title="Elimina la cartola completa de la mesa: archivo, movimientos y propuestas. Solo posible si no tiene boletas emitidas."
            style={{ background: eliminarArmado ? "color-mix(in srgb, var(--red) 18%, transparent)" : "color-mix(in srgb, var(--red) 9%, transparent)", color: "var(--red)", fontSize: "1.02em" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
            {eliminarArmado ? "¿Seguro? Eliminar todo" : "Eliminar"}
          </button>
        )}
      </div>
    </div>
  );
}
