"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import DocCardList from "./DocCardList";
import DocPanelsBoard from "./DocPanelsBoard";
import VisualizarArchivo from "./VisualizarArchivo";
import FieldMapper, { FieldMapperBody, prefetchPreview } from "@/components/upload/FieldMapper";
import HintSelector from "@/components/upload/HintSelector";
import GlosaComunControl from "./GlosaComunControl";
import MedioPagoControl from "./MedioPagoControl";
import { ConfianzaGroupSection, classifyConfianza, type Propuesta, type ClienteResumen } from "./revisar-shared";
import VeredictoCard from "./VeredictoCard";
import VeredictoCartola from "./VeredictoCartola";
// Perf: el editor bulk de cartolas sale del bundle inicial (solo existe dentro
// del popup); se precarga en idle tras montar la mesa — abrir sigue instantáneo.
const CartolaEditor = dynamic(() => import("./CartolaEditor"), { ssr: false });
import { aprobarCartola } from "../../revisar/actions";
import { useToast } from "@/components/Toast";
import BoletaVisor, { type BoletaEmitida } from "./BoletaVisor";
import { useMesaReload, pendingOpenDoc } from "./mesa-reload";
import type { MesaDateDependent } from "./mesa-data";

type DocRow = ComponentProps<typeof DocCardList>["docs"][number];

/**
 * ¿Es una cartola bancaria? (varios movimientos venidos de un Excel/CSV del
 * banco). Solo se usa para SUGERIR el método de pago: en una cartola la plata
 * entró por el banco, así que "Efectivo" es incorrecto por definición. La
 * decisión final siempre es del usuario — la app no la cambia sola.
 */
function esCartolaBancaria(doc: DocRow): boolean {
  const tipo = (doc.tipo ?? "").toLowerCase();
  const movs = doc.movimientos_detectados ?? 0;
  return movs > 1 && (tipo === "excel" || tipo === "csv");
}

// Pestaña fusionada "Check de agregados": el árbol Finder es la navegación; el
// VISOR (arriba, permanente y de altura fija) muestra el detalle del documento
// seleccionado según su tipo.
//  - Telegram (1 tx)  → tarjeta de propuesta editable (compacta) + comprobante
//  - Boleta única     → resumen read-only ("Emitida · en Boletas")
//  - Cartola MassDTE  → configs globales (Mapear/Tipo/Glosa) + sus propuestas
export default function MesaTab({ mesa, clientes, empresaId, empresaGiro, empresaTipo }: {
  mesa: MesaDateDependent;
  clientes: ClienteResumen[];
  empresaId: string;
  empresaGiro: string | null;
  empresaTipo: string | null;
}) {
  const reload = useMesaReload() ?? (() => {});
  const [selDocId, setSelDocId] = useState<string | null>(null);
  const [viewImgDocId, setViewImgDocId] = useState<string | null>(null);
  const [mappingDocId, setMappingDocId] = useState<string | null>(null);
  const [editarCartolaId, setEditarCartolaId] = useState<string | null>(null);
  // Pantalla activa DENTRO del popup Editar: la grilla de edición o el mapeo de
  // columnas. "Mapear" es otra pantalla del MISMO popup (no un modal apilado que
  // quedaba detrás por z-index).
  const [editarScreen, setEditarScreen] = useState<"editar" | "mapear">("editar");
  const [aprobandoCartola, setAprobandoCartola] = useState(false);
  const { toast } = useToast();

  const docs = mesa.docsAgregados as DocRow[];
  const selDoc = docs.find((d) => d.id === selDocId) ?? null;

  // Documentos agrupados por FUENTE para el tablero de 3 paneles del Check
  // (Telegram / massDTE / boleta única). Misma clasificación que el `tipo` del visor.
  const grupos = useMemo(() => {
    const telegram: DocRow[] = [], massdte: DocRow[] = [], boleta: DocRow[] = [];
    for (const d of docs) {
      const n = d.nombre_archivo ?? "";
      if ((d.tipo ?? "").startsWith("boleta_")) boleta.push(d);
      else if (n.startsWith("Telegram ") || n.startsWith("Álbum ")) telegram.push(d);
      else massdte.push(d);
    }
    return { telegram, massdte, boleta };
  }, [docs]);

  // Tx que llega desde Emitir (Por revisar/Bloqueadas): se abre cuando aparece
  // en la mesa. Suscripción a eventos (setState en callback, no en el cuerpo del
  // effect); docsRef mantiene la lista actual sin re-suscribir. "mesa-updated"
  // cubre el caso de otro mes (tras navegar el calendario).
  const docsRef = useRef(docs);
  useEffect(() => { docsRef.current = docs; }, [docs]);

  // Precarga en idle del chunk del CartolaEditor (dynamic import arriba): baja
  // en silencio 2s después de montar la mesa; abrir el popup sigue instantáneo.
  useEffect(() => {
    const t = window.setTimeout(() => { void import("./CartolaEditor"); }, 2000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    // defer a microtarea: lee la lista YA commiteada (cubre el cambio de mes).
    const tryOpen = () => window.setTimeout(() => {
      const id = pendingOpenDoc.id;
      if (id && docsRef.current.some((d) => d.id === id)) {
        pendingOpenDoc.id = null;
        setSelDocId(id);
      }
    }, 0);
    window.addEventListener("mesa-updated", tryOpen);
    window.addEventListener("massdte:try-open", tryOpen);
    return () => {
      window.removeEventListener("mesa-updated", tryOpen);
      window.removeEventListener("massdte:try-open", tryOpen);
    };
  }, []);

  // Escape cierra el popup Editar (mismo patrón que EditorAmpliado).
  useEffect(() => {
    if (!editarCartolaId) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setEditarCartolaId(null); setEditarScreen("editar"); reload(); }
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [editarCartolaId, reload]);

  // Propuestas agrupadas por documento (ya vienen en memoria — sin fetch extra).
  const propsByDoc = useMemo(() => {
    const m = new Map<string, Propuesta[]>();
    for (const p of mesa.propuestas as Propuesta[]) {
      const id = p.movimientos_raw?.documentos_subidos?.id;
      if (!id) continue;
      const arr = m.get(id);
      if (arr) arr.push(p); else m.set(id, [p]);
    }
    return m;
  }, [mesa.propuestas]);

  // Cartolas completamente DECIDIDAS (pedido fundador 2026-09-01): sin pendientes
  // ni listas — todo aprobado (en Emitir) o juzgado. Se tachan en la mesa del Check.
  const docsDecididos = useMemo(() => {
    const s = new Set<string>();
    propsByDoc.forEach((arr, id) => {
      if (arr.length === 0) return;
      const sinDecidir = arr.some((p) => p.estado === "pendiente" || p.estado === "editado" || p.estado === "listo");
      const hayAprobada = arr.some((p) => p.estado === "aprobado");
      if (!sinDecidir && hayAprobada) s.add(id);
    });
    return s;
  }, [propsByDoc]);

  // Nombre + monto por documento para las filas del árbol (Telegram muestra
  // receptor·monto en vez del nombre de archivo). Toma la 1ª propuesta del doc.
  const infoByDoc = useMemo(() => {
    const m: Record<string, { nombre: string; monto: number | null }> = {};
    propsByDoc.forEach((arr, id) => {
      const p = arr[0];
      if (!p) return;
      const desc = p.movimientos_raw?.descripcion ?? "";
      // Si no hay receptor explícito, saca el nombre de la glosa ("...a/de NOMBRE por $...").
      const nombre = p.receptor_nombre || desc.match(/(?:\ba\b|\bde\b)\s+(.+?)\s+por\s+\$/i)?.[1] || desc || "Comprobante";
      m[id] = { nombre, monto: p.total ?? p.movimientos_raw?.monto ?? null };
    });
    return m;
  }, [propsByDoc]);

  // Documentos con tx "atascadas en Emitir" (por revisar / bloqueadas), para
  // avisar en el árbol de Check sin salir de la pestaña.
  const stuckByDoc = useMemo(() => {
    const m: Record<string, { porRevisar: number; bloqueadas: number }> = {};
    for (const it of (mesa.pendientes.items as Array<{ documento_id: string | null; balde: string }>)) {
      if (!it.documento_id) continue;
      if (it.balde === "por_revisar") (m[it.documento_id] ??= { porRevisar: 0, bloqueadas: 0 }).porRevisar++;
      else if (it.balde === "bloqueadas") (m[it.documento_id] ??= { porRevisar: 0, bloqueadas: 0 }).bloqueadas++;
    }
    return m;
  }, [mesa.pendientes]);

  const selProps = (selDoc ? propsByDoc.get(selDoc.id) : undefined) ?? [];
  const pend = selProps.filter((p) => p.estado === "pendiente" || p.estado === "aprobado" || p.estado === "editado" || p.estado === "listo");
  const alta = pend.filter((p) => classifyConfianza(p) === "alta");
  const media = pend.filter((p) => classifyConfianza(p) === "media");
  const baja = pend.filter((p) => classifyConfianza(p) === "baja");

  // "Aprobar" de la cartola (atómico): promueve las 'listo' → 'aprobado' (a Emitir).
  const handleAprobarCartola = async () => {
    if (!selDoc) return;
    setAprobandoCartola(true);
    try {
      const r = await aprobarCartola(selDoc.id);
      if (r.error) toast(r.error, "error"); else toast(`${r.count} enviadas a Emitir`);
      reload();
    } catch {
      // Un throw de la server action dejaba el botón "Aprobar" deshabilitado para
      // siempre (setAprobandoCartola(false) no corría sin finally).
      toast("Error de conexión — intenta de nuevo", "error");
    } finally {
      setAprobandoCartola(false);
    }
  };

  // Reprocesar una cartola que quedó en error (el visor ofrece esta salida en vez
  // del dead-end "Sin propuestas pendientes"). El route fuerza el re-encolado.
  const [reprocesando, setReprocesando] = useState(false);
  const handleReprocesar = async (docId: string) => {
    if (reprocesando) return;
    setReprocesando(true);
    try {
      const res = await fetch("/api/procesar-documento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documento_id: docId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) { toast(json.error ?? "No se pudo reprocesar", "error"); return; }
      toast("Reprocesando la cartola…");
      reload();
    } catch {
      toast("Error de red — intenta de nuevo", "error");
    } finally {
      setReprocesando(false);
    }
  };

  const tipoNombre = (selDoc?.nombre_archivo ?? "");
  const tipo = selDoc
    ? ((selDoc.tipo ?? "").startsWith("boleta_") ? "boleta"
      : (tipoNombre.startsWith("Telegram ") || tipoNombre.startsWith("Álbum ")) ? "telegram"
        : "massdte")
    : null;

  // Boleta ya emitida vinculada al doc (boleta única / emisión directa).
  const selBoletaId = selDoc ? ((selDoc.progreso_ia as { boleta_id?: string } | null)?.boleta_id ?? null) : null;
  const selBoleta = (tipo === "boleta" && selBoletaId)
    ? ((mesa.boletasView as unknown as BoletaEmitida[]).find((b) => b.id === selBoletaId) ?? null)
    : null;

  // Eliminar el documento COMPLETO de la mesa (archivo + propuestas), solo si aún
  // no tiene boletas emitidas (la barrera final de Emitir no se toca; el server
  // re-valida en /api/eliminar-documento). Confirmación inline de dos pasos.
  const selFrozen = selDoc ? ((mesa.docProgress as Record<string, { emitida?: number }>)?.[selDoc.id]?.emitida ?? 0) > 0 : false;
  const [elimArmado, setElimArmado] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState(false);
  const eliminarSelDoc = async () => {
    if (!selDoc || eliminando) return;
    const docId = selDoc.id;
    if (elimArmado !== docId) {
      setElimArmado(docId);
      setTimeout(() => setElimArmado((v) => (v === docId ? null : v)), 4000);
      return;
    }
    setElimArmado(null);
    setEliminando(true);
    try {
      const res = await fetch("/api/eliminar-documento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documento_id: docId }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast(json.error ?? "No se pudo eliminar el documento", "error"); return; }
      toast("Documento eliminado de la mesa");
      setSelDocId(null);
      reload();
    } catch {
      toast("Error de red — intenta de nuevo", "error");
    } finally {
      setEliminando(false);
    }
  };
  const puedeEliminarSel = Boolean(selDoc) && tipo !== "boleta" && !selFrozen && selDoc?.estado !== "procesando" && !(selDoc && docsDecididos.has(selDoc.id));

  // Un DocCardList (árbol) por panel, con la lista de su fuente; selección compartida.
  const renderArbol = (list: DocRow[]) => (
    <DocCardList
      docs={list}
      empresaId={empresaId}
      tipoEmpresa={empresaTipo}
      tipoMix={mesa.docTipoMix}
      docProgress={mesa.docProgress}
      periodoMode={mesa.workMode}
      infoByDoc={infoByDoc}
      stuckByDoc={stuckByDoc}
      forceTree
      bare
      docsDecididos={docsDecididos}
      selectedDocId={selDocId}
      onSelectDoc={(d) => setSelDocId(d.id)}
    />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {mesa.propuestasTruncadas && (
        <div style={{ flexShrink: 0, fontSize: 10, fontWeight: 600, color: "var(--amber)", background: "color-mix(in srgb, var(--amber) 12%, transparent)", borderBottom: "1px solid var(--border)", padding: "5px 12px", textAlign: "center" }}>
          Mostrando {mesa.propuestas.length} de {mesa.propuestasTotal} propuestas del período — acota el rango (día/semana) para verlas todas.
        </div>
      )}
      {/* ── VISOR (permanente, altura fija) ── */}
      <div style={{ flexShrink: 0, height: "clamp(172px, 24vh, 224px)", minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", scrollbarWidth: "thin", borderBottom: "1px solid var(--bg-muted)" }}>
        {!selDoc ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: "var(--text3)" }}>
            <div style={{ maxWidth: 250 }}>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ margin: "0 auto 10px", opacity: .5 }}><path d="M9 17H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6" /><path d="M7 7h10M7 11h6" /><path d="m14 15 3 3 5-6" /></svg>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", letterSpacing: "-.01em" }}>Selecciona un documento</div>
              <div style={{ fontSize: 10, marginTop: 4, lineHeight: 1.45 }}>Elige una fila de abajo y su detalle aparece acá para revisarlo o emitirlo.</div>
            </div>
          </div>
        ) : tipo === "telegram" && pend[0] ? (
          <VeredictoCard key={pend[0].id} propuesta={pend[0]} clientes={clientes} empresaId={empresaId} empresaTipo={empresaTipo} onAction={reload} onClose={() => setSelDocId(null)} documentoId={selDoc.id} onViewImage={() => setViewImgDocId(selDoc.id)} onEliminar={puedeEliminarSel ? eliminarSelDoc : undefined} eliminarArmado={elimArmado === selDoc.id} />
        ) : tipo === "boleta" && selBoleta ? (
          <BoletaVisor key={selBoleta.id} boleta={selBoleta} onClose={() => setSelDocId(null)} onVerEnBoletas={() => window.dispatchEvent(new CustomEvent("switch-tab", { detail: "boletas" }))} />
        ) : tipo === "massdte" && selDoc.estado === "procesado" && pend.length > 0 ? (
          <VeredictoCartola key={selDoc.id} doc={selDoc} propuestas={pend} tipoMix={mesa.docTipoMix[selDoc.id]} empresaId={empresaId} onClose={() => setSelDocId(null)} onEditar={() => { setEditarScreen("editar"); setEditarCartolaId(selDoc.id); }} onAprobar={handleAprobarCartola} busy={aprobandoCartola} onEliminar={puedeEliminarSel ? eliminarSelDoc : undefined} eliminarArmado={elimArmado === selDoc.id} mesa={mesa.mesaActiva} decidida={docsDecididos.has(selDoc.id)} />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 6px", flexShrink: 0 }}>
              <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text3)", flexShrink: 0 }}>Visor</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selDoc.nombre_archivo}</span>
              {tipo === "telegram" && (
                <button onClick={() => setViewImgDocId(selDoc.id)} title="Ver comprobante"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 600, color: "var(--blue)", background: "rgba(91,156,246,.08)", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", flexShrink: 0 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                  Comprobante
                </button>
              )}
              {puedeEliminarSel && (
                <button onClick={eliminarSelDoc} disabled={eliminando}
                  title="Elimina el documento completo de la mesa: archivo, movimientos y propuestas. Solo posible si no tiene boletas emitidas."
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700, color: "var(--red)", background: "color-mix(in srgb, var(--red) 8%, transparent)", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", flexShrink: 0, opacity: eliminando ? .6 : 1 }}>
                  {eliminando ? "Eliminando…" : elimArmado === selDoc.id ? "¿Seguro? Eliminar todo" : "🗑 Eliminar"}
                </button>
              )}
              <button onClick={() => setSelDocId(null)} title="Cerrar visor"
                style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text2)", cursor: "pointer", fontSize: 14, lineHeight: 1, flexShrink: 0 }}>×</button>
            </div>

            <div>
              {tipo === "boleta" && (
                <div style={{ padding: "0 16px 14px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 9, fontWeight: 800, padding: "4px 9px", borderRadius: 8, background: "rgba(34,197,94,.12)", color: "var(--green)" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
                    Emitida · en Boletas
                  </span>
                  <div style={{ marginTop: 8, fontSize: 10, color: "var(--text2)", lineHeight: 1.45 }}>Esta boleta se emitió directo al SII. Para corregir o anular, escríbenos a soporte.</div>
                  <button onClick={() => window.dispatchEvent(new CustomEvent("switch-tab", { detail: "boletas" }))}
                    style={{ marginTop: 10, fontSize: 10, fontWeight: 600, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Ver en Boletas →</button>
                </div>
              )}

              {tipo === "telegram" && (
                <div style={{ padding: "0 16px 14px", fontSize: 10, color: "var(--text2)" }}>{selDoc.estado === "procesando" ? "Procesando comprobante…" : "Sin propuesta pendiente para este comprobante."}</div>
              )}

              {tipo === "massdte" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "0 16px 6px" }}>
                    <button onClick={() => setMappingDocId(selDoc.id)}
                      onMouseEnter={() => prefetchPreview(selDoc.id)} onFocus={() => prefetchPreview(selDoc.id)}
                      style={{ fontSize: 9, fontWeight: 600, color: "var(--text2)", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>↔ Mapear</button>
                    {selDoc.estado === "procesado" && <HintSelector documentoId={selDoc.id} current={selDoc.tipo_operacion_hint ?? null} />}
                    <span style={{ fontSize: 9, color: "var(--text3)", marginLeft: "auto" }}>{selDoc.movimientos_detectados ?? 0} mov</span>
                  </div>
                  {selDoc.estado === "procesado" && (
                    <div style={{ padding: "0 16px 6px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <GlosaComunControl documentoId={selDoc.id} hint={selDoc.tipo_operacion_hint ?? null} glosaInicial={selDoc.glosa_comun ?? null} activaInicial={selDoc.glosa_activa ?? true} mesa={mesa.mesaActiva} />
                      {mesa.mesaActiva !== "factura" && <MedioPagoControl documentoId={selDoc.id} esCartola={esCartolaBancaria(selDoc)} medioInicial={selDoc.medio_pago_comun ?? null} />}
                    </div>
                  )}
                  {pend.length === 0 && selDoc.estado === "error" ? (
                    <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>No se pudo leer esta cartola</div>
                      <div style={{ fontSize: 10, color: "var(--text2)", lineHeight: 1.5 }}>
                        {(selDoc.progreso_ia as { error?: string } | null)?.error || "Ocurrió un problema al procesar el archivo."}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                        <button onClick={() => handleReprocesar(selDoc.id)} disabled={reprocesando}
                          style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 7, padding: "6px 12px", cursor: reprocesando ? "wait" : "pointer", opacity: reprocesando ? 0.6 : 1 }}>
                          {reprocesando ? "Reprocesando…" : "↻ Reprocesar"}
                        </button>
                        <button onClick={() => setMappingDocId(selDoc.id)}
                          style={{ fontSize: 10, fontWeight: 600, color: "var(--text2)", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 12px", cursor: "pointer" }}>
                          ↔ Mapear columnas
                        </button>
                      </div>
                      <div style={{ fontSize: 9, color: "var(--text3)", lineHeight: 1.5 }}>
                        Si el formato del banco no se reconoció, usa <b>Mapear columnas</b> para indicar dónde están fecha, monto y descripción.
                      </div>
                    </div>
                  ) : pend.length === 0 ? (
                    <div style={{ padding: "0 16px 14px", fontSize: 10, color: "var(--text2)" }}>{selDoc.estado === "procesando" ? "Procesando movimientos…" : "Sin propuestas pendientes en este documento."}</div>
                  ) : (
                    <>
                      <ConfianzaGroupSection tipo="alta" label="Alta confianza" propuestas={alta} color="var(--green)" clientes={clientes} empresaId={empresaId} onAction={reload} empresaTipoContribuyente={empresaTipo} empresaGiro={empresaGiro} />
                      <ConfianzaGroupSection tipo="media" label="Requiere revisión" propuestas={media} color="var(--amber)" clientes={clientes} empresaId={empresaId} onAction={reload} empresaTipoContribuyente={empresaTipo} empresaGiro={empresaGiro} />
                      <ConfianzaGroupSection tipo="baja" label="Falta información" propuestas={baja} color="var(--accent)" clientes={clientes} empresaId={empresaId} onAction={reload} empresaTipoContribuyente={empresaTipo} empresaGiro={empresaGiro} />
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── DOCUMENTOS: 3 paneles arrastrables (izq 1 + der 2 apilados), scroll c/u ── */}
      <DocPanelsBoard
        panels={[
          { id: "telegram", titulo: "Telegram", sub: "comprobantes", count: grupos.telegram.length, render: () => renderArbol(grupos.telegram) },
          { id: "massdte", titulo: "massDTE", sub: "cartolas", count: grupos.massdte.length, render: () => renderArbol(grupos.massdte) },
          { id: "boleta", titulo: "Boleta única", sub: "emisión directa", count: grupos.boleta.length, render: () => renderArbol(grupos.boleta) },
        ]}
      />

      {mappingDocId && typeof document !== "undefined" && createPortal(
        <FieldMapper documentoId={mappingDocId} onClose={() => setMappingDocId(null)} onSaved={() => { setMappingDocId(null); reload(); }} />,
        document.body,
      )}
      {viewImgDocId && typeof document !== "undefined" && createPortal(
        <VisualizarArchivo documentoId={viewImgDocId} onClose={() => setViewImgDocId(null)} />,
        document.body,
      )}

      {/* Popup "Editar" de cartola. Dos PANTALLAS del mismo popup: la grilla de
          edición y el mapeo de columnas (antes un modal aparte que quedaba detrás). */}
      {editarCartolaId && typeof document !== "undefined" && createPortal(
        <div onClick={() => { setEditarCartolaId(null); setEditarScreen("editar"); reload(); }} style={{ position: "fixed", inset: 0, zIndex: 120, display: "grid", placeItems: "center", padding: 24, background: "rgba(0,0,0,.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "min(1040px, 96vw)", maxHeight: "86vh", display: "flex", flexDirection: "column", borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 30px 90px rgba(0,0,0,.5)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              {editarScreen === "mapear" ? (
                <>
                  <button onClick={() => setEditarScreen("editar")} title="Volver a editar" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "var(--text2)", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 11px 5px 8px", cursor: "pointer" }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" /></svg>
                    Volver
                  </button>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text3)", border: "1px solid var(--border)", borderRadius: 99, padding: "3px 10px" }}>Mapear columnas</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selDoc?.nombre_archivo}</span>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text3)", border: "1px solid var(--border)", borderRadius: 99, padding: "3px 10px" }}>Editar</span>
                  <span style={{ fontSize: 14.5, fontWeight: 750, letterSpacing: "-.01em", color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selDoc?.nombre_archivo}</span>
                  <button onClick={() => setEditarScreen("mapear")} onMouseEnter={() => prefetchPreview(editarCartolaId)} onFocus={() => prefetchPreview(editarCartolaId)} style={{ fontSize: 11, fontWeight: 650, color: "var(--text2)", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 99, padding: "7px 14px", cursor: "pointer" }}>↔ Mapear columnas</button>
                </>
              )}
              <button onClick={() => { setEditarCartolaId(null); setEditarScreen("editar"); reload(); }} title="Cerrar" style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer", fontSize: 17, lineHeight: 1 }}>×</button>
            </div>
            {editarScreen === "mapear" ? (
              <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto", color: "var(--text)", fontFamily: "var(--font-geist-sans), sans-serif" }}>
                <FieldMapperBody
                  documentoId={editarCartolaId}
                  variant="embedded"
                  onClose={() => setEditarScreen("editar")}
                  onSaved={() => { setEditarScreen("editar"); reload(); }}
                />
              </div>
            ) : (
              <>
                {selDoc?.estado === "procesado" && (
                  <div style={{ padding: "11px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, background: "color-mix(in srgb, var(--text) 2%, transparent)" }}>
                    <HintSelector documentoId={editarCartolaId} current={selDoc.tipo_operacion_hint ?? null} />
                    <div style={{ flex: "2 1 240px", minWidth: 200 }}>
                      <GlosaComunControl documentoId={editarCartolaId} hint={selDoc.tipo_operacion_hint ?? null} glosaInicial={selDoc.glosa_comun ?? null} activaInicial={selDoc.glosa_activa ?? true} mesa={mesa.mesaActiva} />
                    </div>
                    {mesa.mesaActiva !== "factura" && (
                      <div aria-hidden style={{ width: 1, height: 18, background: "color-mix(in srgb, var(--text) 12%, transparent)", flexShrink: 0 }} />
                    )}
                    {mesa.mesaActiva !== "factura" && (
                      <div style={{ flex: "0 1 auto", minWidth: 0, overflow: "hidden" }}>
                        <MedioPagoControl documentoId={editarCartolaId} esCartola={esCartolaBancaria(selDoc)} medioInicial={selDoc.medio_pago_comun ?? null} />
                      </div>
                    )}
                  </div>
                )}
                <CartolaEditor propuestas={selProps} clientes={clientes} empresaId={empresaId} empresaTipo={empresaTipo} onAction={reload} />
                <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
                  <button onClick={() => { setEditarCartolaId(null); setEditarScreen("editar"); reload(); }} style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 10, padding: "10px 22px", cursor: "pointer" }}>Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
