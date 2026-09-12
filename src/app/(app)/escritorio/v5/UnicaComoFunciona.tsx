"use client";

import { useEffect, useState } from "react";

/**
 * "Cómo funciona" de la emisión de A UNA (fundador 2026-09-12): el otro carril
 * de emisión, distinto al masivo desde cartola. Emites una sola boleta o
 * factura a mano — eliges el tipo, pones receptor y monto, y sale. "De a una"
 * es ilimitado y no descuenta cupo del plan. Mismo molde que las otras guías:
 * maqueta fiel + pasos sincronizados. Todo de mentira. Con
 * prefers-reduced-motion queda quieto en el momento final.
 */
const FASE_MS = 3200;

const PASOS = [
  { t: "Elige boleta o factura", p: "Un clic. Emitir de a una es ilimitado — no descuenta cupo del plan." },
  { t: "Pones receptor y monto", p: "Digitas el RUT y los datos del receptor se completan solos." },
  { t: "Emites al tiro", p: "Sale con tu clave y tu folio. Una sola, justo cuando la necesitas." },
];

export default function UnicaComoFunciona() {
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
    <div className="ucf-grid" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 560px) minmax(240px, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
      <style>{`
        .ucf-stage{position:relative;height:320px;border-radius:14px;border:1px solid var(--border);background:var(--bg);overflow:hidden;font-size:9px;color:var(--text)}
        .ucf-bar{position:absolute;left:0;right:0;top:0;height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--border);background:var(--surface)}
        .ucf-mark{width:14px;height:14px;border-radius:4px;background:var(--accent)}
        .ucf-mesa-lbl{font-size:7.5px;font-weight:850;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}
        .ucf-cal{margin-left:auto;display:flex;gap:2px}
        .ucf-cal i{width:7px;height:9px;border-radius:2px;background:var(--bg-muted);display:block}
        .ucf-cal i.hoy{background:#b4f027}
        .ucf-side{position:absolute;left:10px;top:40px;width:26%;display:flex;flex-direction:column;gap:6px}
        .ucf-card{padding:7px 8px;border-radius:9px;border:1px solid var(--border);background:var(--surface)}
        .ucf-card .t{font-size:8px;font-weight:850;color:var(--accent)}
        .ucf-card .s{font-size:7px;color:var(--text3);margin-top:1px}
        .ucf-main{position:absolute;left:calc(26% + 18px);right:10px;top:40px;bottom:10px;border-radius:10px;border:1px solid var(--border);background:var(--surface);overflow:hidden;padding:10px 11px}
        .ucf-head{font-size:9px;font-weight:850;color:var(--text);margin-bottom:8px}
        /* switch boleta/factura */
        .ucf-switch{display:flex;gap:5px;margin-bottom:10px}
        .ucf-pill{flex:1;text-align:center;padding:5px 0;border-radius:8px;border:1px solid var(--border);background:var(--bg-muted);font-size:8.5px;font-weight:850;color:var(--text3);transition:.35s}
        .ucf-pill.on{background:var(--accent);border-color:var(--accent);color:#fff}
        /* form */
        .ucf-field{margin-bottom:8px}
        .ucf-lbl{font-size:7px;font-weight:850;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-bottom:3px}
        .ucf-input{display:flex;align-items:center;min-height:22px;padding:4px 8px;border-radius:7px;border:1px solid var(--border);background:var(--bg);font-size:9px;font-weight:700;color:var(--text)}
        .ucf-input .ph{color:var(--text3);font-weight:600}
        .ucf-input .auto{margin-left:auto;font-size:7px;font-weight:800;color:var(--green);opacity:0;transition:.4s}
        .ucf-typed{opacity:0;transition:.4s}
        .ucf-total{font-variant-numeric:tabular-nums;font-weight:850}
        /* revelados por fase */
        .ucf-stage[data-fase="2"] .ucf-typed,.ucf-stage[data-fase="3"] .ucf-typed{opacity:1}
        .ucf-stage[data-fase="2"] .ucf-input .auto,.ucf-stage[data-fase="3"] .ucf-input .auto{opacity:1;transition-delay:.5s}
        .ucf-emit{margin-top:2px;width:100%;padding:7px 0;border-radius:8px;background:var(--accent);color:#fff;font-size:9px;font-weight:850;text-align:center;box-shadow:0 8px 20px -6px rgba(232,85,62,.55);opacity:.4;transition:.35s}
        .ucf-stage[data-fase="2"] .ucf-emit{opacity:1}
        .ucf-stage[data-fase="3"] .ucf-emit{transform:scale(.96);opacity:.5}
        /* voucher fase 3 */
        .ucf-voucher{position:absolute;left:11px;right:11px;bottom:11px;display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:10px;border:1px solid rgba(34,197,94,.3);background:rgba(34,197,94,.08);opacity:0;transform:translateY(10px) scale(.95);transition:.5s cubic-bezier(.34,1.56,.64,1)}
        .ucf-stage[data-fase="3"] .ucf-voucher{opacity:1;transform:none}
        .ucf-voucher .vic{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;background:rgba(34,197,94,.16);color:var(--green);flex-shrink:0}
        .ucf-voucher .vt{font-size:9px;font-weight:850;color:var(--text)}
        .ucf-voucher .vs{font-size:7.5px;color:var(--text2);margin-top:1px}
        .ucf-voucher .vm{margin-left:auto;font-size:11px;font-weight:850;color:var(--text);font-variant-numeric:tabular-nums}
        .ucf-steps{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}
        .ucf-step{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px;border-radius:11px;border:1px solid transparent;transition:.35s;opacity:.55}
        .ucf-n{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:var(--bg-muted);color:var(--text2)}
        .ucf-step b{display:block;font-size:12px;font-weight:800;color:var(--text)}
        .ucf-step p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--text2)}
        .ucf-step.on{opacity:1;border-color:rgba(232,85,62,.28);background:rgba(232,85,62,.06)}
        .ucf-step.on .ucf-n{background:var(--accent);color:#fff}
        @media (max-width:900px){.ucf-grid{grid-template-columns:1fr !important}}
        @media (prefers-reduced-motion:reduce){.ucf-pill,.ucf-typed,.ucf-input .auto,.ucf-emit,.ucf-voucher,.ucf-step{transition:none}.ucf-stage[data-fase="3"] .ucf-voucher{opacity:1;transform:none}}
      `}</style>

      <div className="ucf-stage" data-fase={fase} aria-hidden>
        <div className="ucf-bar">
          <span className="ucf-mark" />
          <span className="ucf-mesa-lbl">Emitir de a una</span>
          <span className="ucf-cal">{Array.from({ length: 14 }, (_, i) => <i key={i} className={i === 5 ? "hoy" : undefined} />)}</span>
        </div>

        {/* Columna izquierda REAL del escritorio (fundador 2026-09-12): botones que
            existen de verdad. Acá resalta la de "Emitir boleta única". */}
        <div className="ucf-side">
          <div className="ucf-card"><div className="t" style={{ color: "var(--text)" }}>Registro de ventas</div><div className="s">0 boletas · $0 exento</div></div>
          <div className="ucf-card"><div className="t">MassDTE Boletas</div><div className="s">Subida masiva de cartolas</div></div>
          <div className="ucf-card" style={{ borderColor: "var(--lime)" }}><div className="t" style={{ color: "var(--lime)" }}>Emitir boleta única</div><div className="s">Boleta manual, una a la vez</div></div>
          <div className="ucf-card"><div className="t" style={{ color: "var(--text)" }}>Uso del mes</div><div className="s">0 / 3.000</div></div>
        </div>

        <div className="ucf-main">
          <div className="ucf-head">Nueva emisión</div>

          <div className="ucf-switch">
            <span className="ucf-pill">Boleta</span>
            <span className="ucf-pill on">Factura</span>
          </div>

          <div className="ucf-field">
            <div className="ucf-lbl">Receptor</div>
            <div className="ucf-input">
              <span className="ucf-typed">76.543.210-9</span>
              <span className="auto">✓ desde el SII</span>
            </div>
          </div>

          <div className="ucf-field">
            <div className="ucf-lbl">Razón social</div>
            <div className="ucf-input"><span className="ucf-typed">Comercial Andes SpA</span></div>
          </div>

          <div className="ucf-field">
            <div className="ucf-lbl">Total</div>
            <div className="ucf-input"><span className="ucf-typed ucf-total">$120.000</span></div>
          </div>

          <div className="ucf-emit">Emitir factura</div>
        </div>

        <div className="ucf-voucher">
          <span className="vic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
          <span><span className="vt">Factura N° 961 emitida</span><span className="vs">Comercial Andes SpA · con tu folio</span></span>
          <span className="vm">$120.000</span>
        </div>
      </div>

      <ol className="ucf-steps">
        {PASOS.map((s, i) => (
          <li key={s.t} className={`ucf-step${fase === i + 1 ? " on" : ""}`}>
            <span className="ucf-n">{i + 1}</span>
            <span><b>{s.t}</b><p>{s.p}</p></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
