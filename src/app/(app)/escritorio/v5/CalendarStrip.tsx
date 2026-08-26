"use client";

import { useCallback, useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import type { MesaDateDependent } from "./mesa-data";

const wd = ["D", "L", "M", "M", "J", "V", "S"];
const btnReset: CSSProperties = { border: "none", font: "inherit", cursor: "pointer", appearance: "none", WebkitTapHighlightColor: "transparent" };

export type NavParams = { date?: string; month?: string; view?: string };

export default function CalendarStrip({ cal, navigate }: { cal: MesaDateDependent["calendar"]; navigate: (p: NavParams) => void }) {
  const { y, m, monthName, daysInMonth, byDay, today, isThisMonth, selDay, weekRange, prevMonthParam, nextMonthParam, workMode, selDate } = cal;
  const isMonthMode = workMode === "month";
  const isWeekMode = workMode === "week";
  const nextView = workMode === "day" ? "week" : workMode === "week" ? "month" : "day";
  // En modo día, selDate define el mes (mesa-data.ts). Si ‹/› pasaran el selDate actual,
  // el mes nunca cambiaría (era el bug del ‹). Navegamos al día 1 del mes destino.
  const firstOfMonthParam = (mp: string) => {
    const [py, pm] = mp.split("-").map(Number);
    return `${py}-${String((pm || 0) + 1).padStart(2, "0")}-01`;
  };

  // ── Magnificación tipo dock de macOS sobre la tira de días (onda SIN empujar:
  // los vecinos crecen en cascada pero escalan en su lugar, sin reordenarse).
  // Imperativo + rAF para seguir el cursor sin re-render. Los centros se cachean
  // (con transform-origin center el centro es invariante a la escala) y se re-miden
  // al cambiar de mes o redimensionar. unit = ancho de celda sin escalar.
  const stripRef = useRef<HTMLDivElement>(null);
  const basesRef = useRef<{ centers: number[]; unit: number }>({ centers: [], unit: 20 });
  const rafRef = useRef<number | null>(null);
  const PEAK = 1.6;   // escala del día bajo el cursor
  const SIGMA = 1.35; // ancho de la onda en celdas (cuántos vecinos crecen)

  const medir = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const celdas = Array.from(strip.children) as HTMLElement[];
    basesRef.current = {
      centers: celdas.map((c) => { const r = c.getBoundingClientRect(); return r.left + r.width / 2; }),
      unit: celdas[0]?.offsetWidth || 20,
    };
  }, []);
  useEffect(() => { medir(); }, [medir, daysInMonth, y, m]);
  useEffect(() => {
    const onResize = () => medir();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [medir]);

  const magnificar = useCallback((clientX: number) => {
    const strip = stripRef.current;
    if (!strip) return;
    const { centers, unit } = basesRef.current;
    const celdas = strip.children;
    for (let i = 0; i < celdas.length; i++) {
      const celda = celdas[i] as HTMLElement;
      const center = centers[i];
      if (center == null) continue;
      const d = (clientX - center) / unit;                 // distancia en celdas
      const f = Math.exp(-(d * d) / (2 * SIGMA * SIGMA));   // campana 0..1
      celda.style.transform = `scale(${1 + (PEAK - 1) * f})`;
      celda.style.zIndex = String(1 + Math.round(f * 6));
    }
  }, []);
  const onStripMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const x = e.clientX;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => magnificar(x));
  }, [magnificar]);
  const onStripLeave = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const strip = stripRef.current;
    if (!strip) return;
    for (const celda of Array.from(strip.children)) {
      (celda as HTMLElement).style.transform = "scale(1)";
      (celda as HTMLElement).style.zIndex = "0";
    }
  }, []);

  return (
    // Anclado ENTRE el logo (137px reales: imagen 114 + chevron) y los botones
    // (178px) en vez de centrado a
    // ciegas con left:50%: geométricamente imposible que los toque a cualquier
    // ancho de ventana. Dentro de ese carril, centrado.
    // "safe center": centrado cuando el reloj cabe completo; si el carril se
    // angosta, en vez de botar días por la derecha (mientras sobraba espacio
    // junto al logo), se alinea al inicio y usa TODO el carril. Nada más cambia.
    // `overflow:hidden` recorta el carril a lo ancho (es lo que impide invadir el
    // logo y los botones), pero también recortaba el ZOOM del día bajo el cursor:
    // el día crecía y quedaba cortado contra el borde de la caja. El padding
    // exige `content-box`: con el border-box global de Tailwind, paddingBlock:16
    // se comía la altura por DENTRO de los 38px y el margen negativo subía el
    // calendario 16px sobre el logo y los íconos (se vio en prod el 24-08).
    // vertical agranda la caja de recorte y el margen negativo devuelve el
    // contenido a su sitio — visualmente idéntico, pero el zoom tiene aire.
    // pointerEvents none/auto: ese aire extra se superpone a la barra de abajo y
    // no debe robarle los clics.
    <div className="v5-calendar-wrap" style={{ position: "absolute", left: 141, right: 186, top: 0, height: 38, boxSizing: "content-box", paddingBlock: 16, marginBlock: -16, display: "flex", alignItems: "center", justifyContent: "safe center", minWidth: 0, overflow: "hidden", zIndex: 20, pointerEvents: "none" }}>
      {/* Amplificación suave al hover del conmutador día/semana/mes — mismo spring del dock. */}
      <style>{`
        .v5-day-strip::-webkit-scrollbar{display:none;}
        .cal-mode-btn{transition:transform .24s cubic-bezier(.34,1.56,.64,1);}
        .cal-mode-btn:hover{transform:scale(1.07);}
        .cal-mode-btn:active{transform:scale(.98);}
        @media (prefers-reduced-motion: reduce){
          .cal-mode-btn{transition:none;}
          .cal-mode-btn:hover{transform:none;}
        }
      `}</style>
      <div style={{ pointerEvents: "auto", background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)", minWidth: 0, maxWidth: "100%", height: 38, display: "flex", alignItems: "center", width: "fit-content" }}>
        <div style={{ padding: "0 6px", display: "flex", alignItems: "center", gap: 2 }}>
          <button type="button" onClick={() => navigate({ month: prevMonthParam, date: firstOfMonthParam(prevMonthParam), view: workMode })} style={{ ...btnReset, fontSize: 11, fontWeight: 700, color: "var(--text)", padding: "1px 5px", borderRadius: 4, lineHeight: 1, background: "var(--bg-muted)", display: "flex", alignItems: "center", justifyContent: "center", height: 20, flexShrink: 0 }}>‹</button>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0, width: 100, textAlign: "center" }}>{monthName} {y}</span>
          <button type="button" onClick={() => navigate({ month: nextMonthParam, date: firstOfMonthParam(nextMonthParam), view: workMode })} style={{ ...btnReset, fontSize: 11, fontWeight: 700, color: "var(--text)", padding: "1px 5px", borderRadius: 4, lineHeight: 1, background: "var(--bg-muted)", display: "flex", alignItems: "center", justifyContent: "center", height: 20, flexShrink: 0 }}>›</button>
          <button type="button" className="cal-mode-btn" title={`Mesa de trabajo ${isMonthMode ? "del mes" : isWeekMode ? "de la semana" : "del día"}`} onClick={() => navigate({ date: selDate, month: `${y}-${m}`, view: nextView })} style={{ ...btnReset, fontSize: 9, fontWeight: 700, color: "var(--lime)", padding: "2px 4px", margin: "0 4px", borderRadius: 4, border: workMode !== "day" ? "1px dashed var(--lime)" : "1px solid transparent", background: "transparent", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", flexShrink: 0, height: 28, width: 98, justifyContent: "center", lineHeight: 1.05 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span className="cal-mesa-txt" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", lineHeight: 1.05, textAlign: "left", fontSize: 9, fontWeight: 700 }}>
              <span>Mesa de trabajo</span>
              <span>{isMonthMode ? "del mes" : isWeekMode ? "de la semana" : "del día"}</span>
            </span>
          </button>
          {/* La tira de días pierde el ancho rígido: en pantallas anchas mide sus
              650px de siempre; cuando el carril se achica, se comprime y los días
              se DESLIZAN (scroll horizontal, scrollbar oculta) en vez de invadir
              los botones de la derecha. */}
          {/* El mes SIEMPRE cabe: las celdas son elásticas (20px de base, se
              comprimen hasta 13px cuando el carril se angosta) en vez de fijas
              con scroll — así el 31 nunca desaparece. El dock se re-mide solo
              (medir() usa anchos reales al entrar el mouse y al redimensionar).
              El overflow queda solo como último recurso bajo ~450px de carril. */}
          <div ref={stripRef} onMouseEnter={medir} onMouseMove={onStripMove} onMouseLeave={onStripLeave} className="v5-day-strip" style={{ display: "flex", gap: 1, overflowX: "auto", overflowY: "hidden", flex: "0 1 664px", minWidth: 0, paddingRight: 6, paddingBlock: 14, marginBlock: -14, scrollbarWidth: "none" }}>
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isSel = day === selDay;
              const isToday = day === today && isThisMonth;
              const isInWeek = ds >= weekRange.start && ds < weekRange.end;
              const active = workMode === "month" || (workMode === "week" && isInWeek) || (workMode === "day" && isSel);
              const info = byDay[day];
              return (
                <button type="button" key={day} onClick={() => navigate({ date: ds, month: `${y}-${m}`, view: workMode })}
                  style={{ ...btnReset, position: "relative", width: 20, padding: "1px 0", display: "flex", flexDirection: "column", alignItems: "center", borderRadius: 3, flexShrink: 0, background: active ? "var(--lime)" : "transparent", transition: "transform .15s cubic-bezier(.22,1,.36,1), background .15s", willChange: "transform" }}>
                  <span style={{ fontSize: 5, textTransform: "uppercase", lineHeight: 1, color: active ? "color-mix(in srgb, var(--bg) 50%, transparent)" : "var(--text3)" }}>{wd[new Date(y, m, day).getDay()]}</span>
                  <span style={{ fontSize: 8, fontWeight: isToday || isSel ? 700 : 500, lineHeight: 1, marginTop: 1, color: isToday ? "var(--accent)" : active ? "var(--bg)" : "var(--text2)" }}>{day}</span>
                  {/* Puntos de trabajo del día (byDay de mesa-data): pendientes / aprobadas.
                      Fila de alto fijo para que todas las celdas midan igual (dock intacto). */}
                  <span style={{ display: "flex", gap: 2, height: 3, marginTop: 1, alignItems: "center", justifyContent: "center" }}>
                    {(info?.p ?? 0) > 0 && <span style={{ width: 3, height: 3, borderRadius: 999, background: "var(--accent)" }} />}
                    {(info?.a ?? 0) > 0 && <span style={{ width: 3, height: 3, borderRadius: 999, background: "var(--green)" }} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
