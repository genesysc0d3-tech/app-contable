"use client";

import { useEffect, useState } from "react";
import { LogoMcp } from "./LogoMcp";

/**
 * "Cómo funciona" del CONECTOR MCP (fundador 2026-09-12): fiel a lo real —
 * enchufas tu IA (Claude o ChatGPT) por MCP; es un copiloto de REVISIÓN, NO
 * emite; sus sugerencias quedan en cuarentena y solo valen cuando tú das el
 * clic (se aprende de ese clic). Glifo oficial de MCP (LogoMcp, el mismo de los
 * chips). Mismo molde + pasos sincronizados. Todo de mentira. Con
 * prefers-reduced-motion queda en el final.
 */
const FASE_MS = 3300;

const PASOS = [
  { t: "Enchufas tu IA", p: "Claude, ChatGPT o Gemini, con el conector MCP. Un enlace, sin instalar nada." },
  { t: "Revisa tus movimientos", p: "Mira la cartola y propone qué es qué. Es copiloto: nunca emite." },
  { t: "Apruebas con un clic", p: "Sus sugerencias quedan en cuarentena hasta que tú dices sí." },
];

export default function McpComoFunciona() {
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
    <div className="mcpf-grid" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 560px) minmax(240px, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
      <style>{`
        .mcpf-stage{position:relative;height:320px;border-radius:14px;border:1px solid var(--border);background:var(--bg);overflow:hidden;font-size:9px;color:var(--text);padding:14px}
        .mcpf-conn{display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:12px;border:1px solid var(--border);background:var(--surface)}
        .mcpf-glyph{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:var(--bg-muted);color:var(--text);flex-shrink:0}
        .mcpf-conn .tt{font-size:10px;font-weight:850;color:var(--text)}
        .mcpf-conn .ts{font-size:7.5px;color:var(--text3);margin-top:1px}
        .mcpf-pills{margin-left:auto;display:flex;gap:5px}
        .mcpf-pill{display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:999px;border:1px solid var(--border);background:var(--bg-muted);font-size:8px;font-weight:850;color:var(--text3);transition:.4s}
        .mcpf-pill .dot{width:6px;height:6px;border-radius:999px;background:var(--text3);transition:.4s}
        .mcpf-stage[data-fase="1"] .mcpf-pill,.mcpf-stage[data-fase="2"] .mcpf-pill,.mcpf-stage[data-fase="3"] .mcpf-pill{color:var(--text);border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.08)}
        .mcpf-stage[data-fase="1"] .mcpf-pill .dot,.mcpf-stage[data-fase="2"] .mcpf-pill .dot,.mcpf-stage[data-fase="3"] .mcpf-pill .dot{background:var(--green)}
        .mcpf-stage[data-fase="1"] .mcpf-pill:nth-child(2){transition-delay:.2s}
        .mcpf-stage[data-fase="1"] .mcpf-pill:nth-child(3){transition-delay:.4s}
        /* burbuja de la IA */
        .mcpf-chat{margin-top:11px;display:flex;gap:8px;opacity:0;transform:translateY(6px);transition:.45s}
        .mcpf-stage[data-fase="2"] .mcpf-chat,.mcpf-stage[data-fase="3"] .mcpf-chat{opacity:1;transform:none}
        .mcpf-av{width:22px;height:22px;border-radius:7px;display:grid;place-items:center;background:#D97757;color:#fff;font-size:8px;font-weight:900;flex-shrink:0}
        .mcpf-bub{padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--surface);font-size:9px;line-height:1.4;color:var(--text2);max-width:78%}
        .mcpf-bub b{color:var(--text)}
        /* cuarentena */
        .mcpf-q{margin-top:11px;padding:9px 11px;border-radius:11px;border:1px solid var(--border);background:var(--surface);opacity:0;transform:translateY(6px);transition:.45s}
        .mcpf-stage[data-fase="2"] .mcpf-q,.mcpf-stage[data-fase="3"] .mcpf-q{opacity:1;transform:none;transition-delay:.3s}
        .mcpf-qh{display:flex;align-items:center;gap:6px;font-size:7.5px;font-weight:850;letter-spacing:.05em;text-transform:uppercase;color:var(--amber);margin-bottom:7px}
        .mcpf-qh .badge{padding:1px 6px;border-radius:999px;background:rgba(217,119,6,.12);color:var(--amber)}
        .mcpf-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:var(--bg-muted);border:1px solid var(--border);margin-bottom:5px;color:var(--text2);font-size:8.5px}
        .mcpf-item:last-child{margin-bottom:0}
        .mcpf-item b{color:var(--text);font-weight:700}
        .mcpf-item .tag{font-size:6.5px;padding:1px 5px;border-radius:999px;background:rgba(91,156,246,.12);color:#5b9cf6;font-weight:800}
        .mcpf-item .ap{margin-left:auto;width:16px;height:16px;border-radius:5px;border:1px solid var(--border);display:grid;place-items:center;flex-shrink:0;transition:.3s}
        .mcpf-item .ap svg{opacity:0;transform:scale(.4);transition:.25s}
        .mcpf-stage[data-fase="3"] .mcpf-item .ap{background:var(--green);border-color:var(--green)}
        .mcpf-stage[data-fase="3"] .mcpf-item .ap svg{opacity:1;transform:scale(1)}
        .mcpf-stage[data-fase="3"] .mcpf-item:nth-child(3) .ap{transition-delay:.15s}
        .mcpf-steps{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}
        .mcpf-s{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px;border-radius:11px;border:1px solid transparent;transition:.35s;opacity:.55}
        .mcpf-n{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:var(--bg-muted);color:var(--text2)}
        .mcpf-s b{display:block;font-size:12px;font-weight:800;color:var(--text)}
        .mcpf-s p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--text2)}
        .mcpf-s.on{opacity:1;border-color:rgba(232,85,62,.28);background:rgba(232,85,62,.06)}
        .mcpf-s.on .mcpf-n{background:var(--accent);color:#fff}
        @media (max-width:900px){.mcpf-grid{grid-template-columns:1fr !important}}
        @media (prefers-reduced-motion:reduce){.mcpf-pill,.mcpf-chat,.mcpf-q,.mcpf-item .ap,.mcpf-s{transition:none}}
      `}</style>

      <div className="mcpf-stage" data-fase={fase} aria-hidden>
        <div className="mcpf-conn">
          <span className="mcpf-glyph"><LogoMcp size={18} /></span>
          <span><span className="tt">Conector MCP</span><span className="ts">Tu IA conectada · copiloto de revisión</span></span>
          <span className="mcpf-pills">
            <span className="mcpf-pill"><span className="dot" />Claude</span>
            <span className="mcpf-pill"><span className="dot" />ChatGPT</span>
            <span className="mcpf-pill"><span className="dot" />Gemini</span>
          </span>
        </div>

        <div className="mcpf-chat">
          <span className="mcpf-av">C</span>
          <div className="mcpf-bub">Revisé la <b>cartola de agosto</b>. Estos 3 movimientos parecen <b>exentos</b> — te los dejo propuestos.</div>
        </div>

        <div className="mcpf-q">
          <div className="mcpf-qh"><span>En cuarentena</span><span className="badge">Espera tu OK</span></div>
          {[
            { d: "Transferencia · 18 ago", m: "$75.000" },
            { d: "Transferencia · 19 ago", m: "$101.000" },
            { d: "Transferencia · 20 ago", m: "$54.000" },
          ].map((it, i) => (
            <div key={i} className="mcpf-item">
              <b>{it.d}</b>
              <span className="tag">Exenta</span>
              <span className="m" style={{ fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{it.m}</span>
              <span className="ap"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
            </div>
          ))}
        </div>
      </div>

      <ol className="mcpf-steps">
        {PASOS.map((s, i) => (
          <li key={s.t} className={`mcpf-s${fase === i + 1 ? " on" : ""}`}>
            <span className="mcpf-n">{i + 1}</span>
            <span><b>{s.t}</b><p>{s.p}</p></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
