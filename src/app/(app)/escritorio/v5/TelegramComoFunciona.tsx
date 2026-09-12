"use client";

import { useEffect, useState } from "react";

/**
 * "Cómo funciona" del BOT DE TELEGRAM (fundador 2026-09-12): fiel a lo real —
 * le mandas una foto al @massdte_bot desde el celular, el bot la lee y deja la
 * propuesta lista en el escritorio; NO emite. Tú revisas y emites desde tu
 * computador cuando quieras. Mismo molde + pasos sincronizados. Todo de
 * mentira. Con prefers-reduced-motion queda en el final.
 */
const FASE_MS = 3300;
const TG = "#229ED9";

const PASOS = [
  { t: "Le mandas una foto al bot", p: "Al @massdte_bot, desde el celular. Una boleta, un comprobante, lo que sea." },
  { t: "La lee y deja la propuesta", p: "La clasifica sola y la deja lista en tu escritorio. El bot no emite." },
  { t: "Revisas y emites en la app", p: "Cuando llegues a tu computador, la apruebas y sale con tu clave." },
];

export default function TelegramComoFunciona() {
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
    <div className="tgf-grid" style={{ display: "grid", gridTemplateColumns: "minmax(340px, 560px) minmax(240px, 1fr)", gap: 18, alignItems: "start", minWidth: 0 }}>
      <style>{`
        .tgf-stage{position:relative;height:320px;border-radius:14px;border:1px solid var(--border);background:var(--bg);overflow:hidden;font-size:9px;color:var(--text);display:flex;gap:12px;padding:14px;align-items:stretch}
        .tgf-phone{width:52%;border-radius:14px;border:1px solid var(--border);background:var(--surface);overflow:hidden;display:flex;flex-direction:column}
        .tgf-tbar{display:flex;align-items:center;gap:8px;padding:9px 11px;color:#fff;background:${TG}}
        .tgf-tav{width:22px;height:22px;border-radius:999px;background:rgba(255,255,255,.22);display:grid;place-items:center;font-size:11px}
        .tgf-tt{font-size:9.5px;font-weight:850}
        .tgf-ts{font-size:7px;opacity:.85}
        .tgf-chat{flex:1;padding:11px;display:flex;flex-direction:column;gap:8px;background:var(--bg)}
        .tgf-msg{max-width:82%;padding:7px 9px;border-radius:12px;font-size:9px;line-height:1.4}
        .tgf-msg.me{align-self:flex-end;background:${TG};color:#fff;border-bottom-right-radius:4px}
        .tgf-msg.bot{align-self:flex-start;background:var(--surface);border:1px solid var(--border);color:var(--text);border-bottom-left-radius:4px}
        .tgf-photo{align-self:flex-end;width:120px;border-radius:12px;overflow:hidden;border:1px solid var(--border);opacity:0;transform:translateY(6px) scale(.96);transition:.4s}
        .tgf-stage[data-fase="1"] .tgf-photo,.tgf-stage[data-fase="2"] .tgf-photo,.tgf-stage[data-fase="3"] .tgf-photo{opacity:1;transform:none}
        .tgf-receipt{height:66px;background:repeating-linear-gradient(180deg,var(--surface2),var(--surface2) 6px,var(--bg-muted) 6px,var(--bg-muted) 9px);display:grid;place-items:center;color:var(--text3)}
        .tgf-cap{padding:4px 7px;font-size:7.5px;font-weight:800;color:var(--text2);background:var(--surface);display:flex;align-items:center;gap:4px}
        .tgf-botmsg{opacity:0;transform:translateY(6px);transition:.4s}
        .tgf-stage[data-fase="2"] .tgf-botmsg,.tgf-stage[data-fase="3"] .tgf-botmsg{opacity:1;transform:none;transition-delay:.3s}
        .tgf-botmsg b{color:${TG}}
        /* lado app */
        .tgf-app{flex:1;border-radius:14px;border:1px solid var(--border);background:var(--surface);padding:11px;display:flex;flex-direction:column;min-width:0}
        .tgf-app-h{font-size:7.5px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);margin-bottom:8px}
        .tgf-prop{padding:9px 10px;border-radius:10px;border:1px solid var(--border);background:var(--bg-muted);opacity:0;transform:translateY(6px);transition:.45s}
        .tgf-stage[data-fase="2"] .tgf-prop,.tgf-stage[data-fase="3"] .tgf-prop{opacity:1;transform:none;transition-delay:.5s}
        .tgf-prop .pt{font-size:9px;font-weight:800;color:var(--text)}
        .tgf-prop .ps{font-size:7.5px;color:var(--text2);margin-top:2px}
        .tgf-prop .pm{margin-top:6px;font-size:11px;font-weight:850;color:var(--text);font-variant-numeric:tabular-nums}
        .tgf-emit{margin-top:9px;padding:7px 0;border-radius:8px;text-align:center;font-size:9px;font-weight:850;color:#fff;background:var(--accent);box-shadow:0 8px 20px -6px rgba(232,85,62,.55);opacity:.4;transition:.35s}
        .tgf-stage[data-fase="3"] .tgf-emit{opacity:1}
        .tgf-note{margin-top:auto;font-size:7.5px;color:var(--text3);line-height:1.4}
        .tgf-steps{display:flex;flex-direction:column;gap:6px;list-style:none;margin:0;padding:0}
        .tgf-s{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:10px;border-radius:11px;border:1px solid transparent;transition:.35s;opacity:.55}
        .tgf-n{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;font-size:10px;font-weight:900;background:var(--bg-muted);color:var(--text2)}
        .tgf-s b{display:block;font-size:12px;font-weight:800;color:var(--text)}
        .tgf-s p{margin:2px 0 0;font-size:11px;line-height:1.45;color:var(--text2)}
        .tgf-s.on{opacity:1;border-color:rgba(232,85,62,.28);background:rgba(232,85,62,.06)}
        .tgf-s.on .tgf-n{background:var(--accent);color:#fff}
        @media (max-width:900px){.tgf-grid{grid-template-columns:1fr !important}}
        @media (prefers-reduced-motion:reduce){.tgf-photo,.tgf-botmsg,.tgf-prop,.tgf-emit,.tgf-s{transition:none}}
      `}</style>

      <div className="tgf-stage" data-fase={fase} aria-hidden>
        <div className="tgf-phone">
          <div className="tgf-tbar">
            <span className="tgf-tav">✈</span>
            <span><div className="tgf-tt">@massdte_bot</div><div className="tgf-ts">en línea</div></span>
          </div>
          <div className="tgf-chat">
            <div className="tgf-photo">
              <div className="tgf-receipt">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3h16v18l-3-2-2 2-3-2-3 2-2-2-3 2V3z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>
              </div>
              <div className="tgf-cap">📷 Boleta · foto</div>
            </div>
            <div className="tgf-msg bot tgf-botmsg">✓ Recibí tu boleta. Dejé la <b>propuesta lista</b> en tu escritorio para que la revises.</div>
          </div>
        </div>

        <div className="tgf-app">
          <div className="tgf-app-h">En tu escritorio</div>
          <div className="tgf-prop">
            <div className="pt">Propuesta desde Telegram</div>
            <div className="ps">Boleta · foto del celular · exenta</div>
            <div className="pm">$12.000</div>
          </div>
          <div className="tgf-emit">Revisar y emitir</div>
          <div className="tgf-note">El bot deja la propuesta; nunca emite solo. Tú la apruebas desde la app.</div>
        </div>
      </div>

      <ol className="tgf-steps">
        {PASOS.map((s, i) => (
          <li key={s.t} className={`tgf-s${fase === i + 1 ? " on" : ""}`}>
            <span className="tgf-n">{i + 1}</span>
            <span><b>{s.t}</b><p>{s.p}</p></span>
          </li>
        ))}
      </ol>
    </div>
  );
}
