"use client";

import { useState, type ReactNode } from "react";

const PROMPT = `Hola. Necesito que me ayudes, paso a paso y en lenguaje simple (no soy técnico), a instalar una extensión de Google Chrome que me pasó mi software de contabilidad. NO viene de la Chrome Web Store: la tengo como un archivo .zip que ya descargué.

Guíame de a un paso por vez y espera mi confirmación antes del siguiente:
1) Descomprimir el .zip en una carpeta.
2) Abrir Chrome y entrar a la dirección: chrome://extensions
3) Activar el "Modo de desarrollador" (interruptor arriba a la derecha).
4) Apretar "Cargar descomprimida" y elegir la carpeta que descomprimí.

Reglas importantes:
- NO me pidas el archivo .zip ni su contenido: no te lo puedo compartir y no lo necesitas para guiarme.
- NO me pidas contraseñas ni datos personales.
- Solo guíame por los clics dentro de Chrome. Si un botón no aparece, ayúdame a encontrarlo. Pregúntame si uso Windows o Mac si lo necesitas.

Empecemos por el paso 1.`;

const ZIP_URL = "/descargas/massdte-motor-local.zip";

export default function InstalarExtensionPage() {
  const [copied, setCopied] = useState(false);

  function copyPrompt() {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1900);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(PROMPT).then(done, () => { fallbackCopy(PROMPT); done(); });
    } else {
      fallbackCopy(PROMPT);
      done();
    }
  }

  return (
    <div className="eg-root">
      <style>{css}</style>
      <div className="eg-wrap">
        <p className="eg-eyebrow">MassDTE · Motor Local</p>
        <h1 className="eg-h1">Instala la extensión en 2 minutos</h1>
        <p className="eg-lead">
          Se hace <b>una sola vez</b>. Después emites tus boletas del SII directo desde la app,
          sin salir de tu computador.
        </p>

        <a className="eg-download" href={ZIP_URL} download>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V3M8 11l4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          Descargar extensión (.zip)
        </a>
        <p className="eg-meta">~2 minutos · una sola vez · funciona en Google Chrome</p>

        <hr className="eg-rule" />

        <h2 className="eg-h2">Los pasos</h2>
        <div className="eg-steps">
          <Step n="1" title="Descomprime el archivo">
            Clic derecho sobre el <code>.zip</code> que descargaste → <b>«Extraer todo»</b> (Windows)
            o doble clic (Mac). Queda una <b>carpeta</b> — acuérdate dónde la dejaste.
          </Step>
          <Step n="2" title="Abre la página de extensiones">
            En la barra de direcciones de Chrome, escribe <code>chrome://extensions</code> y aprieta Enter.
          </Step>
          <Step n="3" title="Activa el «Modo de desarrollador»">
            Es un interruptor <b>arriba a la derecha</b>. Actívalo.
          </Step>
          <Step n="4" title="Carga la extensión">
            Aprieta <b>«Cargar descomprimida»</b> y elige la <b>carpeta</b> que descomprimiste en el
            paso 1 (la carpeta, <b>no</b> el&nbsp;.zip).
          </Step>
          <Step n="5" title="¡Listo!">
            Ya aparece la extensión en la lista. No tienes que hacer nada más aquí.
          </Step>
        </div>

        <div className="eg-connect">
          <span className="eg-once">Una sola vez</span>
          <h3>Conecta tu clave del SII</h3>
          <ol>
            <li>Abre la app e <b>inicia sesión</b>.</li>
            <li>La extensión se detecta sola: vas a ver <b>«Extensión conectada»</b>.</li>
            <li>Conecta tu <b>RUT</b> + <b>Clave Tributaria</b>. Se guarda cifrada en tu computador.</li>
          </ol>
        </div>

        <hr className="eg-rule" />

        <h2 className="eg-h2">¿Se te complicó algún paso?</h2>
        <p className="eg-help">
          Copia este texto y pégaselo a <b>ChatGPT</b> (o cualquier asistente de IA que tengas).
          Te guía solo, a tu ritmo, sin que tengas que pedirnos nada:
        </p>
        <div className="eg-codebox">
          <button type="button" className={"eg-copy" + (copied ? " done" : "")} onClick={copyPrompt} aria-label="Copiar el texto de ayuda">
            {copied ? "¡Copiado!" : "Copiar"}
          </button>
          <pre>{PROMPT}</pre>
        </div>

        <div className="eg-safe">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <p>
            <b>Tu clave está segura.</b> Se cifra en tu propio computador y no sale de ahí. No leemos
            las cookies del SII, no compartimos tu clave con nadie, y la extensión no pide permisos
            sobre «todos los sitios».
          </p>
        </div>

        <p className="eg-foot">¿Dudas? Escríbenos y te ayudamos. Gracias por ser parte de la prueba.</p>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="eg-step">
      <span className="eg-num">{n}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function fallbackCopy(text: string) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch { /* noop */ }
  document.body.removeChild(ta);
}

const css = `
.eg-root {
  --bg:#141110; --surface:#1d1916; --ink:#f0ebe7; --muted:#a49b93; --faint:#776e67;
  --border:#2c2521; --border-strong:#3a322c; --accent:#f2694f; --accent-ink:#160f0d;
  --accent-soft:#2f201b; --green:#3cc08a; --green-soft:#16261e; --code-bg:#221d19;
  background:var(--bg); color:var(--ink); min-height:100vh;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif; line-height:1.6;
  -webkit-font-smoothing:antialiased;
}
.eg-wrap { max-width:660px; margin:0 auto; padding:48px 22px 80px; }
.eg-eyebrow { font-size:12px; font-weight:700; letter-spacing:.13em; text-transform:uppercase; color:var(--accent); margin:0 0 14px; }
.eg-h1 { font-size:clamp(28px,6vw,38px); line-height:1.1; letter-spacing:-.02em; font-weight:800; margin:0 0 12px; }
.eg-lead { font-size:17px; color:var(--muted); margin:0 0 26px; max-width:52ch; }
.eg-download {
  display:inline-flex; align-items:center; gap:10px; font-size:16px; font-weight:800;
  color:var(--accent-ink); background:var(--accent); border-radius:13px; padding:15px 24px;
  text-decoration:none; box-shadow:0 10px 30px -10px color-mix(in srgb, var(--accent) 55%, transparent);
  transition:transform .12s ease, opacity .12s ease;
}
.eg-download:hover { opacity:.94; }
.eg-download:active { transform:scale(.98); }
.eg-download:focus-visible { outline:2px solid var(--ink); outline-offset:3px; }
.eg-download svg { width:20px; height:20px; }
.eg-meta { font-size:13px; color:var(--faint); margin:14px 0 0; }
.eg-rule { height:1px; background:var(--border); border:0; margin:34px 0; }
.eg-h2 { font-size:13px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); margin:0 0 16px; }
.eg-steps { display:flex; flex-direction:column; gap:12px; }
.eg-step { display:grid; grid-template-columns:40px 1fr; gap:16px; align-items:start; background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px 20px; }
.eg-num { grid-row:span 2; width:40px; height:40px; border-radius:50%; background:var(--accent); color:var(--accent-ink); display:grid; place-items:center; font-weight:800; font-size:17px; }
.eg-step h3 { margin:2px 0 4px; font-size:16.5px; font-weight:700; letter-spacing:-.01em; }
.eg-step p { margin:0; font-size:15px; color:var(--muted); }
.eg-step b { color:var(--ink); font-weight:600; }
.eg-root code { font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:.9em; background:var(--code-bg); border:1px solid var(--border); border-radius:6px; padding:2px 7px; color:var(--ink); white-space:nowrap; }
.eg-connect { background:var(--accent-soft); border:1px solid color-mix(in srgb, var(--accent) 32%, transparent); border-radius:16px; padding:22px; margin-top:12px; }
.eg-once { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--accent); }
.eg-connect h3 { margin:6px 0 4px; font-size:18px; font-weight:800; letter-spacing:-.01em; }
.eg-connect ol { margin:12px 0 0; padding-left:20px; }
.eg-connect li { font-size:15px; margin-bottom:6px; color:var(--muted); }
.eg-connect li b { color:var(--ink); }
.eg-help { font-size:15px; color:var(--muted); margin:0 0 14px; }
.eg-codebox { position:relative; background:var(--code-bg); border:1px solid var(--border-strong); border-radius:14px; overflow:hidden; }
.eg-codebox pre { margin:0; padding:18px; font-family:ui-monospace,"SF Mono",Menlo,monospace; font-size:13px; line-height:1.6; color:var(--ink); white-space:pre-wrap; word-break:break-word; }
.eg-copy { position:absolute; top:12px; right:12px; font:inherit; font-size:12.5px; font-weight:700; cursor:pointer; color:var(--accent-ink); background:var(--accent); border:0; border-radius:9px; padding:8px 13px; transition:opacity .12s ease; }
.eg-copy:hover { opacity:.92; }
.eg-copy:focus-visible { outline:2px solid var(--ink); outline-offset:2px; }
.eg-copy.done { background:var(--green); }
.eg-safe { display:flex; gap:14px; align-items:flex-start; margin-top:34px; background:var(--green-soft); border:1px solid color-mix(in srgb, var(--green) 26%, transparent); border-radius:14px; padding:18px 20px; }
.eg-safe svg { flex:none; width:24px; height:24px; color:var(--green); margin-top:1px; }
.eg-safe p { margin:0; font-size:14.5px; color:var(--ink); }
.eg-foot { margin-top:30px; font-size:13px; color:var(--faint); text-align:center; }
@media (prefers-reduced-motion: reduce) { .eg-root * { transition:none !important; } }
`;
