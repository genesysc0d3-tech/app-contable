"use client";

// Modal del motor masivo: sale ENCIMA de la pestaña Emitir al apretar "Emitir N".
// Usa useEmisionLote (la cola real). Autorización legal UNA vez (versionada, con
// traza), luego confirmación liviana por tanda. Estados: idle → emitiendo →
// terminada | requiere_revision | detenida (+ pausa por error/tope).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chileDateString } from "@/lib/chile-date";
import { recoverLatestFolio, type RecoverLatestResult } from "@/lib/emission/recover-latest";
import { useEmisionLote, type ItemLoteEmision } from "./useEmisionLote";
import { verificarExtensionCompatible } from "./useExtensionStatus";
import { guardarLotePendiente, limpiarLotePendiente } from "@/lib/emission/lote-persist";

export interface LoteItemInput {
  id: string;
  descripcion: string;
  receptor_nombre: string | null;
  receptor_rut: string | null;
  receptor_direccion?: string | null;
  receptor_comuna?: string | null;
  receptor_email?: string | null;
  receptor_telefono?: string | null;
  /** Facturas: giro del receptor (obligatorio en el documento). */
  receptor_giro?: string | null;
  medio_pago?: string | null;
  detalle?: string | null;
  tipo_sugerido: number | null;
  monto_total: number;
}

/** Capabilities que el carril de facturas exige en el PONG de la extensión. */
const FACT_CAPABILITIES_REQUERIDAS = [
  "sii_portal_factura_33",
  "sii_portal_factura_34",
  "sii_vault_cert_password",
];

const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const ACCENT = "#E8553E";

export default function EmitirLoteModal({
  items, empresaId, empresaRut, totalOriginal, mesa = "boleta", formaPagoLote = null, onClose, onDone,
}: {
  items: LoteItemInput[];
  empresaId: string;
  empresaRut?: string | null;
  /** Total del lote ORIGINAL (para el banner honesto entre reanudaciones). Si no
   *  viene, es una emisión fresca y el total es items.length. */
  totalOriginal?: number;
  /** boleta (39/41, e-Boleta) | factura (33/34, portal gratuito del SII). */
  mesa?: "boleta" | "factura";
  /** Facturas: forma de pago del lote, elegida por el usuario (sin default). */
  formaPagoLote?: "contado" | "credito" | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { progreso, pausa, corriendo, jobIdRevision, iniciar, detener, responderPausa } = useEmisionLote({ empresaId, empresaRut });
  const [modo, setModo] = useState<"idle" | "legal" | "verificando">("idle");
  const [error, setError] = useState<string | null>(null);
  // Snapshot de la lista con la que ARRANCÓ el lote: el runner procesa este
  // snapshot estable (iniciar(loteItems)), pero el prop `items` se ENCOGE en vivo
  // por el Realtime de MesaController (cada boleta emitida sale de pendientes). El
  // rastro de reanudación DEBE cortar sobre el snapshot, no sobre el prop reactivo,
  // o slice(procesadas) se corre y pierde boletas por reanudar.
  const itemsAlIniciarRef = useRef<LoteItemInput[] | null>(null);

  const hoy = useMemo(() => chileDateString(new Date()), []);
  const total = useMemo(() => items.reduce((s, i) => s + i.monto_total, 0), [items]);
  const esFacturas = mesa === "factura";
  // Copy honesto por mesa (una factura no es "boleta").
  const doc = esFacturas ? "factura" : "boleta";
  const docs = esFacturas ? "facturas" : "boletas";

  const loteItems: ItemLoteEmision[] = useMemo(() => items.map((i) => {
    const tipoDte: 33 | 34 | 39 | 41 = esFacturas
      ? (i.tipo_sugerido === 33 ? 33 : 34)
      : (i.tipo_sugerido === 39 ? 39 : 41);
    return {
      propuestaId: i.id,
      tipoDte,
      monto: i.monto_total,
      etiqueta: i.receptor_nombre?.trim() || i.descripcion || (esFacturas ? "Factura" : "Boleta"),
      receptorRut: i.receptor_rut,
      receptorNombre: i.receptor_nombre,
      receptorDireccion: i.receptor_direccion,
      receptorComuna: i.receptor_comuna,
      receptorEmail: i.receptor_email,
      receptorTelefono: i.receptor_telefono,
      receptorGiro: i.receptor_giro,
      formaPago: esFacturas ? formaPagoLote : null,
      medioPago: i.medio_pago,
      detalle: i.detalle?.trim() || (tipoDte === 41 || tipoDte === 34 ? "Venta exenta" : "Servicio prestado"),
      fechaEmision: hoy,
    };
  }), [items, hoy, esFacturas, formaPagoLote]);

  // Autorización legal versionada (una vez por proveedor). El server la re-exige.
  async function confirmar() {
    setError(null);
    setModo("verificando");
    // Facturas sin forma de pago = no hay lote (espec Matías: elección expresa).
    // El selector vive en EmitirTabContent; esto es la red de seguridad.
    if (esFacturas && formaPagoLote !== "contado" && formaPagoLote !== "credito") {
      setError("Elige la forma de pago del lote (Contado o Crédito) antes de emitir.");
      setModo("idle");
      return;
    }
    // Piso de versión de la extensión: una vieja emite "bien" hasta que algo
    // cambia bajo sus pies (dominio, protocolo) — mejor frenar acá con
    // instrucciones claras que fallar a mitad de lote. Facturas exige además
    // las capabilities del carril (extensión 0.2.0+), con copy de cómo actualizar.
    const compat = await verificarExtensionCompatible(esFacturas ? FACT_CAPABILITIES_REQUERIDAS : undefined);
    if (!compat.ok) {
      setError(compat.motivo ?? "La extensión del SII no está disponible.");
      setModo("idle");
      return;
    }
    try {
      const res = await fetch("/api/emision/authorizations?provider=sii_local");
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok && json?.authorized) { setModo("idle"); itemsAlIniciarRef.current = items; void iniciar(loteItems); return; }
      if (!res.ok && json?.error && json.error !== "EMISSION_AUTHORIZATION_REQUIRED") {
        setError(json.detalle ?? json.error ?? "No se pudo revisar la autorización."); setModo("idle"); return;
      }
      setModo("legal"); // hace falta aceptar
    } catch {
      setError("Error de red al revisar la autorización."); setModo("idle");
    }
  }

  async function aceptarLegal() {
    setError(null);
    setModo("verificando");
    try {
      const res = await fetch("/api/emision/authorizations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "sii_local", tipo_dte: loteItems[0]?.tipoDte ?? 41, ui_context: "emision_lote" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || !json?.authorized) {
        setError(json?.detalle ?? json?.error ?? "No se pudo registrar la autorización."); setModo("legal"); return;
      }
      setModo("idle"); itemsAlIniciarRef.current = items; void iniciar(loteItems);
    } catch {
      setError("Error de red al autorizar."); setModo("legal");
    }
  }

  const fase = progreso?.fase;
  // Fin VOLUNTARIO (terminó todo / el usuario detuvo): no hay nada que reanudar.
  const terminalLimpio = fase === "terminada" || fase === "detenida";
  const terminal = terminalLimpio || fase === "requiere_revision";
  // Cerrar solo cuando no hay una emisión en vuelo (proteger el folio).
  const puedeCerrar = !corriendo || terminal;

  // Persistir QUÉ FALTA para reanudar si se cierra la pestaña a mitad, o si el SII
  // congela el lote en una boleta "a medias" (requiere_revision). Solo IDs (sin PII);
  // al reabrir se re-hidratan contra los pendientes del server. Se borra al terminar
  // o detener; un cierre duro NO llega acá → el rastro queda para reanudar.
  useEffect(() => {
    if (terminalLimpio) { itemsAlIniciarRef.current = null; limpiarLotePendiente(empresaId, mesa); return; }
    if (!progreso) return;
    // corriendo = cierre en vuelo; requiere_revision = freno por "a medias" (H-1):
    // en ambos, lo que falta (slice tras la ya-procesada) debe quedar reanudable.
    // Se corta sobre el SNAPSHOT congelado al iniciar (no el prop `items`, que el
    // Realtime encoge), para que slice(procesadas) no se corra ni pierda boletas.
    if (corriendo || fase === "requiere_revision") {
      const base = itemsAlIniciarRef.current ?? items;
      const remainingIds = base.slice(progreso.procesadas).map((i) => i.id);
      guardarLotePendiente(empresaId, { remainingIds, total: totalOriginal ?? base.length }, mesa);
    }
  }, [progreso, corriendo, fase, terminalLimpio, empresaId, items, totalOriginal, mesa]);

  return createPortal(
    <div
      onClick={() => { if (puedeCerrar) { onClose(); if (terminal) onDone?.(); } }}
      style={{ position: "fixed", inset: 0, zIndex: 220, display: "grid", placeItems: "center", padding: 20, background: "rgba(6,7,10,.62)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
    >
      <style>{`@keyframes gl-spin{to{transform:rotate(360deg)}}@keyframes gl-pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}@keyframes gl-rise{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(400px,94vw)", background: "var(--surface)", border: "1px solid var(--border2, rgba(255,255,255,.10))", borderRadius: 16, padding: "22px 22px 20px", boxShadow: "0 24px 60px rgba(0,0,0,.5)", color: "var(--text)", animation: "gl-rise .26s cubic-bezier(.2,.8,.2,1)", position: "relative" }}
      >
        {puedeCerrar && (
          <button aria-label="Cerrar" onClick={() => { onClose(); if (terminal) onDone?.(); }}
            style={{ position: "absolute", top: 15, right: 15, width: 26, height: 26, border: 0, background: "var(--bg-muted)", color: "var(--text2)", borderRadius: 7, cursor: "pointer", fontSize: 13 }}>✕</button>
        )}

        {!progreso && (modo === "idle" || modo === "verificando") && <Idle count={items.length} total={total} doc={doc} docs={docs} formaPago={esFacturas ? formaPagoLote : null} onConfirmar={confirmar} verificando={modo === "verificando"} error={error} />}
        {!progreso && modo === "legal" && <Legal onAceptar={aceptarLegal} onCancelar={() => setModo("idle")} error={error} />}

        {progreso && (fase === "emitiendo" || fase === "esperando" || fase === "pausada" || fase === "preparando") && (
          <Corriendo p={progreso} onDetener={detener} />
        )}
        {progreso && fase === "terminada" && <Terminada p={progreso} doc={doc} docs={docs} onCerrar={() => { onClose(); onDone?.(); }} />}
        {progreso && fase === "requiere_revision" && <Revision p={progreso} jobId={jobIdRevision} doc={doc} onCerrar={() => { onClose(); onDone?.(); }} />}
        {progreso && fase === "detenida" && <Detenida p={progreso} onCerrar={() => { onClose(); onDone?.(); }} />}

        {pausa && <Pausa motivo={pausa.motivo} doc={doc} onSeguir={() => responderPausa("continuar")} onDetener={() => responderPausa("detener")} />}
      </div>
    </div>,
    document.body,
  );
}

const eyebrow = { fontSize: 10.5, letterSpacing: ".14em", color: "var(--text3)", textTransform: "uppercase" as const, fontWeight: 700, marginBottom: 13, display: "flex", alignItems: "center", gap: 7 };
const dot = { width: 6, height: 6, borderRadius: "50%", background: ACCENT };
const h1 = { fontSize: 22, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.15 };
const primaryBtn = { width: "100%", border: 0, borderRadius: 11, padding: 13, fontSize: 15, fontWeight: 700, cursor: "pointer", background: ACCENT, color: "#fff", marginTop: 16 };
const ghostBtn = { border: "1px solid var(--border2, rgba(255,255,255,.10))", borderRadius: 10, padding: "11px 14px", background: "var(--bg-muted)", color: "var(--text)", fontSize: 13, fontWeight: 600, cursor: "pointer" };

function Idle({ count, total, doc, docs, formaPago, onConfirmar, verificando, error }: { count: number; total: number; doc: string; docs: string; formaPago?: "contado" | "credito" | null; onConfirmar: () => void; verificando: boolean; error: string | null }) {
  return (
    <>
      <div style={eyebrow}><span style={dot} />Emitir al SII</div>
      <div style={h1}>{count} {count === 1 ? `${doc} lista` : `${docs} listas`}</div>
      <div style={{ fontSize: 13.5, color: "var(--text2)", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
        {fmt(total)} · revisadas y aprobadas por ti{formaPago ? ` · ${formaPago === "contado" ? "Contado" : "Crédito"}` : ""}
      </div>
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 16, padding: "11px 12px", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text3)", lineHeight: 1.45 }}>
        <span style={{ marginTop: 1 }}>🔒</span>
        <span>Emites con tus claves del SII: el contenido es <b style={{ color: "var(--text2)" }}>tu responsabilidad</b>. MassDTE automatiza el envío — no asesora ni valida montos.</span>
      </div>
      {error && <div style={{ marginTop: 10, fontSize: 12, color: "var(--red,#ef4444)" }}>{error}</div>}
      <button onClick={onConfirmar} disabled={verificando} style={{ ...primaryBtn, opacity: verificando ? .6 : 1 }}>{verificando ? "Verificando…" : `Emitir las ${count} →`}</button>
      <div style={{ textAlign: "center", fontSize: 11, color: "var(--text3)", marginTop: 11 }}>Se emiten una a una, a ritmo humano.</div>
    </>
  );
}

function Legal({ onAceptar, onCancelar, error }: { onAceptar: () => void; onCancelar: () => void; error: string | null }) {
  const label = { fontSize: 9, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase" as const, color: "var(--text3)", marginBottom: 3 };
  const body = { fontSize: 12, color: "var(--text2)", lineHeight: 1.5 };
  return (
    <>
      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.02em", marginBottom: 12 }}>Autorización de emisión</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div><div style={label}>Qué autorizas</div><div style={{ ...body, color: "var(--text)" }}>Autorizo a MassDTE a emitir documentos tributarios (boletas o facturas) en el SII con mis claves, por mi instrucción (SII local asistido).</div></div>
        <div><div style={label}>Tu responsabilidad</div><div style={body}>Soy el contribuyente emisor y el responsable del contenido de cada documento. La herramienta automatiza; no asesora ni valida montos.</div></div>
        <div><div style={label}>Registro</div><div style={body}>Esta aceptación queda registrada con versión legal, usuario, empresa, fecha y proveedor.</div></div>
      </div>
      {error && <div style={{ marginTop: 10, fontSize: 12, color: "var(--red,#ef4444)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button onClick={onCancelar} style={ghostBtn}>Cancelar</button>
        <button onClick={onAceptar} style={{ flex: 1, border: 0, borderRadius: 10, padding: "11px 14px", background: ACCENT, color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>Acepto y autorizo</button>
      </div>
    </>
  );
}

function Corriendo({ p, onDetener }: { p: import("@/lib/emission/lote-runner").ProgresoLote; onDetener: () => void }) {
  const emit = p.emitidas;
  const pct = p.total ? Math.round((emit / p.total) * 100) : 0;
  const cur = p.itemActual;
  const recientes = p.folios.slice(-6);
  return (
    <>
      <div style={eyebrow}><span style={dot} />Emitiendo al SII</div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{Math.min(emit + 1, p.total)} <span style={{ color: "var(--text3)", fontWeight: 500 }}>de {p.total}</span></div>
        <div style={{ fontSize: 13, color: "var(--text2)", fontVariantNumeric: "tabular-nums" }}>{pct}%</div>
      </div>
      <div style={{ height: 6, background: "var(--bg-muted)", borderRadius: 99, marginTop: 12, overflow: "hidden" }}>
        <div style={{ height: "100%", background: ACCENT, borderRadius: 99, width: `${pct}%`, transition: "width .5s cubic-bezier(.4,0,.2,1)" }} />
      </div>
      {cur && (
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "13px 14px", marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur.etiqueta}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: cur.tipoDte === 41 || cur.tipoDte === 34 ? "rgba(34,197,94,.14)" : "rgba(232,85,62,.14)", color: cur.tipoDte === 41 || cur.tipoDte === 34 ? "#5fd98a" : "#f0836f" }}>{cur.tipoDte === 41 || cur.tipoDte === 34 ? "Exenta" : "Afecta"}</span>
              <span style={{ fontSize: 14.5, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(cur.monto)}</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, fontSize: 12.5, color: "var(--text2)" }}>
            <span style={{ width: 13, height: 13, border: "2px solid var(--border2, rgba(255,255,255,.10))", borderTopColor: ACCENT, borderRadius: "50%", animation: "gl-spin .7s linear infinite" }} />
            {p.subestado ?? "Emitiendo…"}
          </div>
        </div>
      )}
      {recientes.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 15, flexWrap: "wrap" }}>
          {recientes.map((f) => (
            <span key={f} style={{ fontSize: 11.5, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "#5fd98a", background: "rgba(34,197,94,.10)", border: "1px solid rgba(34,197,94,.18)", borderRadius: 7, padding: "3px 8px", animation: "gl-pop .3s ease" }}>✓ {f}</span>
          ))}
        </div>
      )}
      <button onClick={onDetener} style={{ ...ghostBtn, width: "100%", marginTop: 16, color: "#f0836f", padding: 11 }}>Detener</button>
    </>
  );
}

function Badge({ bg, children }: { bg: string; children: React.ReactNode }) {
  return <div style={{ width: 46, height: 46, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, background: bg, fontSize: 22 }}>{children}</div>;
}
function chips(list: { l: string; v: string }[]) {
  return (
    <div style={{ display: "flex", gap: 7, marginTop: 14, flexWrap: "wrap" }}>
      {list.map((c) => <span key={c.l} style={{ fontSize: 12, color: "var(--text2)", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "4px 10px" }}>{c.l} <b style={{ color: "var(--text)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{c.v}</b></span>)}
    </div>
  );
}

function Terminada({ p, doc, docs, onCerrar }: { p: import("@/lib/emission/lote-runner").ProgresoLote; doc: string; docs: string; onCerrar: () => void }) {
  const folios = p.folios;
  const rango = folios.length ? (folios.length === 1 ? `${folios[0]}` : `${folios[0]} – ${folios[folios.length - 1]}`) : "—";
  const fallas = p.resultados.filter((r) => r.desenlace.estado === "fallida");
  const motivo = fallas.length > 0 && "motivo" in fallas[0].desenlace ? fallas[0].desenlace.motivo : null;

  // HONESTIDAD DEL CIERRE (cazado en vivo 2026-08-27): con TODO fallido el
  // modal decía "Listo ✅ 0 emitidas" — un check verde sobre un fracaso total
  // (p. ej. lock de cuenta tomado). Cero emitidas = advertencia con el motivo.
  if (folios.length === 0) {
    return (
      <>
        <Badge bg="rgba(245,158,11,.13)">⚠️</Badge>
        <div style={h1}>No se emitió ninguna</div>
        <div style={{ fontSize: 13.5, color: "var(--text2)", marginTop: 3 }}>
          {p.total === 1 ? `La ${doc} no se pudo emitir.` : `Ninguna de las ${p.total} ${docs} se pudo emitir.`}
        </div>
        {motivo && <div style={{ fontSize: 12.5, color: "var(--text2)", marginTop: 8, background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 11px", textAlign: "left" }}>{motivo}</div>}
        <button onClick={onCerrar} style={{ ...ghostBtn, width: "100%", marginTop: 18 }}>Cerrar y revisar</button>
      </>
    );
  }

  return (
    <>
      <Badge bg="rgba(34,197,94,.13)">✅</Badge>
      <div style={h1}>Listo</div>
      <div style={{ fontSize: 13.5, color: "var(--text2)", marginTop: 3 }}>{folios.length} {folios.length === 1 ? `${doc} emitida` : `${docs} emitidas`} y guardadas.</div>
      {chips([{ l: "Folios", v: rango }, ...(fallas.length > 0 ? [{ l: "Fallidas", v: `${fallas.length}` }] : [])])}
      {fallas.length > 0 && motivo && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 8 }}>Última falla: {motivo}</div>}
      <button onClick={onCerrar} style={{ ...ghostBtn, width: "100%", marginTop: 18 }}>Ver en el historial</button>
    </>
  );
}

function Revision({ p, jobId, doc, onCerrar }: { p: import("@/lib/emission/lote-runner").ProgresoLote; jobId: string | null; doc: string; onCerrar: () => void }) {
  const faltan = p.total - p.procesadas;
  const [recuperando, setRecuperando] = useState(false);
  const [res, setRes] = useState<RecoverLatestResult | null>(null);

  async function recuperar() {
    setRecuperando(true);
    setRes(await recoverLatestFolio(jobId));
    setRecuperando(false);
  }

  // Éxito: el folio quedó registrado y la lápida se levantó → la propuesta ya no
  // está bloqueada. Cierre limpio.
  if (res?.estado === "recuperado") {
    return (
      <>
        <Badge bg="rgba(34,197,94,.13)">✅</Badge>
        <div style={h1}>Folio recuperado</div>
        <div style={{ fontSize: 13.5, color: "var(--text2)", marginTop: 3 }}>
          {res.folio ? `Folio ${res.folio} ` : `La ${doc} `}{res.already ? "ya estaba guardada." : "quedó guardada en la app."} Puedes emitir el resto desde la pestaña.
        </div>
        <button onClick={onCerrar} style={{ ...primaryBtn }}>Cerrar</button>
      </>
    );
  }

  return (
    <>
      <Badge bg="rgba(245,158,11,.13)">⚠️</Badge>
      <div style={h1}>Me detuve en la {doc} {p.procesadas}</div>
      <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, marginTop: 6 }}>
        Emitiste, pero no pude confirmar el folio. Esta {doc} quedó <span style={{ color: "#f6ab3d", fontWeight: 600 }}>bloqueada</span> para que no salga dos veces. Recupera su folio antes de seguir. <span style={{ color: "#f6ab3d", fontWeight: 600 }}>No la vuelvas a emitir a mano.</span>
      </div>
      {res?.estado === "sin_resultado" && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text2)", lineHeight: 1.45 }}>
          No encontré un folio para recuperar. Si la ventana del SII <b>no</b> mostró un folio, no se emitió nada. Abre la ventana del SII para confirmar; la boleta queda en revisión (no la re-emitas hasta estar seguro).
        </div>
      )}
      {res?.estado === "error" && <div style={{ marginTop: 10, fontSize: 12, color: "var(--red,#ef4444)" }}>{res.mensaje}</div>}
      {chips([{ l: "emitidas", v: String(p.emitidas) }, { l: "a medias", v: String(p.revision) }, { l: "faltan", v: String(Math.max(0, faltan)) }])}
      <button onClick={recuperar} disabled={recuperando} style={{ ...primaryBtn, opacity: recuperando ? 0.6 : 1 }}>
        {recuperando ? "Recuperando…" : `Recuperar el folio de esta ${doc}`}
      </button>
      <button onClick={onCerrar} style={{ ...ghostBtn, width: "100%", marginTop: 10 }}>Ir a la ventana SII</button>
    </>
  );
}

function Detenida({ p, onCerrar }: { p: import("@/lib/emission/lote-runner").ProgresoLote; onCerrar: () => void }) {
  return (
    <>
      <Badge bg="rgba(255,255,255,.05)">⏹</Badge>
      <div style={h1}>Detenido</div>
      <div style={{ fontSize: 13.5, color: "var(--text2)", marginTop: 3 }}>{p.emitidas} de {p.total} emitidas. El resto quedó intacto.</div>
      {p.folios.length > 0 && chips([{ l: "Folios", v: p.folios.length === 1 ? `${p.folios[0]}` : `${p.folios[0]} – ${p.folios[p.folios.length - 1]}` }])}
      <button onClick={onCerrar} style={{ ...primaryBtn }}>Cerrar</button>
    </>
  );
}

function Pausa({ motivo, doc, onSeguir, onDetener }: { motivo: "error" | "tope"; doc: string; onSeguir: () => void; onDetener: () => void }) {
  const texto = motivo === "tope"
    ? "Llegaste al tope de esta tanda. ¿Sigues con las próximas?"
    : `Esa ${doc} no se pudo emitir. ¿La saltas y sigues con las próximas, o te detienes?`;
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(6,7,10,.82)", borderRadius: 16, display: "grid", placeItems: "center", padding: 22 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{motivo === "tope" ? "Pausa de seguridad" : `Una ${doc} falló`}</div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, marginBottom: 16, maxWidth: 300 }}>{texto}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={onDetener} style={ghostBtn}>Detener</button>
          <button onClick={onSeguir} style={{ border: 0, borderRadius: 10, padding: "11px 16px", background: ACCENT, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{motivo === "tope" ? "Seguir" : "Saltar y seguir"}</button>
        </div>
      </div>
    </div>
  );
}
