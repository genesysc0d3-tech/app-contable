"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { aprobarPropuesta, editarPropuesta } from "../../revisar/actions";
import { fmt, fmtShort, type Propuesta, type ClienteResumen } from "./revisar-shared";
import EditorAmpliado from "./EditorAmpliado";

const IMG_EXT = ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "bmp", "tiff"];

// Lightbox con zoom FLIP desde la posición del thumbnail (sin re-descargar → sin
// flash negro). Fondo limpio (sin blur ni oscuro); solo el botón "Cerrar" abajo
// es frosted + fade. Click afuera o Esc cierran.
function ComprobanteLightbox({ url, origin, onClose }: { url: string; origin: DOMRect; onClose: () => void }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const img = imgRef.current;
    if (img) {
      const f = img.getBoundingClientRect();
      const dx = origin.left + origin.width / 2 - (f.left + f.width / 2);
      const dy = origin.top + origin.height / 2 - (f.top + f.height / 2);
      const s = Math.max(0.05, origin.width / f.width);
      img.style.transition = "transform .19s cubic-bezier(.4,0,.7,1), opacity .15s ease";
      img.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      img.style.opacity = "0.12";
    }
    setClosing(true);
    window.setTimeout(onClose, 190);
  }, [origin, onClose]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [handleClose]);

  useLayoutEffect(() => {
    const img = imgRef.current; if (!img) return;
    const f = img.getBoundingClientRect();
    if (!f.width || !f.height) return;
    const dx = origin.left + origin.width / 2 - (f.left + f.width / 2);
    const dy = origin.top + origin.height / 2 - (f.top + f.height / 2);
    const s = Math.max(0.05, origin.width / f.width);
    img.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    img.style.opacity = "0.55";
    void img.offsetWidth;
    img.style.transition = "transform .34s cubic-bezier(.22,1,.36,1), opacity .24s ease";
    img.style.transform = "translate(0,0) scale(1)";
    img.style.opacity = "1";
  }, [origin]);

  return createPortal(
    <div onClick={handleClose} style={{ position: "fixed", inset: 0, zIndex: 120, display: "grid", placeItems: "center", padding: 28, background: "transparent" }}>
      <style>{`@keyframes lbCerrar{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}`}</style>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} onClick={(e) => e.stopPropagation()} src={url} alt="comprobante"
        style={{ maxWidth: "74vw", maxHeight: "78vh", borderRadius: 16, objectFit: "contain", boxShadow: "0 30px 90px rgba(0,0,0,.5)", display: "block", willChange: "transform" }} />
      <button onClick={handleClose}
        style={{ position: "fixed", bottom: 30, left: "50%", zIndex: 3, display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 22px", borderRadius: 999, border: "1px solid color-mix(in srgb, var(--text) 16%, transparent)", background: "color-mix(in srgb, var(--bg) 40%, transparent)", color: "var(--text)", fontSize: 12, fontWeight: 600, cursor: "pointer", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", boxShadow: "0 10px 34px rgba(0,0,0,.3)", ...(closing ? { animation: "none", opacity: 0, transition: "opacity .2s ease", pointerEvents: "none" } : { animation: "lbCerrar .32s ease .06s both" }) }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 6 6 18M6 6l12 12" /></svg>Cerrar
      </button>
    </div>,
    document.body,
  );
}

// Thumbnail del comprobante (banda izquierda). Click = lightbox con zoom desde
// el thumbnail (usa la imagen ya cargada). Si es texto/no-imagen, cae al visor.
function ComprobanteThumb({ documentoId, onZoom }: { documentoId: string; onZoom: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "image" | "none">("loading");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [origin, setOrigin] = useState<DOMRect | null>(null);
  const [multi, setMulti] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: doc } = await supabase.from("documentos_subidos").select("storage_path, nombre_archivo, album_imagenes").eq("id", documentoId).single();
        const path = doc?.storage_path;
        if (!path) { if (!cancelled) setState("none"); return; }
        const ext = (doc?.nombre_archivo ?? path).split(".").pop()?.toLowerCase() ?? "";
        if (!IMG_EXT.includes(ext)) { if (!cancelled) setState("none"); return; }
        // Bytes vía la ruta de servido (provider-aware).
        if (!cancelled) {
          setMulti(Array.isArray(doc?.album_imagenes) && doc.album_imagenes.length > 1);
          setUrl(`/api/archivo/${documentoId}`);
          setState("image");
        }
      } catch { if (!cancelled) setState("none"); }
    })();
    return () => { cancelled = true; };
  }, [documentoId]);

  const open = () => {
    // Álbum (varias fotos) → visor con galería completa (zoom + flechas). Foto suelta →
    // lightbox inline con el zoom FLIP desde el thumbnail.
    if (state === "image" && multi) { onZoom(); return; }
    if (state === "image" && url && btnRef.current) setOrigin(btnRef.current.getBoundingClientRect());
    else onZoom();
  };

  return (
    <>
      <button ref={btnRef} onClick={open} title="Ampliar comprobante"
        style={{ position: "relative", width: "clamp(80px, 11vh, 124px)", flexShrink: 0, alignSelf: "stretch", minHeight: "8em", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-muted)", overflow: "hidden", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{`@keyframes vcPulse{0%,100%{opacity:.35}50%{opacity:.9}}`}</style>
        {state === "image" && url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={url} alt="comprobante" style={{ width: "100%", height: "100%", objectFit: "contain", opacity: .92, display: "block" }} />
        ) : state === "loading" ? (
          <div style={{ width: "55%", height: "0.8em", borderRadius: 6, background: "color-mix(in srgb, var(--text) 8%, transparent)", animation: "vcPulse 1.2s ease infinite" }} />
        ) : (
          <div style={{ textAlign: "center", color: "var(--text3)", fontSize: "0.8em", lineHeight: 1.4, padding: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ margin: "0 auto 4px", opacity: .6 }}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 15l5-5 4 4 3-3 6 6" /></svg>
            comprobante<br />de texto
          </div>
        )}
        {state === "image" && (
          <span style={{ position: "absolute", right: 5, bottom: 5, fontSize: "0.66em", fontWeight: 700, color: "#fff", background: "rgba(0,0,0,.55)", borderRadius: 5, padding: "2px 5px", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>ampliar
          </span>
        )}
      </button>
      {origin && url && <ComprobanteLightbox url={url} origin={origin} onClose={() => setOrigin(null)} />}
    </>
  );
}

const divider = { borderTop: "1px solid var(--border)", margin: "0.7em 0" } as const;

// Botón con efecto de PRESIÓN (relieve en reposo → hundido al apretar), adaptado a
// nuestros colores. Estilos inline no soportan :active, así que va por clase.
const CB_CSS = `
.vc-cb{cursor:pointer;border-radius:11px;font-weight:700;width:100%;padding:1.05em 1em;display:flex;align-items:center;justify-content:center;gap:9px;line-height:1.4;transition:box-shadow .18s,filter .15s,transform .1s;box-shadow:5px 5px 12px rgba(0,0,0,.45),-4px -4px 10px rgba(255,255,255,.025);}
.vc-cb svg{width:1.05em;height:1.05em;flex-shrink:0;}
.vc-cb:hover:not(:disabled){filter:brightness(1.07);}
.vc-cb:active:not(:disabled){box-shadow:inset 4px 4px 11px rgba(0,0,0,.5),inset -3px -3px 9px rgba(255,255,255,.04);filter:brightness(.92);transform:translateY(1px);}
.vc-cb:disabled{opacity:.5;cursor:default;}
.vc-pencil{transition:background .15s,color .15s,border-color .15s;}
.vc-pencil:hover:not(:disabled){background:var(--surface);color:var(--text);border-color:var(--text3);}
.vc-pencil:disabled{opacity:.5;cursor:default;}
`;

function CreativeButton({ label, baseIcon, onClick, disabled, bg, color, border, fontSize }: {
  label: string; baseIcon?: ReactNode; onClick: () => void; disabled?: boolean;
  bg: string; color: string; border?: string; dotBg?: string; fontSize?: string;
}) {
  return (
    <button className="vc-cb" onClick={onClick} disabled={disabled}
      style={{ background: bg, color, border: border ?? "none", fontSize: fontSize ?? "1.12em" }}>
      {baseIcon}{label}
    </button>
  );
}

// Visor de 1 transacción como VEREDICTO editable (3 columnas: comprobante · datos ·
// acciones). El tipo afecta/exenta y el monto son ediciones LOCALES instantáneas
// (cero servidor, cero recarga); se persisten una sola vez al Aprobar/Registrar.
export default function VeredictoCard({ propuesta, clientes, empresaId: _empresaId, empresaTipo, onAction, onClose, documentoId, onViewImage, onEliminar, eliminarArmado = false }: {
  propuesta: Propuesta; clientes: ClienteResumen[]; empresaId: string; empresaTipo: string | null;
  onAction: () => void; onClose: () => void; documentoId: string; onViewImage: () => void;
  /** Eliminar el documento completo de la mesa (solo sin boletas emitidas; dos pasos, estado en el padre). */
  onEliminar?: () => void; eliminarArmado?: boolean;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [selClienteId, setSelClienteId] = useState(propuesta.cliente_id ?? "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorOrigin, setEditorOrigin] = useState<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [ov, setOv] = useState<{ tipo: string; neto: number; iva: number; total: number } | null>(null);

  // Una "boleta"/"factura" con IVA 0 es, de hecho, EXENTA: la mostramos como exenta por
  // defecto en vez de bloquear pidiendo "elige el tipo" (eso hacía DESAPARECER el botón
  // Aprobar al (re)seleccionar el doc). El usuario puede cambiar a afecta si corresponde.
  const tipoBase = propuesta.tipo_propuesto;
  const defaultTipo = (tipoBase === "boleta" || tipoBase === "factura") && Number(propuesta.iva ?? 0) === 0 ? "exenta" : tipoBase;
  const tipo = ov?.tipo ?? defaultTipo;
  const isAfecta = tipo === "boleta" || tipo === "factura" || tipo === "factura_afecta";
  const noBoletea = tipo === "gasto_egreso" || tipo === "no_comercial";
  const neto = ov?.neto ?? propuesta.monto_neto ?? Math.round((propuesta.total ?? 0) / 1.19);
  const iva = ov?.iva ?? propuesta.iva ?? Math.round(neto * 0.19);
  const total = ov?.total ?? propuesta.total ?? neto + iva;
  const conflicto = isAfecta && Number(iva) === 0; // afecta sin IVA = el SII lo rechaza
  const pct = Math.round((propuesta.confianza ?? 0) * 100);
  const fecha = fmtShort(propuesta.movimientos_raw.fecha);

  const camposPara = (t: "boleta" | "exenta", monto: number) =>
    t === "exenta" ? { tipo_propuesto: "exenta", monto_neto: monto, iva: 0, total: monto }
      : { tipo_propuesto: "boleta", monto_neto: Math.round(monto / 1.19), iva: monto - Math.round(monto / 1.19), total: monto };

  const setTipo = (t: "boleta" | "exenta") => { const c = camposPara(t, total); setOv({ tipo: c.tipo_propuesto, neto: c.monto_neto, iva: c.iva, total: c.total }); };
  // "No es venta" manual eliminado (decisión founder 2026-07-03): un comprobante
  // que no es venta ahora se ELIMINA de la mesa; el estado no-venta clasificado
  // por la IA se mantiene (con su salida "Es venta").
  const openEditor = () => { if (rootRef.current) setEditorOrigin(rootRef.current.getBoundingClientRect()); setEditorOpen(true); };

  // tipoDte: la decisión humana del tipo (Paso P) — se guarda al aprobar para
  // que la cola de Emitir la lea en vez de re-adivinarla.
  const commit = async (action: () => Promise<unknown>, okMsg: string, tipoDte?: 39 | 41 | null) => {
    setBusy(true);
    try {
      if (ov || tipoDte !== undefined) {
        const e = (await editarPropuesta(propuesta.id, {
          ...(ov ? { tipo_propuesto: ov.tipo, monto_neto: ov.neto, iva: ov.iva, total: ov.total } : {}),
          ...(tipoDte !== undefined ? { tipo_dte: tipoDte } : {}),
        })) as { error?: string } | undefined;
        // Si el guardado del tipo/override falla, NO aprobar con los datos viejos.
        if (e?.error) { toast(e.error, "error"); return; }
      }
      const r = (await action()) as { error?: string } | undefined;
      if (r && r.error) toast(r.error, "error"); else toast(okMsg);
      onAction();
    } catch {
      // Un throw de la server action dejaba el botón busy para siempre (sin finally).
      toast("Error de conexión — intenta de nuevo", "error");
    } finally {
      setBusy(false);
    }
  };
  const aprobar = () => commit(() => aprobarPropuesta(propuesta.id, selClienteId || null), "Aprobada", isAfecta ? 39 : 41);
  const registrar = () => commit(() => aprobarPropuesta(propuesta.id, null), "Registrada", null);

  // Baja confianza = gris (mismo criterio que las listas de revisar/CartolaEditor):
  // rojo implicaba error; "falta información" no es un error.
  const dotColor = conflicto ? "var(--amber)" : pct >= 85 ? "var(--green)" : pct >= 50 ? "var(--amber)" : "var(--text2)";

  return (
    <div ref={rootRef} style={{ display: "flex", gap: "1.4em", alignItems: "stretch", padding: "0.85em 18px", fontSize: "clamp(9px, 1.3vh, 12.5px)", height: "100%" }}>
      <style>{CB_CSS}</style>
      {editorOpen && (
        <EditorAmpliado
          propuesta={propuesta}
          documentoId={documentoId}
          empresaTipo={empresaTipo}
          originRect={editorOrigin}
          onClose={(saved) => { setEditorOpen(false); if (saved) onAction(); }}
        />
      )}
      {/* IZQUIERDA: comprobante (ocupa toda la altura de la tarjeta) */}
      <ComprobanteThumb documentoId={documentoId} onZoom={onViewImage} />

      {/* PRINCIPAL: header arriba + cuerpo (centro · acciones) debajo */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0, marginBottom: "0.5em" }}>
          <span style={{ fontSize: "1.5em", fontWeight: 600, color: "var(--text2)", letterSpacing: "-.02em", lineHeight: 1 }}>{noBoletea ? "Movimiento" : "Boleta propuesta"}</span>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.98em", fontWeight: 800, color: dotColor }}>
            <span style={{ width: "0.55em", height: "0.55em", borderRadius: "50%", background: dotColor }} />{pct}%
          </span>
          <button onClick={onClose} title="Cerrar" style={{ width: "2.15em", height: "2.15em", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* CUERPO: centro · acciones */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: "1.5em" }}>
          {noBoletea ? (
            <>
              {/* CENTRO: no-venta */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 6, fontSize: "0.82em", fontWeight: 800, letterSpacing: ".03em", padding: "0.34em 0.8em", borderRadius: 8, background: "var(--bg-muted)", color: "var(--text2)", marginBottom: "0.55em" }}>
                  <span style={{ width: "0.62em", height: "0.62em", borderRadius: 2, border: "1.5px solid var(--text3)" }} />NO SE EMITE BOLETA
                </div>
                <div style={{ fontSize: "3em", fontWeight: 800, color: "var(--text2)", letterSpacing: "-.04em", lineHeight: 1 }}>{fmt(total)}</div>
                <div style={{ fontSize: "0.92em", color: "var(--text2)", lineHeight: 1.5, marginTop: "0.5em" }}>{propuesta.notas?.trim() || "Plata propia / movimiento que no es una venta a un tercero — no hay hecho gravado (Art. 2 DL 825)."}</div>
                <div style={divider} />
                <div style={{ fontSize: "0.95em", color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={propuesta.movimientos_raw.descripcion}>{propuesta.movimientos_raw.descripcion}</div>
              </div>
              {/* ACCIONES: no-venta */}
              <div style={{ width: "clamp(160px, 30%, 285px)", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.1em", borderLeft: "1px solid var(--border)", paddingLeft: "1.4em" }}>
                <CreativeButton label="Es venta" onClick={() => setTipo("boleta")} disabled={busy}
                  bg="var(--bg-muted)" color="var(--text)"
                  baseIcon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>} />
                <CreativeButton label="Registrar" onClick={registrar} disabled={busy}
                  bg="var(--accent)" color="#fff" />
                {onEliminar && (
                  <CreativeButton label={eliminarArmado ? "¿Seguro? Eliminar" : "Eliminar"} onClick={onEliminar} disabled={busy}
                    bg={eliminarArmado ? "color-mix(in srgb, var(--red) 18%, transparent)" : "color-mix(in srgb, var(--red) 9%, transparent)"} color="var(--red)"
                    baseIcon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>} />
                )}
              </div>
            </>
          ) : (
            <>
              {/* CENTRO: afecta/exenta */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: "0.7em" }}>
                  <div style={{ display: "flex", width: "fit-content", borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
                    {([["exenta", "Exenta · sin IVA · 41", "var(--blue)"], ["boleta", "Afecta · con IVA · 39", "var(--green)"]] as const).map(([k, lbl, c]) => {
                      const active = k === "boleta" ? isAfecta : !isAfecta;
                      return (
                        <button key={k} onClick={() => { if (!active || conflicto) setTipo(k); }} disabled={busy}
                          style={{ fontSize: "0.9em", fontWeight: 700, padding: "0.55em 1.15em", border: "none", cursor: (active && !conflicto) ? "default" : "pointer", background: active ? `color-mix(in srgb, ${c} 25%, transparent)` : "transparent", color: active ? c : "var(--text3)", transition: "all .12s" }}>{lbl}</button>
                      );
                    })}
                  </div>
                  {isAfecta && <span style={{ flexShrink: 0, color: "var(--text2)", fontSize: "1.18em" }}>neto {fmt(neto)} · IVA {fmt(iva)} <span style={{ color: "var(--text3)" }}>(19%)</span></span>}
                </div>
                {conflicto && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.82em", color: "var(--amber)", fontWeight: 600, marginBottom: "0.4em" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M12 9v4m0 4h.01M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0Z" /></svg>
                    Afecta lleva IVA 19%. Si no corresponde, marca <b style={{ margin: "0 3px" }}>Exenta</b>.
                  </div>
                )}
                {/* Lápiz = ampliar con superpoderes (editor full-screen). Altura fija evita saltos. */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5em", height: "3.3em" }}>
                  <button className="vc-pencil" onClick={openEditor} disabled={busy} title="Ampliar y editar"
                    style={{ flexShrink: 0, width: "2.4em", height: "2.4em", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>
                  <span style={{ fontSize: "3em", fontWeight: 800, color: "var(--text)", letterSpacing: "-.04em", lineHeight: 1 }}>{fmt(total)}</span>
                </div>
                <div style={divider} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, fontSize: "1.24em" }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)" }} title={propuesta.movimientos_raw.descripcion}>{propuesta.movimientos_raw.descripcion}</span>
                </div>
                <div style={divider} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1.22em", color: "var(--text2)" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0, color: "var(--text3)" }}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
                  <select value={selClienteId} onChange={(e) => setSelClienteId(e.target.value)}
                    style={{ background: "transparent", border: "none", color: selClienteId ? "var(--text)" : "var(--text2)", fontSize: "1em", fontWeight: 600, cursor: "pointer", padding: 0, maxWidth: "12em" }}>
                    <option value="">Consumidor final</option>
                    {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                  <span style={{ color: "var(--text3)" }}>·</span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ flexShrink: 0, color: "var(--text3)" }}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                  <span>{fecha}</span>
                </div>
              </div>

              {/* ACCIONES: afecta/exenta */}
              <div style={{ width: "clamp(160px, 30%, 285px)", flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.1em", borderLeft: "1px solid var(--border)", paddingLeft: "1.4em" }}>
                {onEliminar && (
                  <CreativeButton label={eliminarArmado ? "¿Seguro? Eliminar" : "Eliminar"} onClick={onEliminar} disabled={busy}
                    bg={eliminarArmado ? "color-mix(in srgb, var(--red) 18%, transparent)" : "color-mix(in srgb, var(--red) 9%, transparent)"} color="var(--red)"
                    baseIcon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>} />
                )}
                {conflicto ? (
                  <div style={{ fontSize: "0.85em", color: "var(--text3)", fontWeight: 600, textAlign: "center", lineHeight: 1.4 }}>Elige el tipo arriba para aprobar</div>
                ) : (
                  <CreativeButton label="Aprobar" onClick={aprobar} disabled={busy}
                    bg="var(--accent)" color="#fff"
                    baseIcon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
