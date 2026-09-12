"use client";

import { useEffect, useState } from "react";

/**
 * "Cómo funciona" de CONFIGURAR EMPRESA (fundador 2026-09-12, 3ª vuelta):
 * versión ROBUSTA — nada de popups absolutos que se desbordan (rompían el
 * layout y dejaban texto flotando). La escena ES el panel de configuración ya
 * abierto: su header con el ícono real de empresa, el riel de pasos y el sello
 * "Proceso guiado". Todo in-flow, contenido. Mismo molde + pasos sincronizados.
 * Todo de mentira. Con prefers-reduced-motion queda en el final.
 */
const FASE_MS = 3000;

const PASOS = [
  { t: "El ícono de empresa", p: "Arriba a la derecha del escritorio (el edificio). Lo aprietas." },
  { t: "Se abre la configuración", p: "La de tu empresa, sin salir de la mesa." },
  { t: "Es un proceso guiado", p: "Te lleva paso a paso: datos, emisión, folios. Sin perderte." },
];

const RIEL = ["Emisor", "Emisión", "Folios CAF", "Telegram", "Conector MCP", "Team"];

// Ícono real de "Configuración de empresa" (LeftQuickActions): el edificio.
const IcEmpresa = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor"><path d="M240,204H228V96a20,20,0,0,0-20-20H172V32a20,20,0,0,0-28.45-18.12l-104,48.54A20.06,20.06,0,0,0,28,80.55V204H16a12,12,0,0,0,0,24H240a12,12,0,0,0,0-24ZM204,100V204H172V100ZM52,83.09,148,38.3V204H52ZM132,112v12a12,12,0,0,1-24,0V112a12,12,0,0,1,24,0Zm-40,0v12a12,12,0,0,1-24,0V112a12,12,0,0,1,24,0Zm0,52v12a12,12,0,0,1-24,0V164a12,12,0,0,1,24,0Zm40,0v12a12,12,0,0,1-24,0V164a12,12,0,0,1,24,0Z" /></svg>
);

export default function ConfigurarEmpresaComoFunciona() {
  const [fase, setFase] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const q = window.setTimeout(() => setFase(3), 0);
      return () => window.clearTimeout(q);
    }
    const t = window.setInterval(() => setFase((f) => (f % 3) + 1), FASE_MS);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="cfg-grid" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 560px) minmax(240px, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
      <style>{`
        .cfg-stage{height:320px;border-radius:14px;border:1px solid var(--border);background:var(--surface);overflow:hidden;font-size:9px;color:var(--text);display:flex;flex-direction:column;min-width:0}
        .cfg-head{display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid var(--border);flex-shrink:0}
        .cfg-hico{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:var(--accent-light);color:var(--accent);flex-shrink:0}
        .cfg-htt{font-size:10px;font-weight:850;color:var(--text)}
        .cfg-guided{margin-left:auto;font-size:7.5px;font-weight:850;letter-spacing:.05em;text-transform:uppercase;padding:3px 9px;border-radius:999px;background:var(--accent-light);border:1px solid rgba(232,85,62,.3);color:var(--accent)}
        .cfg-body{flex:1;display:flex;min-height:0;min-width:0}
        .cfg-rail{width:42%;border-right:1px solid var(--border);background:var(--surface2);padding:11px 10px;display:flex;flex-direction:column;gap:4px;min-width:0}
        .cfg-rail-h{font-size:7px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-bottom:4px}
        .cfg-step{display:flex;align-items:center;gap:7px;padding:5px 6px;border-radius:7px;color:var(--text2);font-weight:800;font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:.3s}
        .cfg-step .dot{width:15px;height:15px;border-radius:999px;display:grid;place-items:center;background:var(--bg-muted);color:var(--text3);font-size:7.5px;font-weight:900;flex-shrink:0}
        .cfg-step.on{background:var(--accent-light);color:var(--text)}
        .cfg-step.on .dot{background:var(--accent);color:#fff}
        .cfg-main{flex:1;padding:14px 15px;min-width:0;display:flex;flex-direction:column;justify-content:center}
        .cfg-title{font-size:11px;font-weight:850;color:var(--text)}
        .cfg-sub{font-size:8.5px;color:var(--text2);margin:2px 0 13px}
        .cfg-line{height:10px;border-radius:5px;background:var(--bg-muted);margin-bottom:8px}
        .cfg-line.s{width:62%}
        .cfg-guidedbig{margin-top:12px;display:inline-flex;align-self:flex-start;align-items:center;gap:7px;padding:7px 12px;border-radius:9px;background:var(--accent-light);border:1px solid rgba(232,85,62,.3);font-size:9px;font-weight:850;color:var(--accent)}
        .cfg-steps{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}
        .cfg-s{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px;border-radius:11px;border:1px solid transparent;transition:.35s;opacity:.55}
        .cfg-n{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:var(--bg-muted);color:var(--text2)}
        .cfg-s b{display:block;font-size:12px;font-weight:800;color:var(--text)}
        .cfg-s p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--text2)}
        .cfg-s.on{opacity:1;border-color:rgba(232,85,62,.28);background:rgba(232,85,62,.06)}
        .cfg-s.on .cfg-n{background:var(--accent);color:#fff}
        @media (max-width:900px){.cfg-grid{grid-template-columns:1fr !important}}
        @media (prefers-reduced-motion:reduce){.cfg-step{transition:none}}
      `}</style>

      <div className="cfg-stage" aria-hidden>
        <div className="cfg-head">
          <span className="cfg-hico"><IcEmpresa size={15} /></span>
          <span className="cfg-htt">Configuración de empresa</span>
          <span className="cfg-guided">Guiado</span>
        </div>
        <div className="cfg-body">
          <div className="cfg-rail">
            <div className="cfg-rail-h">Pasos</div>
            {RIEL.map((r, i) => (
              <div key={r} className={`cfg-step${i === 0 ? " on" : ""}`}>
                <span className="dot">{i + 1}</span>{r}
              </div>
            ))}
          </div>
          <div className="cfg-main">
            <div className="cfg-title">Emisor</div>
            <div className="cfg-sub">Datos de tu empresa</div>
            <div className="cfg-line" />
            <div className="cfg-line s" />
            <div className="cfg-guidedbig">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              Proceso guiado, paso a paso
            </div>
          </div>
        </div>
      </div>

      <ol className="cfg-steps">
        {PASOS.map((s, i) => (
          <li key={s.t} className={`cfg-s${fase === i + 1 ? " on" : ""}`}>
            <span className="cfg-n">{i + 1}</span>
            <span><b>{s.t}</b><p>{s.p}</p></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
