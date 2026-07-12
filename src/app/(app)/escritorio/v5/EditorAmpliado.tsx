"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/Toast";
import { editarPropuesta } from "../../revisar/actions";
import { validarRut, RECEPTOR_OBLIGATORIO_DESDE } from "@/lib/sii/validation";
import { esTipoPropuestoExento } from "@/lib/sii/tipos-propuesta";
import { fmt, type Propuesta } from "./revisar-shared";
import GaleriaComprobante from "./GaleriaComprobante";

const IMG_EXT = ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "bmp", "tiff"];
const PAGOS = ["Efectivo", "Transferencia electrónica", "Débito", "Crédito", "Otro"];

// Editor "ampliar con superpoderes": el lápiz del visor expande la tarjeta a un
// modal grande centrado (FLIP desde su rect, NO pantalla completa). Comprobante
// en zoom a la izquierda + TODOS los campos editables a la derecha (tipo, monto,
// receptor y forma de pago, todos visibles de una). Guarda en la propuesta
// (editarPropuesta) y vuelve al visor; NO emite (eso es en el visor).
export default function EditorAmpliado({ propuesta, documentoId, empresaTipo, originRect, onClose }: {
  propuesta: Propuesta;
  documentoId: string;
  empresaTipo: string | null;
  originRect: DOMRect | null;
  onClose: (saved: boolean) => void;
}) {
  const { toast } = useToast();
  const extra = propuesta as unknown as { receptor_direccion?: string | null; receptor_comuna?: string | null; medio_pago?: string | null };

  // Tipo: lo decide PRIMERO la clasificación de la propuesta (tipo_dte persistido →
  // tipo_propuesto) y SOLO como desempate la sugerencia de la empresa. Un default de
  // empresa 'afecto' NUNCA puede pisar una exención POR LEY (cripto/forex/P2P,
  // Of. SII 963/2018): eso fabricaría IVA inexistente sobre una venta exenta.
  // Misma derivación que ExpandedDetail (revisar-shared). Siempre editable (sin lock).
  const AFECTOS_POR_TIPO = ["boleta", "factura", "factura_afecta"];
  const tipoInicial: "afecta" | "exenta" =
    propuesta.tipo_dte === 41 ? "exenta"
      : propuesta.tipo_dte === 39 ? "afecta"
        : esTipoPropuestoExento(propuesta.tipo_propuesto) ? "exenta"
          : AFECTOS_POR_TIPO.includes(propuesta.tipo_propuesto) ? "afecta"
            : empresaTipo === "exento" ? "exenta"
              : empresaTipo === "afecto" ? "afecta"
                : "exenta"; // default seguro: nunca fabricar IVA sobre algo sin clasificar
  const [tipo, setTipo] = useState<"afecta" | "exenta">(tipoInicial);
  const [total, setTotal] = useState<number>(Math.round(propuesta.total ?? propuesta.movimientos_raw?.monto ?? 0));
  // Detalle = SOLO lo editado por el humano (notas), sin fallback a la glosa bancaria:
  // si se prellenara y se guardara sin tocar, notas pisaría la glosa común de la cartola.
  const [detalle, setDetalle] = useState<string>(propuesta.notas?.trim() ?? "");
  const [rut, setRut] = useState<string>(propuesta.receptor_rut ?? "");
  const [razon, setRazon] = useState<string>(propuesta.receptor_nombre ?? "");
  const [direccion, setDireccion] = useState<string>(extra.receptor_direccion ?? "");
  const [comuna, setComuna] = useState<string>(extra.receptor_comuna ?? "");
  const [medioPago, setMedioPago] = useState<string>(extra.medio_pago ?? "");
  const [busy, setBusy] = useState(false);

  const isAfecta = tipo === "afecta";
  const neto = isAfecta ? Math.round(total / 1.19) : total;
  const iva = isAfecta ? total - neto : 0;
  const conflicto = isAfecta && total > 0 && iva === 0; // afecta sin IVA: el SII la rechaza
  const requiereReceptor = total > RECEPTOR_OBLIGATORIO_DESDE;
  const rutTrim = rut.trim();
  const rutValido = !rutTrim || validarRut(rutTrim);
  const receptorOk = !requiereReceptor || (!!rutTrim && validarRut(rutTrim) && !!razon.trim());
  // Detalle OPCIONAL (igual que el flujo masivo): vacío → genérico limpio (resolverGlosa).
  const bloqueado = total <= 0 || conflicto || !rutValido || !receptorOk;

  // ── Imagen(es) del comprobante ── foto suelta o álbum de Telegram. El zoom/pan
  // y las flechas viven en GaleriaComprobante (un solo lugar para visor y editor).
  const [imgs, setImgs] = useState<string[]>([]);
  const [imgState, setImgState] = useState<"loading" | "image" | "none">("loading");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: doc } = await supabase.from("documentos_subidos").select("storage_path, nombre_archivo, album_imagenes").eq("id", documentoId).single();
        const path = doc?.storage_path;
        const album = Array.isArray(doc?.album_imagenes) ? (doc.album_imagenes as unknown[]) : null;
        const ext = (doc?.nombre_archivo ?? path ?? "").split(".").pop()?.toLowerCase() ?? "";
        // Bytes vía la ruta de servido (provider-aware: Supabase hoy, R2 cuando migre).
        if (album && album.length) {
          if (!cancelled) { setImgs(album.map((_, i) => `/api/archivo/${documentoId}?i=${i}`)); setImgState("image"); }
        } else if (path && IMG_EXT.includes(ext)) {
          if (!cancelled) { setImgs([`/api/archivo/${documentoId}`]); setImgState("image"); }
        } else if (!cancelled) {
          setImgState("none");
        }
      } catch { if (!cancelled) setImgState("none"); }
    })();
    return () => { cancelled = true; };
  }, [documentoId]);

  // ── FLIP: expandir desde el rect del visor hasta un modal grande centrado ──
  // (no pantalla completa: deja respiro alrededor, tope ~1180×820).
  const boxRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const centrado = () => {
    if (typeof window === "undefined") return "6vh 6vw 6vh 6vw";
    const w = Math.min(1180, window.innerWidth * 0.92);
    const h = Math.min(820, window.innerHeight * 0.9);
    const x = Math.round((window.innerWidth - w) / 2);
    const y = Math.round((window.innerHeight - h) / 2);
    return `${y}px ${x}px ${y}px ${x}px`;
  };
  const insetFrom = originRect
    ? `${originRect.top}px ${window.innerWidth - originRect.right}px ${window.innerHeight - originRect.bottom}px ${originRect.left}px`
    : centrado();
  const insetTo = centrado();
  useLayoutEffect(() => {
    const el = boxRef.current; if (!el) return;
    el.style.inset = insetFrom; el.style.opacity = "0.6";
    void el.offsetWidth;
    el.style.transition = "inset .36s cubic-bezier(.22,1,.36,1), opacity .2s ease";
    el.style.inset = insetTo; el.style.opacity = "1";
  }, [insetFrom, insetTo]);

  const cerrar = useCallback((saved: boolean) => {
    if (closingRef.current) return; closingRef.current = true;
    const el = boxRef.current;
    if (el) {
      el.style.transition = "inset .22s cubic-bezier(.4,0,.7,1), opacity .2s ease";
      el.style.inset = insetFrom; el.style.opacity = "0";
    }
    window.setTimeout(() => onClose(saved), 200);
  }, [insetFrom, onClose]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(false); };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [cerrar]);

  const guardar = async () => {
    if (bloqueado || busy) return;
    setBusy(true);
    const r = await editarPropuesta(propuesta.id, {
      tipo_propuesto: isAfecta ? "boleta" : "exenta",
      tipo_dte: isAfecta ? 39 : 41,
      total: Math.round(total),
      monto_neto: neto,
      iva,
      receptor_rut: rutTrim || null,
      receptor_nombre: razon.trim() || null,
      receptor_direccion: direccion.trim() || null,
      receptor_comuna: comuna.trim() || null,
      medio_pago: medioPago || null,
      notas: detalle.trim() || null,
    }) as { error?: string } | undefined;
    setBusy(false);
    if (r && r.error) { toast(r.error, "error"); return; }
    toast("Guardado");
    cerrar(true);
  };

  const label = { fontSize: 10, fontWeight: 700, color: "var(--text3)", letterSpacing: ".05em", textTransform: "uppercase" as const, marginBottom: 4, display: "block" };
  const field = { width: "100%", fontSize: 13, padding: "8px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text)", outline: "none" } as const;

  return createPortal(
    <div onClick={() => cerrar(false)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,.45)" }}>
      <div ref={boxRef} data-editor-ampliado onClick={(e) => e.stopPropagation()}
        style={{ position: "fixed", inset: insetTo, borderRadius: 16, background: "var(--bg)", overflow: "hidden", display: "flex", flexDirection: "column", border: "1px solid var(--border)", boxShadow: "0 40px 120px rgba(0,0,0,.55)", willChange: "inset" }}>
        {/* HEADER */}
        <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "0 16px", borderBottom: "1px solid var(--border)" }}>
          <button onClick={() => cerrar(false)} title="Volver" style={{ width: 34, height: 34, borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-muted)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Editar · {razon.trim() || "movimiento"} · <b style={{ color: "var(--text)" }}>{fmt(total)}</b>
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10, flexShrink: 0 }}>
            <button onClick={() => cerrar(false)} style={{ fontSize: 13, fontWeight: 600, color: "var(--text3)", background: "transparent", border: "none", cursor: "pointer", padding: "7px 12px" }}>Cancelar</button>
            <button onClick={guardar} disabled={bloqueado || busy}
              style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: "var(--accent)", border: "none", borderRadius: 9, padding: "7px 20px", cursor: bloqueado || busy ? "default" : "pointer", opacity: bloqueado || busy ? 0.45 : 1 }}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </div>

        {/* BODY */}
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* IZQUIERDA — comprobante en zoom */}
          <div style={{ flex: "1.25 1 0", minWidth: 0, background: "var(--bg-muted)", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {imgState === "image" && imgs.length ? (
              <GaleriaComprobante images={imgs} alt="comprobante" />
            ) : (
              <div style={{ color: "var(--text3)", fontSize: 12, textAlign: "center", padding: 24 }}>
                {imgState === "loading" ? "Cargando comprobante…" : "Sin imagen de comprobante"}
              </div>
            )}
          </div>

          {/* DERECHA — campos */}
          <div style={{ width: "clamp(380px, 42%, 520px)", flexShrink: 0, borderLeft: "1px solid var(--border)", overflowY: "auto", padding: "22px 26px", display: "flex", flexDirection: "column", gap: 18, scrollbarWidth: "thin" }}>
            {/* Tipo (editable — sin lock) */}
            <div>
              <div style={{ display: "flex", width: "fit-content", borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
                {([["exenta", "Exenta · sin IVA · 41", "var(--blue)"], ["afecta", "Afecta · con IVA · 39", "var(--accent)"]] as const).map(([k, lbl, c]) => {
                  const active = tipo === k;
                  return (
                    <button key={k} onClick={() => setTipo(k)}
                      style={{ fontSize: 12, fontWeight: 700, padding: "7px 14px", border: "none", cursor: active ? "default" : "pointer", background: active ? `color-mix(in srgb, ${c} 20%, transparent)` : "transparent", color: active ? c : "var(--text3)", transition: "all .12s" }}>{lbl}</button>
                  );
                })}
              </div>
            </div>

            {/* Detalle + monto */}
            <div>
              <label style={label}>Detalle (opcional)</label>
              <textarea value={detalle} onChange={(e) => setDetalle(e.target.value.slice(0, 80))} rows={2} maxLength={80}
                placeholder="Qué se vendió o prestó (se imprime en la boleta)"
                style={{ ...field, resize: "none", lineHeight: 1.5 }} />
              <div style={{ fontSize: 10, color: detalle.length >= 80 ? "var(--red)" : "var(--text3)", marginTop: 3, textAlign: "right" }}>{detalle.length}/80</div>
              <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", letterSpacing: "-.03em" }}>$</span>
                <input type="number" value={total} onChange={(e) => setTotal(Math.round(Number(e.target.value) || 0))}
                  style={{ flex: 1, fontSize: 26, fontWeight: 800, letterSpacing: "-.03em", border: "1px solid var(--border)", borderRadius: 10, padding: "4px 10px", background: "var(--bg-muted)", color: "var(--text)", outline: "none", caretColor: "var(--accent)" }} />
              </div>
              {isAfecta && !conflicto && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 5 }}>neto {fmt(neto)} · IVA {fmt(iva)} (19%)</div>}
              {conflicto && <div style={{ fontSize: 11, color: "var(--amber)", fontWeight: 600, marginTop: 5 }}>⚠ Afecta lleva IVA — con $0 el SII la rechaza. Sube el monto o emítela exenta.</div>}
              {total <= 0 && <div style={{ fontSize: 11, color: "var(--amber)", fontWeight: 600, marginTop: 5 }}>⚠ El monto debe ser mayor a $0.</div>}
            </div>

            {/* Receptor (siempre visible) */}
            <div>
              <label style={label}>Receptor{requiereReceptor && <span style={{ color: "var(--amber)" }}> · obligatorio</span>}</label>
              {requiereReceptor && (
                <div style={{ fontSize: 11, color: "var(--amber)", fontWeight: 600, marginBottom: 8 }}>⚠ Sobre 135 UF — RUT y nombre obligatorios (Res. 44/2025)</div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 8 }}>
                <div>
                  <input value={rut} onChange={(e) => setRut(e.target.value)} placeholder="RUT"
                    style={{ ...field, borderColor: !rutValido ? "var(--red)" : requiereReceptor && !rutTrim ? "var(--amber)" : "var(--border)" }} />
                  {!rutValido && <div style={{ fontSize: 10, color: "var(--red)", marginTop: 3 }}>RUT no válido</div>}
                </div>
                <input value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Razón social / nombre" style={field} />
                <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección (opcional)" style={field} />
                <input value={comuna} onChange={(e) => setComuna(e.target.value)} placeholder="Comuna (opcional)" style={field} />
              </div>
            </div>

            {/* Forma de pago (siempre visible) */}
            <div>
              <label style={label}>Forma de pago</label>
              <select value={medioPago} onChange={(e) => setMedioPago(e.target.value)} style={{ ...field, cursor: "pointer" }}>
                <option value="">Medio de pago…</option>
                {PAGOS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
