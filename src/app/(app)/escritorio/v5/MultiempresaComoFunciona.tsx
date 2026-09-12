"use client";

import { useEffect, useState } from "react";

/**
 * "Cómo funciona" de MULTIEMPRESA (fundador 2026-09-12): fiel a lo real — en
 * Business tienes varias empresas en una sola cuenta; cambias con un clic y el
 * escritorio pasa a ser el de esa empresa; cada una con su RUT autorizado en el
 * SII, sus folios y su mesa. Mismo molde + pasos sincronizados. Todo de
 * mentira. Con prefers-reduced-motion queda en el final.
 */
const FASE_MS = 3200;

const PASOS = [
  { t: "Varias empresas, una cuenta", p: "Business junta hasta 3 empresas. No pagas una cuenta por cada una." },
  { t: "Cambias con un clic", p: "Eliges la empresa desde el logo y el escritorio pasa a ser el suyo." },
  { t: "Cada una con su RUT", p: "Autorizado en el SII, con sus folios y su mesa. Nada se mezcla." },
];

const EMPRESAS = [
  { ini: "AC", nom: "AlphaCode SpA", rut: "78.448.088-7", color: "var(--accent)" },
  { ini: "CA", nom: "Comercial Andes SpA", rut: "76.543.210-9", color: "#5b9cf6" },
];

export default function MultiempresaComoFunciona() {
  const [fase, setFase] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const q = window.setTimeout(() => setFase(3), 0);
      return () => window.clearTimeout(q);
    }
    const t = window.setInterval(() => setFase((f) => (f % 3) + 1), FASE_MS);
    return () => window.clearInterval(t);
  }, []);

  // fase 1 = empresa A activa; fase 2-3 = cambió a la B.
  const activa = fase === 1 ? 0 : 1;
  const emp = EMPRESAS[activa];

  return (
    <div className="mef-grid" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 560px) minmax(240px, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
      <style>{`
        .mef-stage{position:relative;height:320px;border-radius:14px;border:1px solid var(--border);background:var(--bg);overflow:hidden;font-size:9px;color:var(--text);display:flex;gap:12px;padding:14px}
        .mef-pop{width:46%;border-radius:14px;border:1px solid var(--border);background:var(--surface);padding:11px;display:flex;flex-direction:column}
        .mef-pop-h{font-size:7.5px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-bottom:9px}
        .mef-emp{display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:10px;border:1px solid var(--border);background:var(--bg-muted);margin-bottom:6px;transition:.35s;position:relative}
        .mef-emp.on{border-color:rgba(232,85,62,.4);background:var(--accent-light);box-shadow:0 0 0 3px rgba(232,85,62,.08)}
        .mef-badge{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;color:#fff;font-size:8.5px;font-weight:900;flex-shrink:0}
        .mef-emp .nm{font-size:9px;font-weight:800;color:var(--text)}
        .mef-emp .ru{font-size:7.5px;color:var(--text2);margin-top:1px;font-variant-numeric:tabular-nums}
        .mef-emp .chk{margin-left:auto;width:16px;height:16px;border-radius:999px;background:var(--accent);display:grid;place-items:center;opacity:0;transform:scale(.4);transition:.3s}
        .mef-emp.on .chk{opacity:1;transform:none}
        .mef-cursor{position:absolute;right:12px;bottom:10px;width:14px;height:14px;opacity:0;transition:.35s;z-index:3}
        .mef-stage[data-fase="2"] .mef-cursor{opacity:1;animation:mefTap 1s ease-in-out infinite}
        @keyframes mefTap{0%,100%{transform:translate(0,0)}45%{transform:translate(-2px,-2px)}}
        .mef-add{margin-top:auto;padding:6px 8px;border-radius:8px;border:1px dashed var(--border);font-size:8px;font-weight:800;color:var(--text2);text-align:center}
        .mef-add b{color:var(--text)}
        /* mini escritorio de la empresa activa */
        .mef-desk{flex:1;border-radius:14px;border:1px solid var(--border);background:var(--surface);overflow:hidden;display:flex;flex-direction:column;min-width:0}
        .mef-desk-bar{display:flex;align-items:center;gap:8px;padding:9px 11px;border-bottom:1px solid var(--border)}
        .mef-desk-brand{font-size:9.5px;font-weight:850;color:var(--text);transition:.35s}
        .mef-desk-body{flex:1;padding:11px;display:flex;flex-direction:column;gap:7px}
        .mef-stat{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;border:1px solid var(--border);background:var(--bg-muted)}
        .mef-stat .lab{font-size:8px;color:var(--text2);font-weight:700}
        .mef-stat .val{margin-left:auto;font-size:9px;font-weight:850;color:var(--text);font-variant-numeric:tabular-nums}
        .mef-tag{align-self:flex-start;margin-top:2px;font-size:7.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(34,197,94,.1);color:var(--green);border:1px solid rgba(34,197,94,.3)}
        .mef-steps{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}
        .mef-s{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px;border-radius:11px;border:1px solid transparent;transition:.35s;opacity:.55}
        .mef-n{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:var(--bg-muted);color:var(--text2)}
        .mef-s b{display:block;font-size:12px;font-weight:800;color:var(--text)}
        .mef-s p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--text2)}
        .mef-s.on{opacity:1;border-color:rgba(232,85,62,.28);background:rgba(232,85,62,.06)}
        .mef-s.on .mef-n{background:var(--accent);color:#fff}
        @media (max-width:900px){.mef-grid{grid-template-columns:1fr !important}}
        @media (prefers-reduced-motion:reduce){.mef-emp,.mef-emp .chk,.mef-cursor,.mef-desk-brand{transition:none;animation:none}}
      `}</style>

      <div className="mef-stage" data-fase={fase} aria-hidden>
        <div className="mef-pop">
          <div className="mef-pop-h">Tus empresas · 2 de 3</div>
          {EMPRESAS.map((e, i) => (
            <div key={e.ini} className={`mef-emp${i === activa ? " on" : ""}`}>
              <span className="mef-badge" style={{ background: e.color }}>{e.ini}</span>
              <span><div className="nm">{e.nom}</div><div className="ru">{e.rut}</div></span>
              <span className="chk"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
            </div>
          ))}
          <div className="mef-add">+ Agregar empresa · <b>queda 1</b></div>
          <svg className="mef-cursor" viewBox="0 0 16 16" fill="var(--text)" stroke="var(--surface)" strokeWidth="1"><path d="M2 2l5 12 2-5 5-2z" /></svg>
        </div>

        <div className="mef-desk">
          <div className="mef-desk-bar">
            <span className="mef-badge" style={{ background: emp.color, width: 22, height: 22, borderRadius: 6, fontSize: 7.5 }}>{emp.ini}</span>
            <span className="mef-desk-brand">{emp.nom}</span>
          </div>
          <div className="mef-desk-body">
            <span className="mef-tag">Escritorio de esta empresa</span>
            <div className="mef-stat"><span className="lab">RUT autorizado</span><span className="val">{emp.rut}</span></div>
            <div className="mef-stat"><span className="lab">Folios propios</span><span className="val">{activa === 0 ? "961–1.960" : "201–700"}</span></div>
            <div className="mef-stat"><span className="lab">Boletas del mes</span><span className="val">{activa === 0 ? "128" : "34"}</span></div>
          </div>
        </div>
      </div>

      <ol className="mef-steps">
        {PASOS.map((s, i) => (
          <li key={s.t} className={`mef-s${fase === i + 1 ? " on" : ""}`}>
            <span className="mef-n">{i + 1}</span>
            <span><b>{s.t}</b><p>{s.p}</p></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
