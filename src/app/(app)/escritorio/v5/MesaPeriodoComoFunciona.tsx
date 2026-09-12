"use client";

import { useEffect, useState } from "react";

/**
 * "Cómo funciona" de la MESA POR PERÍODO (fundador 2026-09-12): fiel al real —
 * el botón lime "Mesa de trabajo del día / de la semana / del mes" (CalendarStrip)
 * que cicla, y la tira de días que resalta el rango. Sirve para ir al día o
 * cuadrar el mes. Mismo molde + pasos sincronizados. Todo de mentira. Con
 * prefers-reduced-motion queda en el final.
 */
const FASE_MS = 3000;

const PASOS = [
  { t: "El botón «Mesa del día»", p: "Arriba, en lime. Dice “Mesa de trabajo del día” y ahí eliges el rango." },
  { t: "Lo aprietas → semana", p: "Un clic y la mesa pasa a mostrarte la semana completa." },
  { t: "Otro clic → mes", p: "Otra vez y ves todo el mes junto, para cuadrar." },
];

const MODO = ["del día", "de la semana", "del mes"];
const DIAS = Array.from({ length: 14 }, (_, i) => i + 1); // días 1..14
const LETRA = ["L", "M", "X", "J", "V", "S", "D"];
const SEL = 6; // día seleccionado

export default function MesaPeriodoComoFunciona() {
  const [fase, setFase] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const q = window.setTimeout(() => setFase(3), 0);
      return () => window.clearTimeout(q);
    }
    const t = window.setInterval(() => setFase((f) => (f % 3) + 1), FASE_MS);
    return () => window.clearInterval(t);
  }, []);

  const activo = (d: number) =>
    fase === 1 ? d === SEL : fase === 2 ? d >= 4 && d <= 10 : true;
  const enVista = fase === 1 ? 6 : fase === 2 ? 34 : 128;

  return (
    <div className="per-grid" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 560px) minmax(240px, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
      <style>{`
        .per-stage{position:relative;height:320px;border-radius:14px;border:1px solid var(--border);background:var(--bg);overflow:hidden;font-size:9px;color:var(--text)}
        .per-bar{position:absolute;left:0;right:0;top:0;height:44px;display:flex;align-items:center;gap:9px;padding:0 11px;border-bottom:1px solid var(--border);background:var(--surface)}
        .per-logo{width:18px;height:18px;border-radius:5px;background:var(--accent);flex-shrink:0}
        .per-mode{display:flex;flex-direction:column;align-items:center;gap:1px;padding:4px 8px;border-radius:7px;color:var(--lime);border:1px dashed var(--lime);background:transparent;font-size:8px;font-weight:800;line-height:1.1;white-space:nowrap;flex-shrink:0;transition:.3s}
        .per-stage[data-fase="1"] .per-mode{border-style:solid}
        .per-mode .top{font-size:7px;opacity:.85}
        .per-strip{margin-left:6px;display:flex;gap:2.5px;overflow:hidden}
        .per-day{width:15px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1px;padding:3px 0;border-radius:5px;background:var(--bg-muted);border:1px solid transparent;transition:.3s}
        .per-day .wd{font-size:5px;text-transform:uppercase;color:var(--text3)}
        .per-day .nm{font-size:8px;font-weight:700;color:var(--text2)}
        .per-day.on{background:var(--accent);border-color:var(--accent)}
        .per-day.on .wd{color:color-mix(in srgb,var(--bg) 50%,transparent)}
        .per-day.on .nm{color:#fff}
        .per-day.hoy .nm{color:var(--accent)}
        .per-day.on.hoy .nm{color:#fff}
        .per-cur{position:absolute;left:78px;top:38px;width:14px;height:14px;z-index:6;opacity:0;transition:.3s}
        .per-stage:not([data-fase="1"]) .per-cur{opacity:0}
        .per-stage .per-cur{animation:perTap 1s ease-in-out infinite}
        @keyframes perTap{0%,100%{transform:translate(0,0)}45%{transform:translate(-2px,-2px)}}
        .per-body{position:absolute;left:11px;right:11px;top:54px;bottom:11px;border-radius:11px;border:1px solid var(--border);background:var(--surface);overflow:hidden;display:flex;flex-direction:column}
        .per-bh{display:flex;align-items:center;gap:7px;padding:8px 11px;border-bottom:1px solid var(--border);font-size:9px;font-weight:850}
        .per-bh .cnt{margin-left:auto;font-size:8px;font-weight:800;color:var(--text2);font-variant-numeric:tabular-nums}
        .per-list{flex:1;padding:9px 11px;display:flex;flex-direction:column;gap:5px;overflow:hidden}
        .per-row{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;background:var(--bg-muted);border:1px solid var(--border);color:var(--text2);font-size:8.5px;animation:perFade .35s ease both}
        .per-row b{color:var(--text);font-weight:700}
        .per-row .m{margin-left:auto;color:var(--text);font-weight:850;font-variant-numeric:tabular-nums}
        @keyframes perFade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
        .per-steps{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}
        .per-s{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px;border-radius:11px;border:1px solid transparent;transition:.35s;opacity:.55}
        .per-n{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:var(--bg-muted);color:var(--text2)}
        .per-s b{display:block;font-size:12px;font-weight:800;color:var(--text)}
        .per-s p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--text2)}
        .per-s.on{opacity:1;border-color:rgba(232,85,62,.28);background:rgba(232,85,62,.06)}
        .per-s.on .per-n{background:var(--accent);color:#fff}
        @media (max-width:900px){.per-grid{grid-template-columns:1fr !important}}
        @media (prefers-reduced-motion:reduce){.per-mode,.per-day,.per-cur,.per-row{transition:none;animation:none}}
      `}</style>

      <div className="per-stage" data-fase={fase} aria-hidden>
        <div className="per-bar">
          <span className="per-logo" />
          <span className="per-mode"><span className="top">Mesa de trabajo</span><span>{MODO[fase - 1]}</span></span>
          <div className="per-strip">
            {DIAS.map((d) => (
              <span key={d} className={`per-day${activo(d) ? " on" : ""}${d === SEL ? " hoy" : ""}`}>
                <span className="wd">{LETRA[(d - 1) % 7]}</span>
                <span className="nm">{d}</span>
              </span>
            ))}
          </div>
        </div>

        <svg className="per-cur" viewBox="0 0 16 16" fill="var(--text)" stroke="var(--surface)" strokeWidth="1"><path d="M2 2l5 12 2-5 5-2z" /></svg>

        <div className="per-body">
          <div className="per-bh">Mesa Boletas · {MODO[fase - 1]}<span className="cnt">{enVista} movimientos</span></div>
          <div className="per-list" key={fase}>
            {[
              { d: "Transferencia · exenta", m: "$75.000" },
              { d: "Transferencia · exenta", m: "$200.000" },
              { d: "Transferencia · afecta", m: "$120.000" },
              { d: "Transferencia · exenta", m: "$54.000" },
            ].slice(0, fase === 1 ? 2 : 4).map((r, i) => (
              <div key={i} className="per-row" style={{ animationDelay: `${i * 0.06}s` }}>
                <b>{r.d}</b><span className="m">{r.m}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ol className="per-steps">
        {PASOS.map((s, i) => (
          <li key={s.t} className={`per-s${fase === i + 1 ? " on" : ""}`}>
            <span className="per-n">{i + 1}</span>
            <span><b>{s.t}</b><p>{s.p}</p></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
