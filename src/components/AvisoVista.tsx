"use client";

// Presentación de un aviso (toast / tarjeta / popup urgente). La usa <AvisosApp>
// en la app y la vista previa de /dev → Avisos (vistaPrevia: sin posición fija).
//
// Diseño NATIVO de massDTE (fundador 2026-10-01: "parece card de IA"), copiando lo
// que ya existe:
//  - toast  = el de src/components/Toast.tsx (abajo al centro, rounded-xl, blanco /
//             #1c1c1e, ícono Phosphor 18 px + texto 14 px medium);
//  - tarjeta = el panel de la columna izquierda (var(--surface), borde 1 px, radio 16,
//             cuadrito de ícono con tinte del acento) y "Entendido" como link discreto
//             (estilo "Eliminar cartola" del visor);
//  - popup  = el modal "Revisa las columnas" (FieldMapper: mismo velo, radio 20) con
//             Warning en rojo y UN botón como el CTA "Revisar columnas" (radio 11).
// Claro/oscuro con las variables del tema (V5Root/globals) y respaldo por si no están.
//
// Overlays según el inventario de la actualización invisible: el popup urgente es
// modal marcado (bloquea la recarga); toast y tarjeta se declaran libres.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Info, Sparkle, Warning, Wrench, X } from "@phosphor-icons/react";
import { formatoEfectivo, partesMarkdown, TOAST_MS, type AvisoApp } from "@/lib/avisos/reglas";

function Cuerpo({ texto, className = "av-cuerpo" }: { texto: string; className?: string }): ReactNode {
  if (!texto) return null;
  return (
    <p className={className}>
      {partesMarkdown(texto).map((p, i) => {
        if (p.t === "negrita") return <strong key={i}>{p.v}</strong>;
        if (p.t === "link") {
          const externo = /^https?:/i.test(p.href);
          return <a key={i} href={p.href} {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{p.v}</a>;
        }
        return <span key={i}>{p.v}</span>;
      })}
    </p>
  );
}

function Icono({ aviso, size }: { aviso: AvisoApp; size: number }) {
  if (aviso.tipo === "urgente") return <Warning size={size} weight="fill" />;
  if (aviso.tipo === "mantencion") return <Wrench size={size} weight="fill" />;
  return aviso.version_min ? <Sparkle size={size} weight="fill" /> : <Info size={size} weight="fill" />;
}

/**
 * Un aviso en pantalla. `vistaPrevia` lo pinta dentro de la caja de /dev (sin
 * posición fija, sin velo, sin cerrarse solo).
 */
export function AvisoVista({ aviso, onCerrar, vistaPrevia = false }: { aviso: AvisoApp; onCerrar: () => void; vistaPrevia?: boolean }) {
  const formato = formatoEfectivo(aviso);
  return (
    <div className={vistaPrevia ? "av-root av-previa" : "av-root"}>
      <style>{CSS}</style>
      {formato === "toast" ? <AvisoToast aviso={aviso} onCerrar={onCerrar} autoCerrar={!vistaPrevia} /> : null}
      {formato === "tarjeta" ? <AvisoTarjeta aviso={aviso} onCerrar={onCerrar} /> : null}
      {formato === "popup" ? (vistaPrevia ? <PopupCard aviso={aviso} onCerrar={onCerrar} /> : <AvisoPopup aviso={aviso} onCerrar={onCerrar} />) : null}
    </div>
  );
}

function AvisoToast({ aviso, onCerrar, autoCerrar }: { aviso: AvisoApp; onCerrar: () => void; autoCerrar: boolean }) {
  const [pausado, setPausado] = useState(false);
  const cerrarRef = useRef(onCerrar);
  useEffect(() => { cerrarRef.current = onCerrar; });
  useEffect(() => {
    if (!autoCerrar || pausado) return;
    const t = setTimeout(() => cerrarRef.current(), TOAST_MS);
    return () => clearTimeout(t);
  }, [autoCerrar, pausado, aviso.id]);
  return (
    // actualizacion-libre: aviso efímero que no guarda nada; si la pestaña recarga sin cerrarlo, vuelve a salir
    <div
      className="av-toast"
      data-tipo={aviso.tipo}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <span className="av-toast-ico" aria-hidden="true"><Icono aviso={aviso} size={18} /></span>
      <div className="av-toast-texto">
        <span className="av-toast-titulo">{aviso.titulo}</span>
        <Cuerpo texto={aviso.cuerpo} className="av-toast-cuerpo" />
      </div>
      <button type="button" className="av-x" aria-label="Cerrar aviso" onClick={onCerrar}><X size={12} weight="bold" /></button>
    </div>
  );
}

function AvisoTarjeta({ aviso, onCerrar }: { aviso: AvisoApp; onCerrar: () => void }) {
  return (
    // actualizacion-libre: tarjeta informativa sin formulario; si la pestaña recarga sin cerrarla, vuelve a salir
    <section className="av-tarjeta" data-tipo={aviso.tipo} role="region" aria-label={aviso.titulo}>
      <span className="av-ico" aria-hidden="true"><Icono aviso={aviso} size={15} /></span>
      <div className="av-tarjeta-texto">
        <div className="av-titulo">{aviso.titulo}</div>
        <Cuerpo texto={aviso.cuerpo} />
        <button type="button" className="av-link" onClick={onCerrar}>Entendido</button>
      </div>
    </section>
  );
}

function PopupCard({ aviso, onCerrar, autoFoco = false }: { aviso: AvisoApp; onCerrar: () => void; autoFoco?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (autoFoco) btn.current?.focus({ preventScroll: true }); }, [autoFoco]);
  return (
    <div className="av-pop-card" data-tipo={aviso.tipo}>
      <h2 id={`av-t-${aviso.id}`} className="av-pop-titulo">
        <span className="av-pop-ico" aria-hidden="true"><Warning size={20} weight="fill" /></span>
        {aviso.titulo}
      </h2>
      <Cuerpo texto={aviso.cuerpo} className="av-cuerpo av-pop-cuerpo" />
      <button ref={btn} type="button" className="av-cta" onClick={onCerrar}>Entendido</button>
    </div>
  );
}

function AvisoPopup({ aviso, onCerrar }: { aviso: AvisoApp; onCerrar: () => void }) {
  const cerrarRef = useRef(onCerrar);
  useEffect(() => { cerrarRef.current = onCerrar; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cerrarRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Urgente: no se cierra tocando fuera (que lo lea). Modal marcado: mientras está
  // abierto la pestaña no se recarga sola.
  return (
    <div className="av-velo" role="dialog" aria-modal="true" data-actualizacion-espera="aviso-urgente" aria-labelledby={`av-t-${aviso.id}`}>
      <PopupCard aviso={aviso} onCerrar={onCerrar} autoFoco />
    </div>
  );
}

// Variables del tema (V5Root define --surface/--text/--text2/--text3/--border/--shadow/
// --accent-light/--red/--amber en :root y .dark); los respaldos cubren las pantallas
// de la app que no montan V5Root.
const CSS = `
.av-root{--av-surface:var(--surface,#ffffff);--av-text:var(--text,#1a1612);--av-text2:var(--text2,#6f6659);--av-text3:var(--text3,#8b8275);--av-border:var(--border,rgba(0,0,0,.08));--av-shadow:var(--shadow,rgba(0,0,0,.08));--av-tinte:var(--accent-light,rgba(232,85,62,.08));--av-acento:var(--accent,#E8553E);--av-rojo:var(--red,#dc2626);--av-ambar:var(--amber,#d97706);font-family:var(--font-geist-sans),system-ui,sans-serif}
.dark .av-root{--av-surface:var(--surface,#16181d);--av-text:var(--text,#e8eaf0);--av-text2:var(--text2,#8b92a3);--av-text3:var(--text3,#697080);--av-border:var(--border,rgba(255,255,255,.06));--av-shadow:var(--shadow,rgba(0,0,0,.3));--av-tinte:var(--accent-light,rgba(232,85,62,.1));--av-rojo:var(--red,#ef4444);--av-ambar:var(--amber,#f59e0b)}
.av-cuerpo{margin:3px 0 0;font-size:12px;line-height:1.5;color:var(--av-text2);overflow-wrap:anywhere}
.av-cuerpo strong{color:var(--av-text);font-weight:700}
.av-cuerpo a{color:var(--av-acento);font-weight:600;text-decoration:underline;text-underline-offset:2px}

/* toast = el de Toast.tsx. z-index 90: BAJO los modales de la app (z-100+) (M3). */
.av-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:90;display:flex;align-items:flex-start;gap:8px;width:max-content;max-width:min(440px,calc(100vw - 32px));padding:10px 10px 10px 16px;border-radius:12px;background:#fff;box-shadow:0 4px 20px rgba(0,0,0,.12);animation:avSube .25s ease both}
.dark .av-toast{background:#1c1c1e}
.av-toast-ico{display:flex;padding-top:1px;color:var(--av-acento);flex-shrink:0}
.av-toast[data-tipo="mantencion"] .av-toast-ico{color:var(--av-ambar)}
.av-toast-texto{min-width:0;padding-right:2px}
.av-toast-titulo{display:block;font-size:14px;font-weight:500;line-height:1.4;color:#111}
.dark .av-toast-titulo{color:#fff}
.av-toast-cuerpo{margin:1px 0 0;font-size:12px;line-height:1.45;color:var(--av-text2);overflow-wrap:anywhere}
.av-toast-cuerpo strong{font-weight:600;color:inherit}
.av-toast-cuerpo a{color:var(--av-acento);text-decoration:underline;text-underline-offset:2px}

/* ✕ chica como la del resto de la app */
.av-x{flex-shrink:0;width:22px;height:22px;border-radius:999px;border:none;background:transparent;color:var(--av-text3);display:grid;place-items:center;cursor:pointer;transition:background .15s,color .15s}
.av-x:hover{background:var(--bg-muted,rgba(0,0,0,.05));color:var(--av-text)}

/* tarjeta = panel de la columna izquierda */
.av-tarjeta{position:fixed;right:20px;bottom:20px;z-index:90;display:flex;align-items:flex-start;gap:10px;width:min(320px,calc(100vw - 32px));padding:12px 14px;border-radius:16px;background:var(--av-surface);border:1px solid var(--av-border);box-shadow:0 8px 32px var(--av-shadow);animation:avSube .25s ease both}
.av-ico{width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--av-tinte);color:var(--av-acento)}
.av-tarjeta[data-tipo="mantencion"] .av-ico{background:rgba(245,158,11,.12);color:var(--av-ambar)}
.av-tarjeta-texto{flex:1;min-width:0;padding-top:1px}
.av-titulo{font-size:13px;font-weight:700;letter-spacing:-.01em;line-height:1.35;color:var(--av-text)}
.av-link{display:block;margin:8px 0 0 auto;padding:0;border:none;background:transparent;color:var(--av-text3);font:inherit;font-size:11px;font-weight:600;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.av-link:hover{color:var(--av-text)}

/* popup urgente = modal "Revisa las columnas" (FieldMapper) */
.av-velo{position:fixed;inset:0;z-index:130;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.5);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);animation:avFundido .2s ease both}
.av-pop-card{width:min(440px,100%);padding:22px;border-radius:20px;background:var(--av-surface);border:1px solid var(--av-border);box-shadow:0 30px 90px rgba(0,0,0,.35);color:var(--av-text)}
.av-pop-titulo{display:flex;align-items:center;gap:9px;margin:0;font-size:15px;font-weight:700;letter-spacing:-.01em;line-height:1.35;color:var(--av-text)}
.av-pop-ico{display:flex;color:var(--av-rojo);flex-shrink:0}
.av-pop-cuerpo{margin-top:8px;font-size:12.5px}
.av-cta{margin-top:18px;width:100%;display:flex;align-items:center;justify-content:center;padding:11px 16px;border:none;border-radius:11px;background:var(--av-acento);color:#fff;font:inherit;font-size:13px;font-weight:700;line-height:1.4;cursor:pointer;transition:filter .15s}
.av-cta:hover{filter:brightness(1.06)}
.av-cta:focus-visible,.av-link:focus-visible,.av-x:focus-visible{outline:2px solid var(--av-acento);outline-offset:2px}

/* vista previa en /dev: misma pieza, sin posición fija */
.av-previa .av-toast,.av-previa .av-tarjeta{position:relative;left:auto;right:auto;bottom:auto;transform:none;z-index:auto;animation:none}

@keyframes avSube{from{opacity:0;translate:0 8px}to{opacity:1;translate:0 0}}
@keyframes avFundido{from{opacity:0}to{opacity:1}}
@media (max-width:520px){.av-tarjeta{right:12px;left:12px;bottom:12px;width:auto}}
@media (prefers-reduced-motion:reduce){.av-toast,.av-tarjeta,.av-velo{animation:none}}
`;
