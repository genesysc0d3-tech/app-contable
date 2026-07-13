"use client";

// Modal del motor masivo: sale ENCIMA de la pestaña Emitir al apretar "Emitir N".
// Usa useEmisionLote (la cola real). Autorización legal UNA vez (versionada, con
// traza), luego confirmación liviana por tanda. Estados: idle → emitiendo →
// terminada | requiere_revision | detenida (+ pausa por error/tope).

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { chileDateString } from "@/lib/chile-date";
import { recoverLatestFolio, type RecoverLatestResult } from "@/lib/emission/recover-latest";
import { useEmisionLote, type ItemLoteEmision } from "./useEmisionLote";

export interface LoteItemInput {
  id: string;
  descripcion: string;
  receptor_nombre: string | null;
  receptor_rut: string | null;
  receptor_direccion?: string | null;
  receptor_comuna?: string | null;
  receptor_email?: string | null;
  receptor_telefono?: string | null;
  medio_pago?: string | null;
  detalle?: string | null;
  tipo_sugerido: number | null;
  monto_total: number;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
const ACCENT = "#E8553E";

export default function EmitirLoteModal({
  items, empresaId, empresaRut, onClose, onDone,
}: {
  items: LoteItemInput[];
  empresaId: string;
  empresaRut?: string | null;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { progreso, pausa, corriendo, jobIdRevision, iniciar, detener, responderPausa } = useEmisionLote({ empresaId, empresaRut });
  const [modo, setModo] = useState<"idle" | "legal" | "verificando">("idle");
  const [error, setError] = useState<string | null>(null);

  const hoy = useMemo(() => chileDateString(new Date()), []);
  const total = useMemo(() => items.reduce((s, i) => s + i.monto_total, 0), [items]);

  const loteItems: ItemLoteEmision[] = useMemo(() => items.map((i) => {
    const tipoDte: 39 | 41 = i.tipo_sugerido === 39 ? 39 : 41;
    return {
      propuestaId: i.id,
      tipoDte,
      monto: i.monto_total,
      etiqueta: i.receptor_nombre?.trim() || i.descripcion || "Boleta",
      receptorRut: i.receptor_rut,
      receptorNombre: i.receptor_nombre,
      receptorDireccion: i.receptor_direccion,
      receptorComuna: i.receptor_comuna,
      receptorEmail: i.receptor_email,
      receptorTelefono: i.receptor_telefono,
      medioPago: i.medio_pago,
      detalle: i.detalle?.trim() || (tipoDte === 41 ? "Venta exenta" : "Servicio prestado"),
      fechaEmision: hoy,
    };
  }), [items, hoy]);

  // Autorización legal versionada (una vez por proveedor). El server la re-exige.
  async function confirmar() {
    setError(null);
    setModo("verificando");
    try {
      const res = await fetch("/api/emision/authorizations?provider=sii_local");
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok && json?.authorized) { setModo("idle"); void iniciar(loteItems); return; }
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
      setModo("idle"); void iniciar(loteItems);
    } catch {
      setError("Error de red al autorizar."); setModo("legal");
    }
  }

  const fase = progreso?.fase;
  const terminal = fase === "terminada" || fase === "requiere_revision" || fase === "detenida";
  // Cerrar solo cuando no hay una emisión en vuelo (proteger el folio).
  const puedeCerrar = !corriendo || terminal;

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

        {!progreso && (modo === "idle" || modo === "verificando") && <Idle count={items.length} total={total} onConfirmar={confirmar} verificando={modo === "verificando"} error={error} />}
        {!progreso && modo === "legal" && <Legal onAceptar={aceptarLegal} onCancelar={() => setModo("idle")} error={error} />}

        {progreso && (fase === "emitiendo" || fase === "esperando" || fase === "pausada" || fase === "preparando") && (
          <Corriendo p={progreso} onDetener={detener} />
        )}
        {progreso && fase === "terminada" && <Terminada folios={progreso.folios} onCerrar={() => { onClose(); onDone?.(); }} />}
        {progreso && fase === "requiere_revision" && <Revision p={progreso} jobId={jobIdRevision} onCerrar={() => { onClose(); onDone?.(); }} />}
        {progreso && fase === "detenida" && <Detenida p={progreso} onCerrar={() => { onClose(); onDone?.(); }} />}

        {pausa && <Pausa motivo={pausa.motivo} onSeguir={() => responderPausa("continuar")} onDetener={() => responderPausa("detener")} />}
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

function Idle({ count, total, onConfirmar, verificando, error }: { count: number; total: number; onConfirmar: () => void; verificando: boolean; error: string | null }) {
  return (
    <>
      <div style={eyebrow}><span style={dot} />Emitir al SII</div>
      <div style={h1}>{count} {count === 1 ? "boleta lista" : "boletas listas"}</div>
      <div style={{ fontSize: 13.5, color: "var(--text2)", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{fmt(total)} · revisadas y aprobadas por ti</div>
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 16, padding: "11px 12px", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text3)", lineHeight: 1.45 }}>
        <span style={{ marginTop: 1 }}>🔒</span>
        <span>Emites con tu clave del SII: el contenido es <b style={{ color: "var(--text2)" }}>tu responsabilidad</b>. App Contable automatiza el envío — no asesora ni valida montos.</span>
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
        <div><div style={label}>Qué autorizas</div><div style={{ ...body, color: "var(--text)" }}>Autorizo a App Contable a emitir boletas en el SII con mi clave, por mi instrucción (SII local asistido).</div></div>
        <div><div style={label}>Tu responsabilidad</div><div style={body}>Soy el contribuyente emisor y el responsable del contenido de cada boleta. La herramienta automatiza; no asesora ni valida montos.</div></div>
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
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: cur.tipoDte === 41 ? "rgba(34,197,94,.14)" : "rgba(232,85,62,.14)", color: cur.tipoDte === 41 ? "#5fd98a" : "#f0836f" }}>{cur.tipoDte === 41 ? "Exenta" : "Afecta"}</span>
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

function Terminada({ folios, onCerrar }: { folios: number[]; onCerrar: () => void }) {
  const rango = folios.length ? (folios.length === 1 ? `${folios[0]}` : `${folios[0]} – ${folios[folios.length - 1]}`) : "—";
  return (
    <>
      <Badge bg="rgba(34,197,94,.13)">✅</Badge>
      <div style={h1}>Listo</div>
      <div style={{ fontSize: 13.5, color: "var(--text2)", marginTop: 3 }}>{folios.length} {folios.length === 1 ? "boleta emitida" : "boletas emitidas"} y guardadas.</div>
      {folios.length > 0 && chips([{ l: "Folios", v: rango }])}
      <button onClick={onCerrar} style={{ ...ghostBtn, width: "100%", marginTop: 18 }}>Ver en el historial</button>
    </>
  );
}

function Revision({ p, jobId, onCerrar }: { p: import("@/lib/emission/lote-runner").ProgresoLote; jobId: string | null; onCerrar: () => void }) {
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
          {res.folio ? `Folio ${res.folio} ` : "La boleta "}{res.already ? "ya estaba guardada." : "quedó guardada en la app."} Podés emitir el resto desde la pestaña.
        </div>
        <button onClick={onCerrar} style={{ ...primaryBtn }}>Cerrar</button>
      </>
    );
  }

  return (
    <>
      <Badge bg="rgba(245,158,11,.13)">⚠️</Badge>
      <div style={h1}>Frené en la boleta {p.procesadas}</div>
      <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, marginTop: 6 }}>
        Emitiste, pero no pude confirmar el folio. Esta boleta quedó <span style={{ color: "#f6ab3d", fontWeight: 600 }}>bloqueada</span> para que no salga dos veces. Recuperá su folio antes de seguir. <span style={{ color: "#f6ab3d", fontWeight: 600 }}>No la vuelvas a emitir a mano.</span>
      </div>
      {res?.estado === "sin_resultado" && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--text2)", lineHeight: 1.45 }}>
          No encontré un folio para recuperar. Si la ventana del SII <b>no</b> mostró un folio, no se emitió nada. Abrí la ventana del SII para confirmar; la boleta queda en revisión (no la re-emitas hasta estar seguro).
        </div>
      )}
      {res?.estado === "error" && <div style={{ marginTop: 10, fontSize: 12, color: "var(--red,#ef4444)" }}>{res.mensaje}</div>}
      {chips([{ l: "emitidas", v: String(p.emitidas) }, { l: "a medias", v: String(p.revision) }, { l: "faltan", v: String(Math.max(0, faltan)) }])}
      <button onClick={recuperar} disabled={recuperando} style={{ ...primaryBtn, opacity: recuperando ? 0.6 : 1 }}>
        {recuperando ? "Recuperando…" : "Recuperar el folio de esta boleta"}
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

function Pausa({ motivo, onSeguir, onDetener }: { motivo: "error" | "tope"; onSeguir: () => void; onDetener: () => void }) {
  const texto = motivo === "tope"
    ? "Llegaste al tope de esta tanda. ¿Seguís con las próximas?"
    : "Esa boleta no se pudo emitir. ¿Saltás y seguís con las próximas, o detenés?";
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(6,7,10,.82)", borderRadius: 16, display: "grid", placeItems: "center", padding: 22 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{motivo === "tope" ? "Pausa de seguridad" : "Una boleta falló"}</div>
        <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.5, marginBottom: 16, maxWidth: 300 }}>{texto}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={onDetener} style={ghostBtn}>Detener</button>
          <button onClick={onSeguir} style={{ border: 0, borderRadius: 10, padding: "11px 16px", background: ACCENT, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{motivo === "tope" ? "Seguir" : "Saltar y seguir"}</button>
        </div>
      </div>
    </div>
  );
}
