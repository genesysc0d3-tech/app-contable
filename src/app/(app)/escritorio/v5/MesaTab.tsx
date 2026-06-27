"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import DocCardList from "./DocCardList";
import VisualizarArchivo from "./VisualizarArchivo";
import FieldMapper from "@/components/upload/FieldMapper";
import HintSelector from "@/components/upload/HintSelector";
import GlosaComunControl from "./GlosaComunControl";
import { ConfianzaGroupSection, classifyConfianza, type Propuesta, type ClienteResumen } from "./revisar-shared";
import VeredictoCard from "./VeredictoCard";
import BoletaVisor, { type BoletaEmitida } from "./BoletaVisor";
import { useMesaReload, pendingOpenDoc } from "./mesa-reload";
import type { MesaDateDependent } from "./mesa-data";

type DocRow = ComponentProps<typeof DocCardList>["docs"][number];

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

  const docs = mesa.docsAgregados as DocRow[];
  const selDoc = docs.find((d) => d.id === selDocId) ?? null;

  // Tx que llega desde Emitir (Por revisar/Bloqueadas): se abre cuando aparece
  // en la mesa. Suscripción a eventos (setState en callback, no en el cuerpo del
  // effect); docsRef mantiene la lista actual sin re-suscribir. "mesa-updated"
  // cubre el caso de otro mes (tras navegar el calendario).
  const docsRef = useRef(docs);
  useEffect(() => { docsRef.current = docs; }, [docs]);
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

  const selProps = (selDoc ? propsByDoc.get(selDoc.id) : undefined) ?? [];
  const pend = selProps.filter((p) => p.estado === "pendiente" || p.estado === "aprobado" || p.estado === "editado");
  const alta = pend.filter((p) => classifyConfianza(p) === "alta");
  const media = pend.filter((p) => classifyConfianza(p) === "media");
  const baja = pend.filter((p) => classifyConfianza(p) === "baja");

  const tipo = selDoc
    ? ((selDoc.tipo ?? "").startsWith("boleta_") ? "boleta"
      : (selDoc.nombre_archivo ?? "").startsWith("Telegram ") ? "telegram"
        : "massdte")
    : null;

  // Boleta ya emitida vinculada al doc (boleta única / emisión directa).
  const selBoletaId = selDoc ? ((selDoc.progreso_ia as { boleta_id?: string } | null)?.boleta_id ?? null) : null;
  const selBoleta = (tipo === "boleta" && selBoletaId)
    ? ((mesa.boletasView as unknown as BoletaEmitida[]).find((b) => b.id === selBoletaId) ?? null)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
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
          <VeredictoCard key={pend[0].id} propuesta={pend[0]} clientes={clientes} empresaId={empresaId} empresaTipo={empresaTipo} onAction={reload} onClose={() => setSelDocId(null)} documentoId={selDoc.id} onViewImage={() => setViewImgDocId(selDoc.id)} />
        ) : tipo === "boleta" && selBoleta ? (
          <BoletaVisor key={selBoleta.id} boleta={selBoleta} onClose={() => setSelDocId(null)} onVerEnBoletas={() => window.dispatchEvent(new CustomEvent("switch-tab", { detail: "boletas" }))} />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px 6px", flexShrink: 0 }}>
              <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--text3)", flexShrink: 0 }}>Visor</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selDoc.nombre_archivo}</span>
              {tipo === "telegram" && (
                <button onClick={() => setViewImgDocId(selDoc.id)} title="Ver comprobante"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 600, color: "#5b9cf6", background: "rgba(91,156,246,.08)", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer", flexShrink: 0 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                  Comprobante
                </button>
              )}
              <button onClick={() => setSelDocId(null)} title="Cerrar visor"
                style={{ width: 22, height: 22, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text2)", cursor: "pointer", fontSize: 14, lineHeight: 1, flexShrink: 0 }}>×</button>
            </div>

            <div>
              {tipo === "boleta" && (
                <div style={{ padding: "0 16px 14px" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 9, fontWeight: 800, padding: "4px 9px", borderRadius: 8, background: "rgba(34,197,94,.12)", color: "#22c55e" }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7" /></svg>
                    Emitida · en Boletas
                  </span>
                  <div style={{ marginTop: 8, fontSize: 10, color: "var(--text2)", lineHeight: 1.45 }}>Esta boleta se emitió directo al SII. Para corregir o anular, emite una Nota de Crédito.</div>
                  <button onClick={() => window.dispatchEvent(new CustomEvent("switch-tab", { detail: "boletas" }))}
                    style={{ marginTop: 10, fontSize: 10, fontWeight: 600, color: "#E8553E", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Ver en Boletas →</button>
                </div>
              )}

              {tipo === "telegram" && (
                <div style={{ padding: "0 16px 14px", fontSize: 10, color: "var(--text2)" }}>{selDoc.estado === "procesando" ? "Procesando comprobante…" : "Sin propuesta pendiente para este comprobante."}</div>
              )}

              {tipo === "massdte" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "0 16px 6px" }}>
                    <button onClick={() => setMappingDocId(selDoc.id)}
                      style={{ fontSize: 9, fontWeight: 600, color: "var(--text2)", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>↔ Mapear</button>
                    {selDoc.estado === "procesado" && <HintSelector documentoId={selDoc.id} current={selDoc.tipo_operacion_hint ?? null} />}
                    <span style={{ fontSize: 9, color: "var(--text3)", marginLeft: "auto" }}>{selDoc.movimientos_detectados ?? 0} mov</span>
                  </div>
                  {selDoc.estado === "procesado" && (
                    <div style={{ padding: "0 16px 6px" }}>
                      <GlosaComunControl documentoId={selDoc.id} hint={selDoc.tipo_operacion_hint ?? null} glosaInicial={selDoc.glosa_comun ?? null} activaInicial={selDoc.glosa_activa ?? true} />
                    </div>
                  )}
                  {pend.length === 0 ? (
                    <div style={{ padding: "0 16px 14px", fontSize: 10, color: "var(--text2)" }}>{selDoc.estado === "procesando" ? "Procesando movimientos…" : "Sin propuestas pendientes en este documento."}</div>
                  ) : (
                    <>
                      <ConfianzaGroupSection tipo="alta" label="Alta confianza" propuestas={alta} color="#22c55e" clientes={clientes} empresaId={empresaId} onAction={reload} empresaTipoContribuyente={empresaTipo} empresaGiro={empresaGiro} />
                      <ConfianzaGroupSection tipo="media" label="Requiere revisión" propuestas={media} color="#f59e0b" clientes={clientes} empresaId={empresaId} onAction={reload} empresaTipoContribuyente={empresaTipo} empresaGiro={empresaGiro} />
                      <ConfianzaGroupSection tipo="baja" label="Falta información" propuestas={baja} color="#E8553E" clientes={clientes} empresaId={empresaId} onAction={reload} empresaTipoContribuyente={empresaTipo} empresaGiro={empresaGiro} />
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── ÁRBOL ── */}
      <div className="r-scroll" style={{ flex: 1, minHeight: 0 }}>
        <DocCardList
          docs={docs}
          empresaId={empresaId}
          tipoEmpresa={empresaTipo}
          tipoMix={mesa.docTipoMix}
          docProgress={mesa.docProgress}
          periodoMode={mesa.workMode}
          forceTree
          selectedDocId={selDocId}
          onSelectDoc={(d) => setSelDocId(d.id)}
        />
      </div>

      {mappingDocId && typeof document !== "undefined" && createPortal(
        <FieldMapper documentoId={mappingDocId} onClose={() => setMappingDocId(null)} onSaved={() => { setMappingDocId(null); reload(); }} />,
        document.body,
      )}
      {viewImgDocId && typeof document !== "undefined" && createPortal(
        <VisualizarArchivo documentoId={viewImgDocId} onClose={() => setViewImgDocId(null)} />,
        document.body,
      )}
    </div>
  );
}
