"use client";

import { useEffect, useState } from "react";

/**
 * "Cómo funciona" del paso Team (fundador 2026-09-07): una miniatura FIEL del
 * escritorio —barra con la mesa y el calendario, columna izquierda con sus
 * tarjetas, pestañas Check · Emitir · Boletas, la cartola con sus filas y el
 * globito— que corre en bucle cuatro momentos: agregas a Persona 2 → te
 * escribe → apuntas un movimiento → Persona 2 salta justo ahí. Sin nombres
 * reales: Persona 1 eres tú, Persona 2 es quien invitas. Todo de mentira.
 * Con prefers-reduced-motion se queda quieto en el momento final.
 */
const FASE_MS = 3400;

const PASOS = [
  { t: "Agrega a tu team", p: "Marca qué empresas ve cada persona. Sin tick, no ve nada de esa empresa." },
  { t: "Te escriben en el globito", p: "Un satélite con su color aparece cuando alguien te habla. Tócalo y se abre ahí mismo." },
  { t: "Apunta lo que quieras", p: "El clip congela la pantalla: toca una cartola, un movimiento o una boleta y viaja con el mensaje." },
  { t: "La otra persona salta justo ahí", p: "Le pide permiso, la lleva al mes y a la pestaña, y le resalta la fila." },
];

export default function TeamComoFunciona() {
  const [fase, setFase] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const q = window.setTimeout(() => setFase(4), 0);
      return () => window.clearTimeout(q);
    }
    const t = window.setInterval(() => setFase((f) => (f % 4) + 1), FASE_MS);
    return () => window.clearInterval(t);
  }, []);

  const deP2 = fase < 4; // la burbuja es de Persona 2 hasta el salto; en el 4 se ve desde SU pantalla

  return (
    <div className="tcf-grid" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 560px) minmax(240px, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
      <style>{`
        .tcf-stage{position:relative;height:320px;border-radius:14px;border:1px solid var(--border);background:var(--bg);overflow:hidden;font-size:9px;color:var(--text)}
        .tcf-bar{position:absolute;left:0;right:0;top:0;height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--border);background:var(--surface)}
        .tcf-mark{width:14px;height:14px;border-radius:4px;background:var(--accent)}
        .tcf-mesa-lbl{font-size:7.5px;font-weight:850;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}
        .tcf-cal{margin-left:auto;display:flex;gap:2px}
        .tcf-cal i{width:7px;height:9px;border-radius:2px;background:var(--bg-muted);display:block}
        .tcf-cal i.hoy{background:#b4f027}
        .tcf-side{position:absolute;left:10px;top:40px;width:26%;display:flex;flex-direction:column;gap:6px}
        .tcf-card{padding:7px 8px;border-radius:9px;border:1px solid var(--border);background:var(--surface)}
        .tcf-card .t{font-size:8px;font-weight:850;color:var(--accent)}
        .tcf-card .s{font-size:7px;color:var(--text3);margin-top:1px}
        .tcf-card.eq .t{color:var(--text)}
        .tcf-avs{display:flex;gap:4px;margin-top:5px}
        .tcf-av{width:16px;height:16px;border-radius:999px;display:grid;place-items:center;font-size:6.5px;font-weight:900;background:var(--bg-muted);color:var(--text2);border:1px solid var(--border);position:relative}
        .tcf-av.me{background:rgba(232,85,62,.14);color:var(--accent);border-color:rgba(232,85,62,.28)}
        .tcf-av.p2{background:#9B6BFF;color:#fff;border-color:transparent;opacity:0;transform:scale(.3);transition:.4s cubic-bezier(.34,1.56,.64,1)}
        .tcf-stage[data-fase="1"] .tcf-av.p2,.tcf-stage[data-fase="2"] .tcf-av.p2,.tcf-stage[data-fase="3"] .tcf-av.p2,.tcf-stage[data-fase="4"] .tcf-av.p2{opacity:1;transform:none}
        .tcf-stage[data-fase="1"] .tcf-av.p2{transition-delay:.6s}
        .tcf-main{position:absolute;left:calc(26% + 18px);right:10px;top:40px;bottom:10px;border-radius:10px;border:1px solid var(--border);background:var(--surface);overflow:hidden}
        .tcf-tabs{display:flex;gap:6px;padding:7px 8px;border-bottom:1px solid var(--border)}
        .tcf-tab{padding:3px 8px;border-radius:999px;font-size:7.5px;font-weight:800;color:var(--text3);border:1px solid transparent}
        .tcf-tab.on{background:var(--accent);color:#fff}
        .tcf-doc{display:flex;align-items:center;gap:6px;padding:7px 9px 5px;font-size:8px;font-weight:800}
        .tcf-doc .n{color:var(--text2);font-weight:600;margin-left:auto}
        .tcf-rows{display:flex;flex-direction:column;gap:4px;padding:0 8px}
        .tcf-tx{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;background:var(--bg-muted);border:1px solid var(--border);color:var(--text2);transition:.35s;outline:2px solid transparent;outline-offset:2px}
        .tcf-tx b{color:var(--text);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .tcf-tx .m{color:var(--text);font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
        .tcf-tx .ex{font-size:6.5px;padding:1px 5px;border-radius:999px;background:rgba(91,156,246,.12);color:#5b9cf6;font-weight:800;white-space:nowrap}
        .tcf-veil{position:absolute;inset:0;background:rgba(8,9,12,.5);opacity:0;transition:opacity .4s}
        .tcf-hint{position:absolute;top:38px;left:50%;transform:translateX(-50%) translateY(-6px);padding:5px 11px;border-radius:999px;background:var(--surface);border:1px solid rgba(232,85,62,.45);font-size:8.5px;font-weight:750;white-space:nowrap;opacity:0;transition:.35s;color:var(--text);z-index:3}
        .tcf-hint b{color:var(--accent)}
        .tcf-cur{position:absolute;width:14px;height:14px;left:calc(26% + 150px);top:118px;opacity:0;transition:opacity .3s;z-index:3}
        .tcf-team{position:absolute;left:10px;top:34px;width:164px;padding:7px 8px 8px;border-radius:10px;background:var(--surface);border:1px solid var(--border);box-shadow:0 16px 40px -12px rgba(0,0,0,.6);opacity:0;transform:translateY(6px) scale(.96);transition:.35s;z-index:2}
        .tcf-team .eb{font-size:7px;font-weight:850;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px}
        .tcf-trow{display:grid;grid-template-columns:16px 1fr auto;align-items:center;gap:6px;padding:3px 0;font-size:8px}
        .tcf-trow .nm{font-weight:800}.tcf-trow .sb{font-size:7px;color:var(--text2)}
        .tcf-tick{width:12px;height:12px;border-radius:3px;border:1px solid var(--border);display:grid;place-items:center;transition:.25s}
        .tcf-tick svg{opacity:0;transform:scale(.4);transition:.25s}
        .tcf-tadd{margin-top:3px;padding:4px 6px;border-radius:6px;border:1px dashed var(--border);font-size:7.5px;font-weight:800;color:var(--text2)}
        .tcf-stage[data-fase="1"] .tcf-team{opacity:1;transform:none}
        .tcf-stage[data-fase="1"] .tcf-trow.nueva{animation:tcfPop .5s .7s cubic-bezier(.34,1.56,.64,1) both}
        .tcf-stage[data-fase="1"] .tcf-trow.nueva .tcf-tick{transition-delay:1.6s;background:var(--accent);border-color:var(--accent)}
        .tcf-stage[data-fase="1"] .tcf-trow.nueva .tcf-tick svg{transition-delay:1.65s;opacity:1;transform:scale(1)}
        @keyframes tcfPop{from{opacity:0;transform:translateY(6px) scale(.9)}to{opacity:1;transform:none}}
        .tcf-orb{position:absolute;right:18px;bottom:18px;width:38px;height:38px;border-radius:50%;background:var(--surface2);border:1px solid var(--border);display:grid;place-items:center;color:var(--amber);box-shadow:0 0 0 5px rgba(245,158,11,.13);z-index:4}
        .tcf-badge{position:absolute;top:-4px;right:-4px;min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:var(--amber);color:#0f1014;font-size:8.5px;font-weight:700;display:grid;place-items:center;border:2px solid var(--surface)}
        .tcf-sat{position:absolute;width:16px;height:16px;border-radius:50%;background:#9B6BFF;color:#fff;font-size:7px;font-weight:900;display:grid;place-items:center;border:2px solid var(--surface);left:-5px;top:-7px;transform:scale(0);transition:transform .45s cubic-bezier(.34,1.56,.64,1)}
        .tcf-bub{position:absolute;right:14px;bottom:64px;width:190px;padding:8px 9px;border-radius:12px;background:var(--surface2);border:1px solid var(--border);box-shadow:0 16px 44px -12px rgba(0,0,0,.6);opacity:0;transform:translateY(6px) scale(.96);transition:.35s;font-size:8.5px;color:var(--text);z-index:4}
        .tcf-top{display:flex;align-items:center;gap:6px;margin-bottom:6px}
        .tcf-bav{width:18px;height:18px;border-radius:6px;color:#fff;font-size:7px;font-weight:900;display:grid;place-items:center}
        .tcf-msg{padding:5px 7px;border-radius:8px;background:var(--bg-muted);line-height:1.35}
        .tcf-msg.mio{background:rgba(232,85,62,.12);margin-top:5px}
        .tcf-chip{display:inline-flex;align-items:center;gap:4px;margin-top:4px;padding:2px 6px;border-radius:6px;border:1px solid rgba(232,85,62,.45);font-size:7.5px;font-weight:700;color:var(--accent);background:rgba(232,85,62,.07);max-width:100%}
        .tcf-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .tcf-stage[data-fase="2"] .tcf-sat{transform:scale(1)}
        .tcf-stage[data-fase="2"] .tcf-bub,.tcf-stage[data-fase="3"] .tcf-bub,.tcf-stage[data-fase="4"] .tcf-bub{opacity:1;transform:none}
        .tcf-stage[data-fase="3"] .tcf-veil{opacity:1}
        .tcf-stage[data-fase="3"] .tcf-hint{opacity:1;transform:translateX(-50%)}
        .tcf-stage[data-fase="3"] .tcf-cur{opacity:1}
        .tcf-stage[data-fase="3"] .tcf-tx{outline:1px dashed rgba(232,85,62,.55);position:relative;z-index:2}
        .tcf-stage[data-fase="3"] .tcf-tx:nth-child(2){outline:2px solid var(--accent);box-shadow:0 0 0 5px rgba(232,85,62,.16)}
        .tcf-stage[data-fase="4"] .tcf-tx:nth-child(2){outline:2px solid var(--accent);animation:tcfHalo 2.4s ease-out both}
        @keyframes tcfHalo{0%{box-shadow:0 0 0 12px rgba(232,85,62,.28)}100%{box-shadow:0 0 0 0 rgba(232,85,62,0)}}
        .tcf-who{position:absolute;left:10px;bottom:10px;font-size:7.5px;font-weight:850;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}
        .tcf-who b{color:var(--text2)}
        .tcf-steps{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}
        .tcf-step{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px;border-radius:11px;border:1px solid transparent;transition:.35s;opacity:.55}
        .tcf-n{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:var(--bg-muted);color:var(--text2)}
        .tcf-step b{display:block;font-size:12px;font-weight:800;color:var(--text)}
        .tcf-step p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--text2)}
        .tcf-step.on{opacity:1;border-color:rgba(232,85,62,.28);background:rgba(232,85,62,.06)}
        .tcf-step.on .tcf-n{background:var(--accent);color:#fff}
        @media (max-width:900px){.tcf-grid{grid-template-columns:1fr !important}}
        @media (prefers-reduced-motion:reduce){.tcf-sat,.tcf-bub,.tcf-veil,.tcf-hint,.tcf-tx,.tcf-step,.tcf-team,.tcf-av.p2{transition:none}.tcf-stage[data-fase="4"] .tcf-tx:nth-child(2){animation:none}.tcf-stage[data-fase="1"] .tcf-trow.nueva{animation:none}}
      `}</style>

      <div className="tcf-stage" data-fase={fase} aria-hidden>
        <div className="tcf-bar">
          <span className="tcf-mark" />
          <span className="tcf-mesa-lbl">Mesa boletas</span>
          <span className="tcf-cal">{Array.from({ length: 14 }, (_, i) => <i key={i} className={i === 5 ? "hoy" : undefined} />)}</span>
        </div>

        <div className="tcf-side">
          <div className="tcf-card"><div className="t">MassDTE Boletas</div><div className="s">Subida masiva de cartolas</div></div>
          <div className="tcf-card eq">
            <div className="t">Equipo</div>
            <div className="tcf-avs">
              <span className="tcf-av me">P1</span>
              <span className="tcf-av p2">P2</span>
            </div>
          </div>
          <div className="tcf-card"><div className="t" style={{ color: "var(--text)" }}>Uso del mes</div><div className="s">0 / 3.000 boletas</div></div>
        </div>

        <div className="tcf-main">
          <div className="tcf-tabs"><span className="tcf-tab">Check</span><span className="tcf-tab on">Emitir</span><span className="tcf-tab">Boletas</span></div>
          <div className="tcf-doc"><span>Cartola de agosto.xlsx</span><span className="n">43 por emitir</span></div>
          <div className="tcf-rows">
            <div className="tcf-tx"><b>Transferencia recibida · 18 ago</b><span className="ex">Exenta</span><span className="m">$30.000</span></div>
            <div className="tcf-tx"><b>Transferencia recibida · 18 ago</b><span className="ex">Exenta</span><span className="m">$75.000</span></div>
            <div className="tcf-tx"><b>Transferencia recibida · 19 ago</b><span className="ex">Exenta</span><span className="m">$200.000</span></div>
            <div className="tcf-tx"><b>Transferencia recibida · 19 ago</b><span className="ex">Exenta</span><span className="m">$101.000</span></div>
          </div>
        </div>

        <div className="tcf-team">
          <div className="eb">Tu empresa · y mesa</div>
          <div className="tcf-trow" style={{ padding: "3px 4px", borderRadius: 6, border: "1px solid rgba(232,85,62,.22)", background: "rgba(232,85,62,.09)", marginBottom: 6 }}><span className="tcf-av me" style={{ borderRadius: 5 }}>MI</span><span><div className="nm">Mi empresa SpA</div><div className="sb">77.123.456-7</div></span><span style={{ fontSize: 6.5, fontWeight: 900, color: "var(--accent)" }}>BO</span></div>
          <div className="eb">Team · 2 de 3</div>
          <div className="tcf-trow"><span className="tcf-av me">P1</span><span><div className="nm">Persona 1 (tú)</div><div className="sb">Titular · ve todo</div></span><span /></div>
          <div className="tcf-trow nueva"><span className="tcf-av" style={{ background: "#9B6BFF", color: "#fff", borderColor: "transparent" }}>P2</span><span><div className="nm">Persona 2</div><div className="sb">Ve tu empresa</div></span><span className="tcf-tick"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span></div>
          <div className="tcf-tadd">+ Agregar alguien al team</div>
        </div>

        <div className="tcf-veil" />
        <div className="tcf-hint">Toca lo que quieres que vea <b>Persona 2</b> · Esc para salir</div>
        <svg className="tcf-cur" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.6"><path d="M8 1v14M1 8h14" /><circle cx="8" cy="8" r="3" stroke="var(--accent)" /></svg>

        <div className="tcf-bub">
          <div className="tcf-top">
            <span className="tcf-bav" style={{ background: deP2 ? "#9B6BFF" : "#5B8DEF" }}>{deP2 ? "P2" : "P1"}</span>
            <b style={{ fontSize: 9 }}>{deP2 ? "Persona 2" : "Persona 1"}</b>
          </div>
          <div className="tcf-msg">{deP2 ? "¿Reviso la cartola de agosto?" : "Sí, mírala y déjala en Emitir."}</div>
          {fase === 4 && (
            <div className="tcf-msg mio">Mira esta transferencia, ¿la dejamos exenta?<div className="tcf-chip"><span>↗ Transferencia · 18 ago · $75.000</span></div></div>
          )}
          {fase === 3 && <div className="tcf-chip"><span>Apuntando: Transferencia · 18 ago · $75.000</span></div>}
        </div>

        <div className="tcf-orb">
          <span className="tcf-badge">43</span>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.2c.62 0 1.2.33 1.5.87l7.4 13.1c.6 1.06-.16 2.38-1.5 2.38H4.6c-1.34 0-2.1-1.32-1.5-2.38l7.4-13.1c.3-.54.88-.87 1.5-.87z" /><path d="M12 9.4v4.1" /><circle cx="12" cy="16.7" r=".95" fill="currentColor" stroke="none" /></svg>
          <span className="tcf-sat">P2</span>
        </div>

        <div className="tcf-who">{fase === 4 ? <>Pantalla de <b>Persona 2</b></> : <>Tu pantalla · <b>Persona 1</b></>}</div>
      </div>

      <ol className="tcf-steps">
        {PASOS.map((s, i) => (
          <li key={s.t} className={`tcf-step${fase === i + 1 ? " on" : ""}`}>
            <span className="tcf-n">{i + 1}</span>
            <span><b>{s.t}</b><p>{s.p}</p></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
