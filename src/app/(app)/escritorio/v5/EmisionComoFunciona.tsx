"use client";

import { useEffect, useState } from "react";

/**
 * "Cómo funciona" de la EMISIÓN DESDE CARTOLA (masivo) — fundador 2026-09-12.
 * Fiel al flujo real: aprietas el botón "MassDTE Boletas", se abre el popup de
 * subir cartola, la app la procesa, y recién ahí caes en la mesa a revisar,
 * aprobar y ver los emitidos. Miniatura del escritorio con la columna izquierda
 * REAL + pasos sincronizados a la derecha. Todo de mentira. Con
 * prefers-reduced-motion queda quieto en el momento final.
 */
const FASE_MS = 3300;

const PASOS = [
  { t: "Abres MassDTE Boletas", p: "Aprietas el botón y se abre la ventana para subir tu cartola." },
  { t: "Subes la cartola", p: "Arrastras el Excel del banco. La app lee y procesa cada movimiento sola." },
  { t: "Revisas lo que propone", p: "Clasifica afecto y exento. Un vistazo, marcas el check, lo dejas en Emitir." },
  { t: "Salen en Emitidos", p: "Se emiten con tu clave y tus folios. Quedan en la pestaña Boletas." },
];

const FILAS = [
  { d: "Transferencia recibida · 18 ago", ex: true, m: "$30.000", n: 47 },
  { d: "Transferencia recibida · 18 ago", ex: true, m: "$75.000", n: 48 },
  { d: "Transferencia recibida · 19 ago", ex: false, m: "$200.000", n: 49 },
  { d: "Transferencia recibida · 19 ago", ex: true, m: "$101.000", n: 50 },
];

export default function EmisionComoFunciona() {
  const [fase, setFase] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const q = window.setTimeout(() => setFase(4), 0);
      return () => window.clearTimeout(q);
    }
    const t = window.setInterval(() => setFase((f) => (f % 4) + 1), FASE_MS);
    return () => window.clearInterval(t);
  }, []);

  const enPopup = fase === 1 || fase === 2;

  return (
    <div className="ecf-grid" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 560px) minmax(240px, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
      <style>{`
        .ecf-stage{position:relative;height:320px;border-radius:14px;border:1px solid var(--border);background:var(--bg);overflow:hidden;font-size:9px;color:var(--text)}
        .ecf-bar{position:absolute;left:0;right:0;top:0;height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--border);background:var(--surface)}
        .ecf-mark{width:14px;height:14px;border-radius:4px;background:var(--accent)}
        .ecf-mesa-lbl{font-size:7.5px;font-weight:850;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}
        .ecf-cal{margin-left:auto;display:flex;gap:2px}
        .ecf-cal i{width:7px;height:9px;border-radius:2px;background:var(--bg-muted);display:block}
        .ecf-cal i.work{background:var(--green)}
        .ecf-cal i.hoy{background:var(--lime)}
        .ecf-side{position:absolute;left:10px;top:40px;width:26%;display:flex;flex-direction:column;gap:6px}
        .ecf-card{padding:7px 8px;border-radius:9px;border:1px solid var(--border);background:var(--surface);transition:.3s}
        .ecf-card .t{font-size:8px;font-weight:850;color:var(--accent)}
        .ecf-card .s{font-size:7px;color:var(--text3);margin-top:1px}
        .ecf-use{font-variant-numeric:tabular-nums}
        /* el botón MassDTE se "aprieta" en fase 1 */
        .ecf-stage[data-fase="1"] .ecf-massdte{outline:2px solid var(--accent);outline-offset:1px;box-shadow:0 0 0 4px rgba(232,85,62,.14);transform:scale(.98)}
        .ecf-main{position:absolute;left:calc(26% + 18px);right:10px;top:40px;bottom:10px;border-radius:10px;border:1px solid var(--border);background:var(--surface);overflow:hidden}
        .ecf-tabs{display:flex;gap:6px;padding:7px 8px;border-bottom:1px solid var(--border)}
        .ecf-tab{padding:3px 8px;border-radius:999px;font-size:7.5px;font-weight:800;color:var(--text3);border:1px solid transparent;transition:.35s}
        .ecf-tab.on{background:var(--accent);color:#fff}
        .ecf-doc{display:flex;align-items:center;gap:6px;padding:7px 9px 5px;font-size:8px;font-weight:800;opacity:0;transition:.4s}
        .ecf-stage[data-fase="3"] .ecf-doc,.ecf-stage[data-fase="4"] .ecf-doc{opacity:1}
        .ecf-doc .n{color:var(--text2);font-weight:600;margin-left:auto}
        .ecf-rows{display:flex;flex-direction:column;gap:4px;padding:0 8px}
        .ecf-tx{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;background:var(--bg-muted);border:1px solid var(--border);color:var(--text2);opacity:0;transform:translateY(4px);transition:.4s}
        .ecf-tx b{color:var(--text);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .ecf-tx .m{color:var(--text);font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
        .ecf-tag{font-size:6.5px;padding:1px 5px;border-radius:999px;font-weight:800;white-space:nowrap;opacity:0;transition:.35s}
        .ecf-tag.ex{background:rgba(91,156,246,.12);color:#5b9cf6}
        .ecf-tag.af{background:rgba(232,85,62,.12);color:var(--accent)}
        .ecf-check{width:12px;height:12px;border-radius:3px;border:1px solid var(--border);display:grid;place-items:center;flex-shrink:0;transition:.25s}
        .ecf-check svg{opacity:0;transform:scale(.4);transition:.25s}
        /* mesa: filas visibles desde fase 3 */
        .ecf-stage[data-fase="3"] .ecf-tx{opacity:1;transform:none}
        .ecf-stage[data-fase="3"] .ecf-tx:nth-child(1){transition-delay:.05s}
        .ecf-stage[data-fase="3"] .ecf-tx:nth-child(2){transition-delay:.15s}
        .ecf-stage[data-fase="3"] .ecf-tx:nth-child(3){transition-delay:.25s}
        .ecf-stage[data-fase="3"] .ecf-tx:nth-child(4){transition-delay:.35s}
        .ecf-stage[data-fase="3"] .ecf-tag{opacity:1;transition-delay:.5s}
        .ecf-stage[data-fase="3"] .ecf-check{background:var(--accent);border-color:var(--accent)}
        .ecf-stage[data-fase="3"] .ecf-check svg{opacity:1;transform:scale(1);transition-delay:.9s}
        .ecf-emit{position:absolute;right:14px;bottom:12px;padding:5px 12px;border-radius:8px;background:var(--accent);color:#fff;font-size:8.5px;font-weight:850;box-shadow:0 8px 20px -6px rgba(232,85,62,.6);opacity:0;transform:translateY(6px) scale(.94);transition:.4s cubic-bezier(.34,1.56,.64,1);z-index:6}
        .ecf-stage[data-fase="3"] .ecf-emit{opacity:1;transform:none;transition-delay:1.1s}
        /* fase 4: vouchers emitidos */
        .ecf-voucher{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:9px;border:1px solid rgba(34,197,94,.25);background:rgba(34,197,94,.06);opacity:0;transform:translateY(8px) scale(.94)}
        .ecf-voucher .fol{font-size:8px;font-weight:800;color:var(--text2)}
        .ecf-voucher .ok{margin-left:auto;font-size:7.5px;font-weight:850;color:var(--green);white-space:nowrap}
        .ecf-voucher .vm{font-size:9px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums}
        .ecf-vouchers{display:none;flex-direction:column;gap:5px;padding:6px 8px}
        .ecf-stage[data-fase="4"] .ecf-vouchers{display:flex}
        .ecf-stage[data-fase="4"] .ecf-rows-wrap{display:none}
        .ecf-stage[data-fase="4"] .ecf-voucher{animation:ecfPop .5s cubic-bezier(.34,1.56,.64,1) both}
        .ecf-stage[data-fase="4"] .ecf-voucher:nth-child(1){animation-delay:.1s}
        .ecf-stage[data-fase="4"] .ecf-voucher:nth-child(2){animation-delay:.28s}
        .ecf-stage[data-fase="4"] .ecf-voucher:nth-child(3){animation-delay:.46s}
        @keyframes ecfPop{to{opacity:1;transform:none}}
        /* popup de subir cartola (fase 1-2), tapando la mesa */
        .ecf-pop{position:absolute;left:calc(26% + 18px);right:10px;top:44px;bottom:12px;border-radius:11px;border:1px solid var(--border);background:var(--surface);box-shadow:0 22px 50px -16px rgba(0,0,0,.55);z-index:8;display:flex;flex-direction:column;overflow:hidden;animation:ecfPopIn .35s cubic-bezier(.34,1.4,.5,1) both}
        @keyframes ecfPopIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
        .ecf-pop-head{display:flex;align-items:center;gap:5px;padding:7px 10px;border-bottom:1px solid var(--border);font-size:8.5px;font-weight:850}
        .ecf-pop-x{margin-left:auto;color:var(--text3);font-size:12px;line-height:1}
        .ecf-drop{flex:1;margin:9px;border-radius:10px;border:1.5px dashed var(--border);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;text-align:center;padding:10px;transition:.3s}
        .ecf-stage[data-fase="2"] .ecf-drop{border-color:rgba(232,85,62,.5);border-style:solid;background:rgba(232,85,62,.04)}
        .ecf-drop .ico{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--accent-light);color:var(--accent)}
        .ecf-drop .cap{font-size:9px;font-weight:800;color:var(--text)}
        .ecf-file{display:flex;align-items:center;gap:6px;padding:5px 9px;border-radius:8px;background:var(--surface2);border:1px solid var(--border);font-size:8.5px;font-weight:800;color:var(--text)}
        .ecf-prog{width:150px;height:5px;border-radius:99px;background:var(--bg-muted);overflow:hidden;margin-top:2px}
        .ecf-prog i{display:block;height:100%;width:0;background:linear-gradient(90deg,rgba(232,85,62,.6),var(--accent));border-radius:99px}
        .ecf-stage[data-fase="2"] .ecf-prog i{animation:ecfProg 2.6s cubic-bezier(.4,0,.2,1) forwards}
        @keyframes ecfProg{from{width:0}to{width:100%}}
        .ecf-proc{font-size:8px;color:var(--text2);font-weight:700}
        /* cursor que aprieta MassDTE en fase 1 */
        .ecf-cursor{position:absolute;left:calc(26% - 22px);top:118px;width:15px;height:15px;z-index:9;opacity:0;transition:.3s;animation:ecfTap 1.1s ease-in-out infinite}
        .ecf-stage[data-fase="1"] .ecf-cursor{opacity:1}
        @keyframes ecfTap{0%,100%{transform:translate(0,0)}45%{transform:translate(-3px,-3px)}}
        .ecf-steps{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}
        .ecf-step{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px;border-radius:11px;border:1px solid transparent;transition:.35s;opacity:.55}
        .ecf-n{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:var(--bg-muted);color:var(--text2)}
        .ecf-step b{display:block;font-size:12px;font-weight:800;color:var(--text)}
        .ecf-step p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--text2)}
        .ecf-step.on{opacity:1;border-color:rgba(232,85,62,.28);background:rgba(232,85,62,.06)}
        .ecf-step.on .ecf-n{background:var(--accent);color:#fff}
        @media (max-width:900px){.ecf-grid{grid-template-columns:1fr !important}}
        @media (prefers-reduced-motion:reduce){.ecf-tx,.ecf-tag,.ecf-check,.ecf-emit,.ecf-step,.ecf-doc,.ecf-tab,.ecf-card,.ecf-cursor{transition:none;animation:none}.ecf-pop{animation:none}.ecf-stage[data-fase="2"] .ecf-prog i{animation:none;width:100%}.ecf-stage[data-fase="4"] .ecf-voucher{animation:none;opacity:1;transform:none}}
      `}</style>

      <div className="ecf-stage" data-fase={fase} aria-hidden>
        <div className="ecf-bar">
          <span className="ecf-mark" />
          <span className="ecf-mesa-lbl">Mesa boletas</span>
          <span className="ecf-cal">{Array.from({ length: 14 }, (_, i) => <i key={i} className={i === 5 ? "hoy" : undefined} />)}</span>
        </div>

        {/* Columna izquierda REAL del escritorio (fundador 2026-09-12: los botones
            que existen de verdad, no inventados). */}
        <div className="ecf-side">
          <div className="ecf-card"><div className="t" style={{ color: "var(--text)" }}>Registro de ventas</div><div className="s">0 boletas · $0 exento</div></div>
          <div className="ecf-card ecf-massdte"><div className="t">MassDTE Boletas</div><div className="s">Subida masiva de cartolas</div></div>
          <div className="ecf-card"><div className="t" style={{ color: "var(--lime)" }}>Emitir boleta única</div><div className="s">Boleta manual, una a la vez</div></div>
          <div className="ecf-card"><div className="t" style={{ color: "var(--text)" }}>Uso del mes</div><div className="s ecf-use">{fase === 4 ? "3" : "0"} / 3.000</div></div>
        </div>

        <div className="ecf-main">
          <div className="ecf-tabs">
            <span className={`ecf-tab${fase === 3 ? " on" : ""}`}>Check</span>
            <span className="ecf-tab">Emitir</span>
            <span className={`ecf-tab${fase === 4 ? " on" : ""}`}>Boletas</span>
          </div>

          <div className="ecf-doc"><span>Cartola de agosto.xlsx</span><span className="n">{fase === 4 ? "3 emitidas" : "43 por emitir"}</span></div>

          <div className="ecf-rows-wrap">
            <div className="ecf-rows">
              {FILAS.map((f, i) => (
                <div key={i} className="ecf-tx">
                  <span className="ecf-check"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
                  <b>{f.d}</b>
                  <span className={`ecf-tag ${f.ex ? "ex" : "af"}`}>{f.ex ? "Exenta" : "Afecta"}</span>
                  <span className="m">{f.m}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="ecf-vouchers">
            {FILAS.slice(0, 3).map((f, i) => (
              <div key={i} className="ecf-voucher">
                <span className="fol">BOLETA N° {f.n}</span>
                <span className="vm">{f.m}</span>
                <span className="ok">✓ Emitida</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ecf-emit">Emitir 43</div>

        {/* popup de subir cartola: aprietas MassDTE → subes → procesa */}
        {enPopup && (
          <div className="ecf-pop">
            <div className="ecf-pop-head">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13M7 8l5-5 5 5M5 21h14" /></svg>
              Subir cartola
              <span className="ecf-pop-x">×</span>
            </div>
            <div className="ecf-drop">
              {fase === 1 ? (
                <>
                  <span className="ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v13M7 8l5-5 5 5M5 21h14" /></svg></span>
                  <span className="cap">Arrastra tu cartola del banco</span>
                  <span className="ecf-proc">Excel o PDF · la app la lee sola</span>
                </>
              ) : (
                <>
                  <span className="ecf-file">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" /></svg>
                    Cartola de agosto.xlsx
                  </span>
                  <span className="ecf-prog"><i /></span>
                  <span className="ecf-proc">Procesando 43 movimientos…</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* cursor que aprieta el botón MassDTE en fase 1 */}
        <svg className="ecf-cursor" viewBox="0 0 16 16" fill="var(--text)" stroke="var(--surface)" strokeWidth="1"><path d="M2 2l5 12 2-5 5-2z" /></svg>
      </div>

      <ol className="ecf-steps">
        {PASOS.map((s, i) => (
          <li key={s.t} className={`ecf-step${fase === i + 1 ? " on" : ""}`}>
            <span className="ecf-n">{i + 1}</span>
            <span><b>{s.t}</b><p>{s.p}</p></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
