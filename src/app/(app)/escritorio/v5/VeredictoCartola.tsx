"use client";

import { useEffect, useState } from "react";
import { FileXls, FilePdf, FileCsv, FileImage, File as FileGenerico, type Icon } from "@phosphor-icons/react";
import { fmt, type Propuesta } from "./revisar-shared";
import { esTipoPropuestoExento } from "@/lib/sii/tipos-propuesta";
import { leerCuadre, resumenCuadre } from "@/lib/cartola/cuadre-mesa";
import CuadreCartolaLinea from "./CuadreCartolaLinea";
import { revisarColumnas } from "@/lib/cartola/verificacion";
import { esDetalleSinMarcaBanco } from "@/lib/parsers/types";
import { contarTerminadas, terminadaDe } from "./cartola-filas";

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
  doc, propuestas, tipoMix, empresaId: _empresaId, onClose: _onClose, onEditar, onAprobar, busy = false, onEliminar, eliminarArmado = false, mesa = "boleta", decidida = false, juzgadas = 0, contexto = null, veredicto = null, onCuadreAgregado, onRevisarColumnas, aMediasIds, preguntas = 0,
}: {
  doc: { id: string; nombre_archivo: string; movimientos_detectados: number | null; progreso_ia?: unknown };
  propuestas: Propuesta[];
  tipoMix?: { afectas: number; exentas: number; gastos: number } | undefined;
  empresaId: string;
  /** Legado: el visor es permanente — la ✕ se retiró (solo vaciaba el panel). */
  onClose: () => void;
  onEditar: () => void;
  onAprobar: () => void;
  busy?: boolean;
  /** Eliminar el documento completo de la mesa (solo sin boletas emitidas; dos pasos, estado en el padre). */
  onEliminar?: () => void;
  eliminarArmado?: boolean;
  /** Cuántas propuestas del doc quedaron juzgadas (sin boleta) — para el estado "todo juzgado". */
  juzgadas?: number;
  /** Nota del dueño ("¿Qué es esta plata?") — para el acuse de recibo. */
  contexto?: string | null;
  /** Veredicto de contexto persistido por el processor (progreso_ia.contexto_veredicto). */
  veredicto?: { contradice: boolean; motivo: string | null; revisado: boolean; accion?: "mesa_facturas" | "no_son_ventas" | "revisar" } | null;
  /** Vocabulario por mesa: una plantilla de facturas NO es una cartola. */
  mesa?: "boleta" | "factura";
  /** Cartola completamente DECIDIDA (todo aprobado/juzgado): el visor cambia de
      modo — sin Editar/Eliminar/Aprobar; el camino de vuelta vive en Emitir. */
  decidida?: boolean;
  /** Tras "Agregarlos" del cuadre: recargar la mesa para ver las filas nuevas. */
  onCuadreAgregado?: () => void;
  /** Abre el popup "Revisa las columnas" (FieldMapper) de esta cartola. */
  onRevisarColumnas?: () => void;
  /** Propuestas con lápida (a medias): terminadas, no cuentan como listas/pendientes. */
  aMediasIds?: ReadonlySet<string>;
  /** Check agrupado: preguntas en grupo pendientes → el botón Editar invita a responderlas. */
  preguntas?: number;
}) {
  const count = propuestas.length || (doc.movimientos_detectados ?? 0);
  const total = propuestas.reduce((s, p) => s + (p.total ?? p.movimientos_raw?.monto ?? 0), 0);
  // CUADRE DE CARTOLA (progreso_ia.cuadre, lo deja el processor): con él, el
  // héroe muestra abonos y cargos POR SEPARADO — el "total" sumaba entradas +
  // salidas (LC 2026-09-27: "162M vs 84M"). Sin cuadre (PDF, plantillas) queda
  // el total de siempre.
  const cuadre = leerCuadre(doc.progreso_ia);
  const resCuadre = cuadre ? resumenCuadre(cuadre) : null;
  // REVISIÓN DE COLUMNAS PENDIENTE (fundador 2026-09-30): si no sabemos leerla,
  // lo único que tiene sentido es revisar → el visor deja UN CTA grande y Editar
  // /Aprobar se esconden hasta confirmar las columnas. Cualquier otra cartola
  // (comprobada, ya confirmada, plantilla) mantiene el visor de siempre.
  const columnas = cuadre ? revisarColumnas(cuadre) : null;
  // PDF sin marca propia de banco (vuelta 6): el aviso va completo y visible, no solo en el tooltip.
  const sinMarcaBanco = esDetalleSinMarcaBanco(columnas?.motivo);

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
  // Terminadas (emitidas / a medias, cartola-filas.ts): se cuentan aparte — una
  // emitida NUNCA es "lista", "pendiente" ni "en Emitir" (fundador 2026-09-29).
  const sinLapidas = aMediasIds ?? new Set<string>();
  const esTerminada = (p: Propuesta) => terminadaDe(p, sinLapidas) !== null;
  const { emitidas, aMedias } = contarTerminadas(propuestas, sinLapidas);
  // Con emitidas o a medias, reprocesar está bajo el doble candado: el popup no
  // podría releerla y el CTA se quedaría para siempre tapando Editar → el visor
  // de siempre (revisión adversarial 2026-09-30).
  const revisionPendiente = !!columnas?.abrir && !decidida && emitidas === 0 && aMedias === 0;
  const aprobadas = propuestas.filter((p) => p.estado === "aprobado" && !esTerminada(p)).length;
  const listasProps = propuestas.filter((p) => p.estado === "listo" && !esTerminada(p));
  const listas = listasProps.length;
  const totalListas = listasProps.reduce((s, p) => s + (p.total ?? p.movimientos_raw?.monto ?? 0), 0);
  const afectasListas = listasProps.filter((p) => !esExenta(p)).length;
  const exentasListas = listasProps.filter(esExenta).length;
  // 'editado' es borrador (no emitible): cuenta como pendiente para que el
  // Aprobar atómico no lo deje atrás en silencio.
  const pendientesProps = propuestas.filter((p) => (p.estado === "pendiente" || p.estado === "editado") && !esTerminada(p));
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
  // TODO JUZGADO (bug cazado por el fundador 2026-09-02): sin vivas, el visor
  // caía a una rama legacy. Acá se muestra honesto: 0 listas, N sin boleta.
  const todoJuzgado = propuestas.length === 0 && juzgadas > 0;
  const todasListas = count > 0 && pendientes === 0 && !todoJuzgado;
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
      <button className="vcart-file" onClick={decidida ? undefined : revisionPendiente ? onRevisarColumnas : onEditar} title={decidida ? "Cartola enviada a Emitir — para tocarla, devuélvela desde esa pestaña" : "Editar transacciones"}
        style={{ width: "clamp(120px, 17vh, 190px)", flexShrink: 0, alignSelf: "stretch", minHeight: "8em", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-muted)", cursor: decidida ? "default" : "pointer", padding: "0.9em", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "0.55em", position: "relative", color: "var(--text2)" }}>
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
        {!decidida && (
          <span style={{ position: "absolute", right: 6, bottom: 6, fontSize: "0.62em", fontWeight: 700, color: "#fff", background: "rgba(0,0,0,.55)", borderRadius: 5, padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>editar
          </span>
        )}
      </button>

      {/* PRINCIPAL: header + agregados */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.5em" }}>
          <span style={{ fontSize: "1.5em", fontWeight: 600, color: "var(--text2)", letterSpacing: "-.02em", lineHeight: 1 }}>{mesa === "factura" ? "Plantilla" : "Cartola"}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.98em", fontWeight: 800, color: decidida ? "var(--blue)" : dotColor }}>
            <span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: decidida ? "var(--blue)" : dotColor }} />{decidida ? (aprobadas > 0 ? `${aprobadas} en Emitir` : emitidas > 0 ? `${emitidas} emitida${emitidas === 1 ? "" : "s"}` : `${aMedias} a medias`) : `${listas}/${count - emitidas - aMedias} listas`}
          </span>
        </div>

        {/* Héroe: el conteo (como el monto de una tx suelta) */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: "3em", fontWeight: 800, color: "var(--text)", letterSpacing: "-.04em", lineHeight: 1 }}>{count}</span>
          <span style={{ fontSize: "1em", fontWeight: 600, color: "var(--text3)" }}>movimientos</span>
          {resCuadre ? (
            <span style={{ marginLeft: "auto", fontSize: "1.1em", color: "var(--text3)", textAlign: "right" }}>
              En tu cartola: Abonos <b style={{ color: "var(--text)" }}>{fmt(resCuadre.abonos)}</b> · Cargos <b style={{ color: "var(--text)" }}>{fmt(resCuadre.cargos)}</b>
            </span>
          ) : (
            <span style={{ marginLeft: "auto", fontSize: "1.18em", color: "var(--text2)" }}>total <b style={{ color: "var(--text)" }}>{fmt(total)}</b></span>
          )}
        </div>

        <div style={divider} />

        {/* Split exenta/afecta (readout, no toggle) */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {exentas > 0 && <span style={{ fontSize: "0.9em", fontWeight: 700, padding: "0.34em 0.8em", borderRadius: 8, background: "rgba(91,156,246,.13)", color: "var(--blue)" }}>Exenta · {exentas}</span>}
          {afectas > 0 && <span style={{ fontSize: "0.9em", fontWeight: 700, padding: "0.34em 0.8em", borderRadius: 8, background: "rgba(232,85,62,.13)", color: "var(--accent)" }}>Afecta · {afectas}</span>}
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 12, fontSize: "1.02em", color: "var(--text2)" }}>
            {aMedias > 0 && (
              <span title="No sabemos si salieron en el SII: verifícalas en Emitir → A medias" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: "var(--amber)" }} />{aMedias} a medias</span>
            )}
            {emitidas > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: "var(--text3)" }} />{emitidas} emitida{emitidas === 1 ? "" : "s"}</span>
            )}
            {decidida ? (
              aprobadas > 0 && <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: "var(--blue)" }} />{aprobadas} en Emitir</span>
            ) : (<>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: "var(--green)" }} />{listas} listas</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: pendientes > 0 ? "var(--amber)" : "var(--text3)" }} />{pendientes} pendientes</span>
            </>)}
          </span>
        </div>

        {/* CUADRE: "500 de 500 ✓" o "Faltan N por $X" con la lista y Agregarlos. */}
        {resCuadre && <CuadreCartolaLinea documentoId={doc.id} resumen={resCuadre} onAgregado={onCuadreAgregado} />}

        {/* FILAS QUE NO ENTRARON (2026-09-03): el processor de plantillas
            siempre las guardó en progreso_ia.errores_filas, pero el visor solo
            mostraba las que SÍ entraron — el cliente subía 4 filas, leía "2
            movimientos · 2/2 listas" y perdía una factura sin enterarse.
            Advertir sí, bloquear jamás: las buenas siguen su camino. */}
        {(() => {
          const errs = ((doc.progreso_ia as { errores_filas?: { fila: number; error: string }[] } | null)?.errores_filas) ?? [];
          if (errs.length === 0) return null;
          return (
            <div style={{ marginTop: "0.6em", display: "flex", gap: 7, alignItems: "flex-start", padding: "0.55em 0.8em", borderRadius: 9, background: "color-mix(in srgb, var(--amber) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)", fontSize: "0.85em", lineHeight: 1.45, color: "var(--text)" }}>
              <span style={{ color: "var(--amber)", flexShrink: 0 }}>⚠</span>
              <span>
                <b>{errs.length === 1 ? "1 fila de tu archivo quedó fuera" : `${errs.length} filas de tu archivo quedaron fuera`}</b> — no se van a facturar.
                {errs.slice(0, 3).map((e, i) => (
                  <span key={i} style={{ display: "block", color: "var(--text2)", fontSize: "0.94em" }}>
                    {e.fila > 0 ? `Fila ${e.fila}: ` : ""}{e.error}
                  </span>
                ))}
                {errs.length > 3 && <span style={{ display: "block", color: "var(--text3)", fontSize: "0.94em" }}>y {errs.length - 3} más.</span>}
                <span style={{ display: "block", color: "var(--text3)", fontSize: "0.94em", marginTop: 2 }}>Corrígelas en tu Excel y sube el archivo de nuevo.</span>
              </span>
            </div>
          );
        })()}

        {/* ACUSE DE RECIBO del contexto (fix placebo): el cliente escribió una
            nota — acá VE que se leyó y qué produjo. El motivo viene saneado del
            server y va rotulado como generado por IA; nunca prescribe categoría. */}
        {contexto && contexto.trim() && (() => {
          const nota = contexto.trim().slice(0, 60) + (contexto.trim().length > 60 ? "…" : "");
          if (veredicto?.contradice) {
            // UNA frase, la ACCIÓN primero (pedido fundador 2026-09-02: "dijiste
            // que son facturas → ve a la mesa de Facturas"). El detalle de la IA
            // vive en el hover (title), no amontonado en el aviso.
            const accion = veredicto.accion ?? "revisar";
            const mensaje = accion === "mesa_facturas"
              ? <><b>Dijiste que esto son facturas</b> — y esta es la mesa de boletas. Cámbiate a la mesa de <b>Facturas</b> (toca el logo de tu empresa) y sube el archivo allá.</>
              : accion === "no_son_ventas"
                ? <><b>Dijiste que esto no son ventas tuyas</b> — entonces no llevan boleta. En <b>Editar</b>, apriétales ✕ (sin boleta). ¿Dudas? Tu contador manda.</>
                : <><b>Tu nota dice otra cosa que la clasificación.</b> Las {count} quedaron pendientes — revísalas en <b>Editar</b> antes de aprobar.</>;
            return (
              <div title={veredicto.motivo ? `IA: ${veredicto.motivo} (generado a partir de tu nota "${nota}")` : undefined}
                style={{ marginTop: "0.6em", display: "flex", gap: 7, alignItems: "flex-start", padding: "0.55em 0.8em", borderRadius: 9, background: "color-mix(in srgb, var(--amber) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)", fontSize: "0.85em", lineHeight: 1.45, color: "var(--text)" }}>
                <span style={{ color: "var(--amber)", flexShrink: 0 }}>⚠</span>
                <span>{mensaje}</span>
              </div>
            );
          }
          if (veredicto && veredicto.revisado) {
            return (
              <div style={{ marginTop: "0.55em", fontSize: "0.8em", color: "var(--text3)", lineHeight: 1.4 }}>
                ✦ Leímos tu nota <b style={{ color: "var(--text2)" }}>&ldquo;{nota}&rdquo;</b>: la clasificación ya calza con lo que dijiste — no cambió nada.
              </div>
            );
          }
          if (veredicto && !veredicto.revisado) {
            return (
              <div style={{ marginTop: "0.55em", fontSize: "0.8em", color: "var(--text3)", lineHeight: 1.4 }}>
                ✦ Tu nota <b style={{ color: "var(--text2)" }}>&ldquo;{nota}&rdquo;</b> quedó guardada, pero no alcanzamos a contrastarla — dale una mirada extra al Editar.
              </div>
            );
          }
          return (
            <div style={{ marginTop: "0.55em", fontSize: "0.8em", color: "var(--text3)", lineHeight: 1.4 }}>
              ✦ Tu nota <b style={{ color: "var(--text2)" }}>&ldquo;{nota}&rdquo;</b> se usó al clasificar estos movimientos.
            </div>
          );
        })()}
        {/* Deshacer "No es una cartola" (vuelta 6c): solo en un PDF sin lectura de cartola. */}
        {!cuadre && /\.pdf$/i.test(doc.nombre_archivo) && <LeerComoCartola documentoId={doc.id} onHecho={onCuadreAgregado} />}
      </div>

      {/* ACCIONES — decidida: la cartola ya se fue a Emitir; acá no hay nada que
          editar/aprobar/eliminar (Eliminar borraría aprobadas comprometidas). El
          único gesto es IR a Emitir, donde vive la última mirada y el Devolver. */}
      {revisionPendiente ? (
        <div data-testid="cta-columnas" style={{ width: "clamp(180px, 34%, 320px)", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "0.75em", borderLeft: "1px solid var(--border)", paddingLeft: "1.4em" }}>
          <div title={columnas?.motivo ?? undefined} style={{ fontSize: "0.92em", color: sinMarcaBanco ? "var(--amber)" : "var(--text2)", fontWeight: sinMarcaBanco ? 650 : undefined, lineHeight: 1.4, textAlign: "center", ...(sinMarcaBanco ? {} : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }) }}>
            {/* El aviso del AÑO (fechas sin año) y el de PDF SIN MARCA DE BANCO
                (vuelta 6) van visibles y completos: es lo que el cliente tiene que mirar. */}
            {columnas?.otraVez || sinMarcaBanco || /\baño\b/.test(columnas?.motivo ?? "") ? columnas?.motivo : "No pudimos comprobar esta cartola solos: dinos qué es cada columna y listo."}
          </div>
          <button className="vcart-cb" onClick={onRevisarColumnas} disabled={!onRevisarColumnas || busy}
            style={{ background: "var(--accent)", color: "#fff", fontSize: "1.15em", padding: "1.2em 1em" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16M15 4v16" /></svg>
            Revisar columnas
          </button>
          <div style={{ fontSize: "0.78em", color: "var(--text3)", textAlign: "center", lineHeight: 1.4 }}>
            Editar y aprobar se activan cuando confirmes las columnas.
          </div>
          {onEliminar && (
            <button onClick={onEliminar} disabled={busy}
              style={{ alignSelf: "center", border: "none", background: "transparent", color: eliminarArmado ? "var(--red)" : "var(--text3)", fontSize: "0.82em", fontWeight: 600, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2 }}>
              {eliminarArmado ? "¿Seguro? Eliminar todo" : "Eliminar cartola"}
            </button>
          )}
        </div>
      ) : decidida ? (
        <div style={{ width: "clamp(160px, 30%, 285px)", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "0.9em", borderLeft: "1px solid var(--border)", paddingLeft: "1.4em" }}>
          <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: "1em", fontWeight: 800, color: "var(--blue)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            Todo enviado a Emitir
          </div>
          <button className="vcart-cb" onClick={() => window.dispatchEvent(new CustomEvent("switch-tab", { detail: "emitir" }))}
            style={{ background: "color-mix(in srgb, var(--blue) 16%, transparent)", color: "var(--blue)", fontSize: "1.05em" }}>
            Ver en Emitir →
          </button>
          <div style={{ fontSize: "0.8em", color: "var(--text3)", textAlign: "center", lineHeight: 1.45 }}>
            ¿Te arrepentiste? Devuélvela completa desde la pestaña Emitir.
          </div>
        </div>
      ) : (
      confirming && puedeAprobar ? (
        /* CONFIRMACIÓN COMPACTA (pedido fundador 2026-09-02): antes el resumen
           multilínea se apilaba SOBRE Editar/Aprobar/Eliminar y los botones se
           corrían (Eliminar quedaba cortado). Ahora la columna entera SE
           REEMPLAZA por la confirmación — una línea de resumen, el CTA y
           Cancelar — y al cancelar vuelve todo idéntico. Nada se mueve. */
        <div style={{ width: "clamp(160px, 30%, 285px)", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "0.7em", borderLeft: "1px solid var(--border)", paddingLeft: "1.4em" }}>
          <div style={{ fontSize: "0.85em", color: "var(--text2)", lineHeight: 1.4, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <b style={{ color: "var(--text)" }}>{listas}</b> a Emitir
            {afectasListas > 0 && <> · afecta {afectasListas}</>}
            {exentasListas > 0 && <> · exenta {exentasListas}</>}
            {" "}· <b style={{ color: "var(--text)" }}>{fmt(totalListas)}</b>
          </div>
          <button className="vcart-cb" onClick={() => { setConfirming(false); onAprobar(); }} disabled={busy} style={{ background: "var(--accent)", color: "#fff", fontSize: "1.05em" }}>
            {busy
              ? <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "vcart-spin .8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.2-8.56" /></svg>Enviando…</>
              : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Aprobar y enviar a Emitir</>}
          </button>
          <div style={{ fontSize: "0.75em", color: "var(--text3)", textAlign: "center" }}>El envío al SII se confirma en Emitir.</div>
          <button onClick={() => setConfirming(false)} disabled={busy} style={{ border: "1px solid var(--border)", borderRadius: 11, background: "transparent", color: "var(--text2)", fontSize: "0.9em", fontWeight: 600, padding: "0.55em", cursor: "pointer" }}>Cancelar</button>
        </div>
      ) : (
      <div style={{ width: "clamp(160px, 30%, 285px)", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.1em", borderLeft: "1px solid var(--border)", paddingLeft: "1.4em" }}>
        <button className="vcart-cb" onClick={onEditar} disabled={busy} style={{ background: "var(--bg-muted)", color: "var(--text)", fontSize: "1.12em" }}>
          {preguntas > 0 ? (
            <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4" /><path d="M12 17h.01" /></svg>{preguntas === 1 ? "Responder 1 pregunta" : `Responder ${preguntas} preguntas`}</>
          ) : (
            <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>Editar</>
          )}
        </button>
        {(
          <>
            {/* Aprobar SIEMPRE visible: poner las tx listas en el popup Editar es la
                palanca que lo habilita — esa es la barrera hacia Emitir. */}
            <button className="vcart-cb" onClick={() => setConfirming(true)} disabled={busy || !puedeAprobar}
              title={!puedeAprobar ? (pendientes > 0 ? guiaPendientesTexto : "No hay transacciones listas para aprobar") : undefined}
              style={{ background: "var(--accent)", color: "#fff", fontSize: "1.12em" }}>
              {busy
                ? <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "vcart-spin .8s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.2-8.56" /></svg>Enviando…</>
                : <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>Aprobar {listas}</>}
            </button>
            {!puedeAprobar && (
              <div style={{ fontSize: "0.85em", color: "var(--text3)", fontWeight: 600, textAlign: "center", lineHeight: 1.4, marginTop: "-0.4em" }}>
                {pendientes > 0 ? guiaPendientes
                  : count === 0 && (resCuadre?.faltan ?? 0) > 0 ? <>Agrega las filas que faltan para empezar</>
                  : todoJuzgado ? <>Las {juzgadas} quedaron <b>sin boleta</b> (juzgadas). ¿Te arrepentiste? Restáuralas en <b>Editar</b>.</>
                  : <>Todo enviado a Emitir</>}
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
      )
      )}
    </div>
  );
}

/**
 * Enlace discreto "Leerlo como cartola" (vuelta 6c): aparece solo si el cliente
 * marcó ESTE PDF como "No es una cartola". Quita la marca del mapa de su empresa
 * y lo reprocesa (el server valida que el reproceso pueda partir).
 */
function LeerComoCartola({ documentoId, onHecho }: { documentoId: string; onHecho?: () => void }) {
  const [marcado, setMarcado] = useState(false);
  const [estado, setEstado] = useState<"" | "enviando" | string>("");
  useEffect(() => {
    let vivo = true;
    fetch(`/api/parser/leer-como-cartola?documento_id=${encodeURIComponent(documentoId)}`)
      .then((r) => (r.ok ? r.json() : { marcado: false }))
      .then((j: { marcado?: boolean }) => { if (vivo) setMarcado(!!j.marcado); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [documentoId]);
  if (!marcado) return null;
  async function leer() {
    setEstado("enviando");
    try {
      const res = await fetch("/api/parser/leer-como-cartola", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documento_id: documentoId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "No pudimos volver a leerlo");
      setEstado("Listo: lo estamos leyendo como cartola");
      setMarcado(false);
      onHecho?.();
    } catch (e) { setEstado(e instanceof Error ? e.message : "No pudimos volver a leerlo"); }
  }
  return (
    <div style={{ marginTop: "0.55em", fontSize: "0.8em", color: "var(--text3)", lineHeight: 1.4 }}>
      Dijiste que este PDF no es una cartola.{" "}
      <button onClick={leer} disabled={estado === "enviando"} style={{ border: "none", background: "transparent", padding: 0, color: "var(--text2)", fontWeight: 650, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2, fontSize: "1em" }}>
        Leerlo como cartola
      </button>
      {estado && estado !== "enviando" ? <span> · {estado}</span> : null}
    </div>
  );
}
