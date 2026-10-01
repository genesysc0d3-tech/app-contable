"use client";

// Presentación de un aviso (toast / tarjeta / popup urgente). La usa <AvisosApp>
// en la app y la vista previa de /dev → Avisos (vistaPrevia: sin posición fija).
// Overlays según el inventario de la actualización invisible: el popup urgente es
// modal marcado (bloquea la recarga); toast y tarjeta se declaran libres.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatoEfectivo, partesMarkdown, TOAST_MS, type AvisoApp } from "@/lib/avisos/reglas";

function Cuerpo({ texto }: { texto: string }): ReactNode {
  if (!texto) return null;
  return (
    <p className="av-cuerpo">
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

function etiqueta(a: AvisoApp): string {
  if (a.tipo === "urgente") return "Importante";
  if (a.tipo === "mantencion") return "Mantención";
  return a.version_min ? "Novedades de esta versión" : "Novedad";
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
      <span className="av-barra" aria-hidden="true" />
      <div className="av-texto">
        <div className="av-titulo">{aviso.titulo}</div>
        <Cuerpo texto={aviso.cuerpo} />
      </div>
      <button type="button" className="av-x" aria-label="Cerrar aviso" onClick={onCerrar}>×</button>
    </div>
  );
}

function AvisoTarjeta({ aviso, onCerrar }: { aviso: AvisoApp; onCerrar: () => void }) {
  return (
    // actualizacion-libre: tarjeta informativa sin formulario; si la pestaña recarga sin cerrarla, vuelve a salir
    <section className="av-tarjeta" data-tipo={aviso.tipo} role="region" aria-label={aviso.titulo}>
      <div className="av-eyebrow">{etiqueta(aviso)}</div>
      <div className="av-titulo av-titulo-lg">{aviso.titulo}</div>
      <Cuerpo texto={aviso.cuerpo} />
      <div className="av-acciones">
        <button type="button" className="av-btn" onClick={onCerrar}>Entendido</button>
      </div>
    </section>
  );
}

function PopupCard({ aviso, onCerrar, autoFoco = false }: { aviso: AvisoApp; onCerrar: () => void; autoFoco?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (autoFoco) btn.current?.focus({ preventScroll: true }); }, [autoFoco]);
  return (
    <div className="av-pop-card" data-tipo={aviso.tipo}>
      <div className="av-pop-icono" aria-hidden="true">!</div>
      <div className="av-eyebrow">{etiqueta(aviso)}</div>
      <h2 id={`av-t-${aviso.id}`} className="av-titulo av-titulo-xl">{aviso.titulo}</h2>
      <Cuerpo texto={aviso.cuerpo} />
      <div className="av-acciones av-acciones-centro">
        <button ref={btn} type="button" className="av-btn av-btn-grande" onClick={onCerrar}>Entendido</button>
      </div>
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

// Estilo massDTE: carbón + acento coral, radios y tipografía de la app; claro/oscuro
// con la clase .dark del <html>. Inline (<style>) como el resto de v5.
const CSS = `
.av-root{--av-bg:#FFFDF9;--av-fg:#1A1612;--av-fg2:#6B6559;--av-borde:#E2DCD1;--av-acento:#E8553E;--av-sombra:0 18px 48px -12px rgba(26,22,18,.28);font-family:var(--font-geist-sans),system-ui,sans-serif}
.dark .av-root{--av-bg:#1c1c1f;--av-fg:#EDEDED;--av-fg2:rgba(255,255,255,.62);--av-borde:rgba(255,255,255,.09);--av-sombra:0 22px 60px -14px rgba(0,0,0,.65)}
.av-root [data-tipo="mantencion"]{--av-acento:#f59e0b}
.av-cuerpo{margin:4px 0 0;font-size:12.5px;line-height:1.55;color:var(--av-fg2);overflow-wrap:anywhere}
.av-cuerpo strong{color:var(--av-fg);font-weight:800}
.av-cuerpo a{color:var(--av-acento);font-weight:700;text-decoration:underline;text-underline-offset:2px}
.av-titulo{font-size:13px;font-weight:850;letter-spacing:-.01em;color:var(--av-fg);line-height:1.35}
.av-titulo-lg{font-size:14.5px;margin-top:2px}
.av-titulo-xl{font-size:17px;margin:4px 0 0;letter-spacing:-.02em}
.av-eyebrow{font-size:9.5px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:var(--av-acento)}
.av-btn{border:none;border-radius:11px;padding:9px 18px;background:var(--av-acento);color:#fff;font:inherit;font-size:12.5px;font-weight:850;cursor:pointer;box-shadow:0 10px 26px -10px rgba(232,85,62,.6);transition:filter .15s}
.av-btn:hover{filter:brightness(1.07)}
.av-btn:focus-visible,.av-x:focus-visible{outline:2px solid var(--av-acento);outline-offset:2px}
.av-btn-grande{padding:11px 30px;font-size:13px}
.av-acciones{display:flex;justify-content:flex-end;margin-top:12px}
.av-acciones-centro{justify-content:center;margin-top:18px}

/* toast: carbón siempre (también en claro), abajo a la derecha. z-index 90: BAJO los
   modales de la app (z-100+), nunca queda encima de un wizard o un popup (M3). */
.av-toast{position:fixed;right:20px;bottom:20px;z-index:90;display:flex;align-items:flex-start;gap:10px;width:min(360px,calc(100vw - 32px));padding:12px 10px 12px 12px;border-radius:14px;background:#1c1c1f;border:1px solid rgba(255,255,255,.08);box-shadow:0 18px 44px -12px rgba(0,0,0,.55);animation:avSube .28s cubic-bezier(.2,.9,.3,1.2) both}
.av-toast .av-titulo{color:#f2f2f2}
.av-toast .av-cuerpo{color:rgba(255,255,255,.66)}
.av-toast .av-cuerpo strong{color:#fff}
.av-barra{flex:0 0 3px;align-self:stretch;border-radius:3px;background:var(--av-acento)}
.av-texto{flex:1;min-width:0}
.av-x{flex:0 0 26px;height:26px;border-radius:999px;border:none;background:rgba(255,255,255,.07);color:rgba(255,255,255,.7);font-size:16px;line-height:1;cursor:pointer;display:grid;place-items:center;transition:.15s}
.av-x:hover{background:var(--av-acento);color:#fff}

/* tarjeta: esquina inferior derecha, discreta */
.av-tarjeta{position:fixed;right:20px;bottom:20px;z-index:90;width:min(340px,calc(100vw - 32px));padding:16px 16px 14px;border-radius:16px;background:var(--av-bg);border:1px solid var(--av-borde);border-top:3px solid var(--av-acento);box-shadow:var(--av-sombra);animation:avSube .32s cubic-bezier(.2,.9,.3,1.2) both}

/* popup urgente: modal centrado sobre velo */
.av-velo{position:fixed;inset:0;z-index:130;display:grid;place-items:center;padding:20px;background:rgba(8,9,12,.55);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:avFundido .22s ease both}
.av-pop-card{width:min(420px,100%);padding:24px 24px 20px;border-radius:20px;background:var(--av-bg);border:1px solid var(--av-borde);box-shadow:0 40px 100px -20px rgba(0,0,0,.5);text-align:center;animation:avPop .3s cubic-bezier(.34,1.4,.5,1) both}
.av-pop-card .av-cuerpo{font-size:13px}
.av-pop-icono{width:44px;height:44px;margin:0 auto 12px;border-radius:14px;display:grid;place-items:center;background:rgba(232,85,62,.14);color:var(--av-acento);font-size:22px;font-weight:900}

/* vista previa en /dev: misma pieza, sin posición fija */
.av-previa .av-toast,.av-previa .av-tarjeta{position:relative;right:auto;bottom:auto;z-index:auto}

@keyframes avSube{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes avFundido{from{opacity:0}to{opacity:1}}
@keyframes avPop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
@media (max-width:520px){.av-toast,.av-tarjeta{right:12px;left:12px;bottom:12px;width:auto}}
@media (prefers-reduced-motion:reduce){.av-toast,.av-tarjeta,.av-velo,.av-pop-card{animation:none}}
`;
