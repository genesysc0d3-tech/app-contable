"use client";

import { useEffect, useState, type ComponentType } from "react";
import EmisionComoFunciona from "./EmisionComoFunciona";
import UnicaComoFunciona from "./UnicaComoFunciona";
import MesaBoletaFacturaComoFunciona from "./MesaBoletaFacturaComoFunciona";
import MesaPeriodoComoFunciona from "./MesaPeriodoComoFunciona";
import ConfigurarEmpresaComoFunciona from "./ConfigurarEmpresaComoFunciona";
import McpComoFunciona from "./McpComoFunciona";
import TelegramComoFunciona from "./TelegramComoFunciona";
import MultiempresaComoFunciona from "./MultiempresaComoFunciona";
import TeamComoFunciona from "./TeamComoFunciona";
import { LogoMcp } from "./LogoMcp";

/**
 * La guía del escritorio (fundador 2026-09-12): un popup tipo "YouTube de
 * animaciones". Arriba una X; al centro la animación del tema elegido; abajo
 * una playlist de botones (emisión, configurar empresa, mcp, telegram, team,
 * multiempresa). Cada botón carga su mini-película fiel del escritorio, mismo
 * molde que TeamComoFunciona.
 *
 * Se abre SOLO la primera vez que alguien entra al escritorio. La jugada de la
 * X: nadie lee el manual, todos aprietan X — así que al apretarla la primera
 * vez, antes de cerrar, se muestra una despedida corta diciendo dónde vive la
 * guía (Empresa → Guía). Después vive en ese toggle y se reabre desde ahí.
 */

type Topic = {
  id: string;
  label: string;
  icon: React.ReactNode;
  Comp?: ComponentType;
  /** Aún sin animación propia: tarjeta honesta "en camino". */
  soon?: boolean;
};

const ic = (d: string) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const TOPICS: Topic[] = [
  { id: "emision", label: "Emitir desde cartola", icon: ic("M14 3v4a1 1 0 0 0 1 1h4M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2zM9 13l2 2 4-4"), Comp: EmisionComoFunciona },
  { id: "unica", label: "Boleta o factura única", icon: ic("M9 12h6M9 16h6M9 8h2M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"), Comp: UnicaComoFunciona },
  { id: "mesa-bofa", label: "¿Boleta o factura?", icon: ic("M8 7h12M8 7l3-3M8 7l3 3M16 17H4M16 17l-3-3M16 17l-3 3"), Comp: MesaBoletaFacturaComoFunciona },
  { id: "mesa-periodo", label: "Día · semana · mes", icon: ic("M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"), Comp: MesaPeriodoComoFunciona },
  { id: "empresa", label: "Configurar empresa", icon: (<svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor"><path d="M240,204H228V96a20,20,0,0,0-20-20H172V32a20,20,0,0,0-28.45-18.12l-104,48.54A20.06,20.06,0,0,0,28,80.55V204H16a12,12,0,0,0,0,24H240a12,12,0,0,0,0-24ZM204,100V204H172V100ZM52,83.09,148,38.3V204H52ZM132,112v12a12,12,0,0,1-24,0V112a12,12,0,0,1,24,0Zm-40,0v12a12,12,0,0,1-24,0V112a12,12,0,0,1,24,0Zm0,52v12a12,12,0,0,1-24,0V164a12,12,0,0,1,24,0Zm40,0v12a12,12,0,0,1-24,0V164a12,12,0,0,1,24,0Z" /></svg>), Comp: ConfigurarEmpresaComoFunciona },
  { id: "mcp", label: "MCP", icon: (<LogoMcp size={15} />), Comp: McpComoFunciona },
  { id: "telegram", label: "Telegram", icon: ic("M22 2 11 13M22 2l-7 20-4-9-9-4z"), Comp: TelegramComoFunciona },
  { id: "team", label: "Trabajar en equipo", icon: ic("M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"), Comp: TeamComoFunciona },
  { id: "multi", label: "Multiempresa", icon: ic("M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M2 22h20M9 6h1M14 6h1M9 10h1M14 10h1M9 14h1M14 14h1"), Comp: MultiempresaComoFunciona },
];

export default function GuiaPopup({ firstRun, onClose }: { firstRun: boolean; onClose: () => void }) {
  const [topicId, setTopicId] = useState("emision");
  const [despidiendo, setDespidiendo] = useState(false);
  const activo = TOPICS.find((t) => t.id === topicId) ?? TOPICS[0];

  const cerrar = () => {
    // Primera vez: la X no cierra al tiro, muestra la despedida.
    if (firstRun && !despidiendo) { setDespidiendo(true); return; }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cerrar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRun, despidiendo]);

  return (
    <div className="gp-overlay" role="dialog" aria-modal="true" aria-label="Guía del escritorio" onClick={cerrar}>
      <style>{`
        .gp-overlay{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:20px;background:rgba(8,9,12,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:gpFade .25s ease both}
        @keyframes gpFade{from{opacity:0}to{opacity:1}}
        .gp-card{position:relative;width:min(880px,100%);max-height:calc(100vh - 40px);display:flex;flex-direction:column;border-radius:20px;border:1px solid var(--border);background:var(--surface);box-shadow:0 40px 100px -20px rgba(0,0,0,.5);overflow:hidden;animation:gpPop .32s cubic-bezier(.34,1.4,.5,1) both}
        @keyframes gpPop{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
        .gp-head{display:flex;align-items:center;gap:10px;padding:16px 18px 12px}
        .gp-eyebrow{font-size:9px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
        .gp-title{font-size:15px;font-weight:850;color:var(--text);letter-spacing:-.02em;margin-top:1px}
        .gp-x{margin-left:auto;width:32px;height:32px;border-radius:999px;display:grid;place-items:center;border:1px solid var(--border);background:var(--bg-muted);color:var(--text2);cursor:pointer;font-size:18px;line-height:1;transition:.2s}
        .gp-x:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
        /* Alto FIJO (fundador 2026-09-12): el popup nunca cambia de tamaño entre
           animaciones — la de team traía 4 pasos y crecía. La animación se centra
           dentro de esta caja estable. */
        .gp-body{padding:6px 18px;height:340px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;z-index:1}
        .gp-body > *{width:100%}
        /* Todas las animaciones miden lo mismo: la lista de pasos (la de team trae
           4 y crecía) se limita al alto del escenario y scrollea si sobra. Así el
           popup no cambia de tamaño al pasar entre botones. */
        .gp-body ol{max-height:320px;overflow-y:auto}
        .gp-soon{height:320px;border-radius:14px;border:1px dashed var(--border);background:var(--bg);display:grid;place-items:center;text-align:center;padding:24px}
        .gp-soon .em{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;margin:0 auto 12px;background:var(--accent-light);color:var(--accent)}
        .gp-soon b{display:block;font-size:14px;font-weight:850;color:var(--text)}
        .gp-soon p{margin:6px auto 0;font-size:11.5px;line-height:1.5;color:var(--text2);max-width:280px}
        .gp-list{display:flex;flex-wrap:wrap;justify-content:center;gap:7px;padding:12px 18px 16px;border-top:1px solid var(--border);background:var(--surface2)}
        .gp-btn{flex-shrink:0;display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:11px;border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-family:inherit;font-size:11px;font-weight:800;transition:.2s;white-space:nowrap}
        .gp-btn:hover{border-color:var(--accent);color:var(--text)}
        .gp-btn.on{background:var(--accent);border-color:var(--accent);color:#fff}
        .gp-btn .lbl{display:flex;flex-direction:column;align-items:flex-start;line-height:1.1}
        .gp-btn .soon{font-size:7.5px;font-weight:800;opacity:.7;letter-spacing:.03em;text-transform:uppercase}
        /* despedida */
        .gp-bye{position:absolute;inset:0;z-index:6;display:grid;place-items:center;padding:28px;text-align:center;background:var(--surface);animation:gpFade .3s ease both}
        .gp-bye .em{width:48px;height:48px;border-radius:15px;display:grid;place-items:center;margin:0 auto 16px;background:var(--accent-light);color:var(--accent)}
        .gp-bye b{display:block;font-size:17px;font-weight:850;color:var(--text);letter-spacing:-.02em}
        .gp-bye p{margin:9px auto 0;font-size:12.5px;line-height:1.6;color:var(--text2);max-width:300px}
        .gp-bye .path{white-space:nowrap;font-weight:850;color:var(--text)}
        .gp-bye button{margin-top:20px;padding:10px 24px;border-radius:11px;border:none;background:var(--accent);color:#fff;font-family:inherit;font-size:12.5px;font-weight:850;cursor:pointer;box-shadow:0 10px 26px -8px rgba(232,85,62,.55)}
        @media (prefers-reduced-motion:reduce){.gp-overlay,.gp-card,.gp-bye{animation:none}}
      `}</style>

      <div className="gp-card" onClick={(e) => e.stopPropagation()}>
        <div className="gp-head">
          <div>
            <div className="gp-eyebrow">Guía del escritorio</div>
            <div className="gp-title">Así funciona MassDTE, en 30 segundos</div>
          </div>
          <button type="button" className="gp-x" aria-label="Cerrar" onClick={cerrar}>×</button>
        </div>

        <div className="gp-body">
          {activo.Comp ? <activo.Comp /> : (
            <div className="gp-soon">
              <div>
                <span className="em">{activo.icon}</span>
                <b>{activo.label}</b>
                <p>La animación de esta parte está en camino. Mientras, la sección ya funciona en la app.</p>
              </div>
            </div>
          )}
        </div>

        <div className="gp-list">
          {TOPICS.map((t) => (
            <button key={t.id} type="button" className={`gp-btn${t.id === topicId ? " on" : ""}`} onClick={() => setTopicId(t.id)}>
              {t.icon}
              <span className="lbl">
                {t.label}
                {t.soon && <span className="soon">En camino</span>}
              </span>
            </button>
          ))}
        </div>

        {despidiendo && (
          <div className="gp-bye">
            <div>
              <span className="em">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              </span>
              <b>Todo listo</b>
              <p>¿La quieres ver de nuevo? La encuentras en <span className="path">Empresa → Guía</span>, cuando quieras.</p>
              <button type="button" onClick={onClose}>Entendido</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
