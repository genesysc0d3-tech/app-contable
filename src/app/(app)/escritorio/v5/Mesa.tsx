"use client";

import Link from "next/link";
import TabsV5 from "./TabsV5";
import EmitirTabContent from "./EmitirTabContent";
import MesaTab from "./MesaTab";
import DescargarBoletaButton from "@/components/boletas/DescargarBoletaButton";
import PreviewBoletaButton from "@/components/boletas/PreviewBoletaButton";
import { formatShortDateEsCl } from "@/lib/display-date";
import type { ClienteResumen } from "./revisar-shared";
import type { MesaDateDependent } from "./mesa-data";

const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

function compactEmpty(kind: "subidos" | "boletas") {
  const isSubidos = kind === "subidos";
  return (
    <div className="r-scroll" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 320, padding: "42px 18px", textAlign: "center", color: "var(--text2)" }}>
      <style>{`@keyframes emptySonar{0%{transform:scale(.72);opacity:.45}70%,100%{transform:scale(1.22);opacity:0}}@keyframes emptyDraw{0%{stroke-dashoffset:54;opacity:.28}50%{opacity:1}100%{stroke-dashoffset:0;opacity:.48}}`}</style>
      <div>
        <div style={{ position: "relative", width: 104, height: 104, margin: "0 auto 16px" }}>
          <div style={{ position: "absolute", inset: 8, borderRadius: "50%", border: isSubidos ? "1px solid rgba(232,85,62,.26)" : "1px solid rgba(59,130,246,.25)", animation: "emptySonar 2.8s ease-out infinite" }} />
          {isSubidos ? (
            <svg viewBox="0 0 96 96" fill="none" style={{ position: "absolute", inset: 0, color: "var(--accent)" }}><path d="M30 72h36a8 8 0 0 0 8-8V34L56 16H30a8 8 0 0 0-8 8v40a8 8 0 0 0 8 8Z" stroke="currentColor" strokeWidth="4" /><path d="M55 16v17h18" stroke="currentColor" strokeWidth="4" /><path d="M35 49h26M35 59h18" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="54" style={{ animation: "emptyDraw 2.8s ease-in-out infinite" }} /></svg>
          ) : (
            <svg viewBox="0 0 96 96" fill="none" style={{ position: "absolute", inset: 0, color: "#3B82F6" }}><path d="M29 15h30l12 12v54H29a6 6 0 0 1-6-6V21a6 6 0 0 1 6-6Z" stroke="currentColor" strokeWidth="4" /><path d="M59 16v13h13" stroke="currentColor" strokeWidth="4" /><path d="M35 45h26M35 56h20M35 67h27" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="54" style={{ animation: "emptyDraw 2.8s ease-in-out infinite" }} /></svg>
          )}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", letterSpacing: "-.025em" }}>{isSubidos ? "Nada por aquí" : "Aún no hay boletas"}</div>
        <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.45, maxWidth: 270 }}>{isSubidos ? "Esta mesa no tiene documentos agregados todavía." : "Los documentos emitidos en esta mesa aparecerán aquí."}</div>
      </div>
    </div>
  );
}

export type MesaProps = {
  mesa: MesaDateDependent;
  clientes: ClienteResumen[];
  empresaId: string;
  empresaGiro: string | null;
  empresaRazon: string;
  empresaTipo: string | null;
};

export default function Mesa({ mesa, clientes, empresaId, empresaGiro, empresaRazon, empresaTipo }: MesaProps) {
  return (
    <TabsV5
      boletasLabel={mesa.mesaActiva === "factura" ? "Facturas" : "Boletas"}
      pendCount={mesa.pendCount}
      aprobCount={mesa.aprobCount}
      nombreEmpresa={empresaRazon}
      fecha={mesa.calendar.selectedDateLabel}
      subidosContent={
        mesa.docsAgregados.length > 0 || mesa.propuestas.length > 0 ? (
          <MesaTab mesa={mesa} clientes={clientes} empresaId={empresaId} empresaGiro={empresaGiro} empresaTipo={empresaTipo} />
        ) : (
          compactEmpty("subidos")
        )
      }
      emitirContent={<EmitirTabContent empresaId={empresaId} mesa={mesa.mesaActiva} initial={{ ok: true, items: mesa.pendientes.items, totales: mesa.pendientes.totales, aprobadas_otros_tipos: mesa.pendientes.aprobadas_otros_tipos }} />}
      boletasContent={
        mesa.boletasCount === 0 ? (
          compactEmpty("boletas")
        ) : (
          <div className="r-scroll">
            <div className="sec">
              <div className="bl-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 0 8px" }}>
                <span style={{ fontSize: 10, color: "var(--text)", fontWeight: 600 }}>Últimas emitidas</span>
                <Link href="/boletas/reportes" style={{ fontSize: 9, color: "var(--text2)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6" /></svg>
                  Ver reporte RCV
                </Link>
              </div>
              {mesa.boletasView.map((b) => {
                const esAnulada = b.estado === "anulada";
                return (
                  <div key={b.id} className={`bl-item ${esAnulada ? "an" : ""}`}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--border)", opacity: esAnulada ? 0.5 : 1 }}>
                    <div className="ic" style={{ width: 28, height: 28, borderRadius: 6, background: b.es_unica ? "rgba(232,85,62,.07)" : "var(--bg-muted)", border: b.es_unica ? "1px dashed rgba(232,85,62,.5)" : "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: b.es_unica ? "var(--accent)" : "var(--text2)" }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    </div>
                    <div className="inf" style={{ flex: 1, minWidth: 0 }}>
                      <div className="top" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: "var(--text)" }}>
                        <span className="fl" style={{ color: "var(--text)" }}>#{b.folio}</span>
                        <span className={`bd ${b.tipo_dte === 39 ? "af" : b.tipo_dte === 41 ? "ex" : "an"}`}
                          style={{ fontSize: 7, padding: "1px 5px", borderRadius: 8, fontWeight: 600, background: b.tipo_dte === 39 ? "var(--accent-light)" : b.tipo_dte === 41 ? "rgba(59,130,246,.1)" : "var(--bg-muted)", color: b.tipo_dte === 39 ? "var(--accent)" : b.tipo_dte === 41 ? "var(--blue)" : "var(--text2)" }}
                        >{b.tipo_dte === 39 ? "AFECTA" : b.tipo_dte === 41 ? "EXENTA" : `DTE ${b.tipo_dte}`}</span>
                        {b.es_unica && (
                          <span style={{ fontSize: 7, padding: "1px 5px", borderRadius: 8, fontWeight: 800, border: "1px dashed rgba(232,85,62,.55)", background: "rgba(232,85,62,.06)", color: "var(--accent)" }}>ÚNICA</span>
                        )}
                        {esAnulada && (
                          <span className="bd an" style={{ fontSize: 7, padding: "1px 5px", borderRadius: 8, fontWeight: 600, background: "var(--bg-muted)", color: "var(--text2)" }}>ANULADA</span>
                        )}
                      </div>
                      <div className="sub" style={{ fontSize: 9, color: "var(--text2)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.es_unica && b.detalle ? <><span style={{ color: "var(--text)" }}>{b.detalle}</span> · </> : null}
                        {b.receptor_razon_social ?? "Sin receptor"} · {formatShortDateEsCl(b.fecha_emision, true)}
                      </div>
                    </div>
                    <span className="mo" style={{ fontSize: 11, fontWeight: 600, textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                      {fmt(b.monto_total)}
                    </span>
                    <PreviewBoletaButton id={b.id} />
                    <DescargarBoletaButton id={b.id} />
                  </div>
                );
              })}
            </div>
          </div>
        )
      }
    />
  );
}
