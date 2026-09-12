"use client";

import { useEffect, useState } from "react";

/**
 * "Cómo funciona" del CONMUTADOR DE MESA (fundador 2026-09-12, 3ª vuelta):
 * MISMA base limpia que la mesa de cartola —columna izquierda real + mesa con
 * pestañas— para que se vea ordenado. Lo único distinto: el mouse aprieta el
 * ÍCONO de la empresa y se abre el DESPLEGABLE con BO|FA (como en la app real,
 * EmpresaBrand); al elegir Factura, la mesa cambia entera. Sin barritas verdes
 * cargadas ni barras en las filas: limpio. Todo de mentira. Con
 * prefers-reduced-motion queda en el final.
 */
const FASE_MS = 3200;

const PASOS = [
  { t: "Aprietas el ícono", p: "El de tu empresa, arriba a la izquierda. Se abre el desplegable." },
  { t: "Eliges BO o FA", p: "Boleta o Factura. Un clic y cambias de mesa." },
  { t: "Cambia la mesa entera", p: "Sus filas, su plantilla y su cupo. Cada mesa es la suya." },
];

const BOLETAS = [
  { d: "Transferencia recibida · 18 ago", ex: true, m: "$30.000" },
  { d: "Transferencia recibida · 18 ago", ex: true, m: "$75.000" },
  { d: "Transferencia recibida · 19 ago", ex: false, m: "$200.000" },
  { d: "Transferencia recibida · 19 ago", ex: true, m: "$101.000" },
];
const FACTURAS = [
  { d: "Factura a Comercial Andes SpA", m: "$450.000" },
  { d: "Factura a Servicios del Sur Ltda", m: "$1.200.000" },
  { d: "Factura a Importadora Norte SpA", m: "$780.000" },
];

export default function MesaBoletaFacturaComoFunciona() {
  const [fase, setFase] = useState(1);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const q = window.setTimeout(() => setFase(3), 0);
      return () => window.clearTimeout(q);
    }
    const t = window.setInterval(() => setFase((f) => (f % 3) + 1), FASE_MS);
    return () => window.clearInterval(t);
  }, []);

  const enFactura = fase >= 2;
  const abierto = fase === 1 || fase === 2;

  return (
    <div className="bof-grid" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 560px) minmax(240px, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
      <style>{`
        .bof-stage{position:relative;height:320px;border-radius:14px;border:1px solid var(--border);background:var(--bg);overflow:hidden;font-size:9px;color:var(--text)}
        .bof-bar{position:absolute;left:0;right:0;top:0;height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--border);background:var(--surface);z-index:6}
        .bof-trigger{display:flex;align-items:center;gap:6px;padding:2px 6px;border-radius:7px;border:1px solid transparent;transition:.25s}
        .bof-stage[data-fase="1"] .bof-trigger{border-color:var(--border);background:var(--bg-muted)}
        .bof-mark{width:14px;height:14px;border-radius:4px;background:var(--accent);flex-shrink:0}
        .bof-mesa-lbl{font-size:7.5px;font-weight:850;letter-spacing:.07em;text-transform:uppercase;color:var(--text3)}
        .bof-chev{color:var(--text3);transition:transform .3s}
        .bof-stage[data-fase="1"] .bof-chev,.bof-stage[data-fase="2"] .bof-chev{transform:rotate(180deg)}
        .bof-cal{margin-left:auto;display:flex;gap:2px}
        .bof-cal i{width:7px;height:9px;border-radius:2px;background:var(--bg-muted);display:block}
        .bof-cal i.work{background:var(--green)}
        .bof-cal i.hoy{background:var(--lime)}
        .bof-side{position:absolute;left:10px;top:40px;width:26%;display:flex;flex-direction:column;gap:6px}
        .bof-card{padding:7px 8px;border-radius:9px;border:1px solid var(--border);background:var(--surface)}
        .bof-card .t{font-size:8px;font-weight:850}
        .bof-card .s{font-size:7px;color:var(--text3);margin-top:1px}
        .bof-main{position:absolute;left:calc(26% + 18px);right:10px;top:40px;bottom:10px;border-radius:10px;border:1px solid var(--border);background:var(--surface);overflow:hidden}
        .bof-tabs{display:flex;gap:6px;padding:7px 8px;border-bottom:1px solid var(--border)}
        .bof-tab{padding:3px 8px;border-radius:999px;font-size:7.5px;font-weight:800;color:var(--text3);border:1px solid transparent}
        .bof-tab.on{background:var(--accent);color:#fff}
        .bof-doc{display:flex;align-items:center;gap:6px;padding:7px 9px 5px;font-size:8px;font-weight:800}
        .bof-doc .n{color:var(--text2);font-weight:600;margin-left:auto}
        .bof-rows{display:flex;flex-direction:column;gap:4px;padding:0 8px}
        .bof-tx{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:5px 8px;border-radius:7px;background:var(--bg-muted);border:1px solid var(--border);color:var(--text2);animation:bofFade .35s ease both}
        .bof-tx b{color:var(--text);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .bof-tx .m{color:var(--text);font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
        .bof-chk{width:12px;height:12px;border-radius:3px;background:var(--accent);flex-shrink:0}
        .bof-tag{font-size:6.5px;padding:1px 5px;border-radius:999px;font-weight:800;white-space:nowrap}
        .bof-tag.ex{background:rgba(91,156,246,.12);color:#5b9cf6}
        .bof-tag.af{background:rgba(232,85,62,.12);color:var(--accent)}
        .bof-tag.afl{background:rgba(180,240,39,.14);color:var(--lime)}
        @keyframes bofFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        /* desplegable BO|FA desde el ícono */
        .bof-dd{position:absolute;left:10px;top:36px;width:150px;border-radius:11px;border:1px solid var(--border);background:var(--surface);box-shadow:0 20px 44px -14px rgba(0,0,0,.5);z-index:8;padding:7px;animation:bofDd .26s cubic-bezier(.34,1.4,.5,1) both}
        @keyframes bofDd{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:none}}
        .bof-dd-h{font-size:7px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);padding:2px 6px 6px}
        .bof-opt{display:flex;align-items:center;gap:8px;padding:6px 7px;border-radius:8px;font-weight:850;font-size:9px;color:var(--text2)}
        .bof-opt .sig{width:20px;height:18px;border-radius:5px;display:grid;place-items:center;font-size:8px;font-weight:900;background:var(--bg-muted);color:var(--text3)}
        .bof-opt .chk{margin-left:auto;opacity:0}
        .bof-opt.sel.bo{color:var(--accent);background:var(--accent-light)}.bof-opt.sel.bo .sig{background:var(--accent);color:#fff}
        .bof-opt.sel.fa{color:var(--lime);background:rgba(180,240,39,.1)}.bof-opt.sel.fa .sig{background:var(--lime);color:#0f1014}
        .bof-opt.sel .chk{opacity:1}
        .bof-cur{position:absolute;width:14px;height:14px;z-index:9;transition:left .4s cubic-bezier(.4,0,.2,1),top .4s cubic-bezier(.4,0,.2,1),opacity .3s;opacity:0}
        .bof-stage[data-fase="1"] .bof-cur{opacity:1;left:40px;top:22px}
        .bof-stage[data-fase="2"] .bof-cur{opacity:1;left:96px;top:86px}
        .bof-steps{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}
        .bof-s{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px;border-radius:11px;border:1px solid transparent;transition:.35s;opacity:.55}
        .bof-n{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:var(--bg-muted);color:var(--text2)}
        .bof-s b{display:block;font-size:12px;font-weight:800;color:var(--text)}
        .bof-s p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--text2)}
        .bof-s.on{opacity:1;border-color:rgba(232,85,62,.28);background:rgba(232,85,62,.06)}
        .bof-s.on .bof-n{background:var(--accent);color:#fff}
        @media (max-width:900px){.bof-grid{grid-template-columns:1fr !important}}
        @media (prefers-reduced-motion:reduce){.bof-trigger,.bof-chev,.bof-cur,.bof-tx{transition:none;animation:none}.bof-dd{animation:none}}
      `}</style>

      <div className="bof-stage" data-fase={fase} aria-hidden>
        <div className="bof-bar">
          <div className="bof-trigger">
            <span className="bof-mark" />
            <span className="bof-mesa-lbl">{enFactura ? "Mesa facturas" : "Mesa boletas"}</span>
            <svg className="bof-chev" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </div>
          <span className="bof-cal">
            {Array.from({ length: 14 }, (_, i) => <i key={i} className={i === 5 ? "hoy" : undefined} />)}
          </span>
        </div>

        <div className="bof-side">
          <div className="bof-card"><div className="t" style={{ color: "var(--text)" }}>Registro de ventas</div><div className="s">0 boletas · $0 exento</div></div>
          <div className="bof-card"><div className="t" style={{ color: "var(--accent)" }}>MassDTE Boletas</div><div className="s">Subida masiva de cartolas</div></div>
          <div className="bof-card"><div className="t" style={{ color: "var(--lime)" }}>Emitir boleta única</div><div className="s">Boleta manual, una a la vez</div></div>
          <div className="bof-card"><div className="t" style={{ color: "var(--text)" }}>Uso del mes</div><div className="s">0 / 3.000</div></div>
        </div>

        <div className="bof-main">
          <div className="bof-tabs">
            <span className="bof-tab on">Check</span>
            <span className="bof-tab">Emitir</span>
            <span className="bof-tab">{enFactura ? "Facturas" : "Boletas"}</span>
          </div>
          <div className="bof-doc"><span>{enFactura ? "Plantilla de facturas.xlsx" : "Cartola de agosto.xlsx"}</span><span className="n">{enFactura ? "3 por emitir" : "43 por emitir"}</span></div>
          <div className="bof-rows" key={enFactura ? "fa" : "bo"}>
            {enFactura
              ? FACTURAS.map((f, i) => (
                <div key={i} className="bof-tx" style={{ animationDelay: `${i * 0.06}s` }}>
                  <span className="bof-chk" style={{ background: "var(--lime)" }} />
                  <b>{f.d}</b>
                  <span className="bof-tag afl">Afecta</span>
                  <span className="m">{f.m}</span>
                </div>
              ))
              : BOLETAS.map((f, i) => (
                <div key={i} className="bof-tx" style={{ animationDelay: `${i * 0.06}s` }}>
                  <span className="bof-chk" />
                  <b>{f.d}</b>
                  <span className={`bof-tag ${f.ex ? "ex" : "af"}`}>{f.ex ? "Exenta" : "Afecta"}</span>
                  <span className="m">{f.m}</span>
                </div>
              ))}
          </div>
        </div>

        {abierto && (
          <div className="bof-dd">
            <div className="bof-dd-h">Mesa activa</div>
            <div className={`bof-opt bo${!enFactura ? " sel" : ""}`}>
              <span className="sig">BO</span> Boleta
              <span className="chk"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
            </div>
            <div className={`bof-opt fa${enFactura ? " sel" : ""}`}>
              <span className="sig">FA</span> Factura
              <span className="chk"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span>
            </div>
          </div>
        )}

        <svg className="bof-cur" viewBox="0 0 16 16" fill="var(--text)" stroke="var(--surface)" strokeWidth="1"><path d="M2 2l5 12 2-5 5-2z" /></svg>
      </div>

      <ol className="bof-steps">
        {PASOS.map((s, i) => (
          <li key={s.t} className={`bof-s${fase === i + 1 ? " on" : ""}`}>
            <span className="bof-n">{i + 1}</span>
            <span><b>{s.t}</b><p>{s.p}</p></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
