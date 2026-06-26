"use client";

import type { CSSProperties } from "react";
import type { MesaDateDependent } from "./mesa-data";

const wd = ["D", "L", "M", "M", "J", "V", "S"];
const btnReset: CSSProperties = { border: "none", font: "inherit", cursor: "pointer", appearance: "none", WebkitTapHighlightColor: "transparent" };

export type NavParams = { date?: string; month?: string; view?: string };

export default function CalendarStrip({ cal, navigate }: { cal: MesaDateDependent["calendar"]; navigate: (p: NavParams) => void }) {
  const { y, m, monthName, daysInMonth, today, isThisMonth, selDay, weekRange, prevMonthParam, nextMonthParam, workMode, selDate } = cal;
  const isMonthMode = workMode === "month";
  const isWeekMode = workMode === "week";
  const nextView = workMode === "day" ? "week" : workMode === "week" ? "month" : "day";

  return (
    <div className="v5-calendar-wrap" style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", height: 38, display: "flex", justifyContent: "center", minWidth: 0, overflow: "hidden", zIndex: 1 }}>
      <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", boxShadow: "inset 0 1px 0 var(--border),0 8px 32px var(--shadow)", minWidth: 0, height: 38, display: "flex", alignItems: "center", width: "fit-content" }}>
        <div style={{ padding: "0 6px", display: "flex", alignItems: "center", gap: 2 }}>
          <button type="button" onClick={() => navigate({ month: prevMonthParam, date: selDate, view: workMode })} style={{ ...btnReset, fontSize: 11, fontWeight: 700, color: "var(--text)", padding: "1px 5px", borderRadius: 4, lineHeight: 1, background: "var(--bg-muted)", display: "flex", alignItems: "center", justifyContent: "center", height: 20, flexShrink: 0 }}>‹</button>
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", flexShrink: 0, width: 100, textAlign: "center" }}>{monthName} {y}</span>
          <button type="button" onClick={() => navigate({ month: nextMonthParam, date: selDate, view: workMode })} style={{ ...btnReset, fontSize: 11, fontWeight: 700, color: "var(--text)", padding: "1px 5px", borderRadius: 4, lineHeight: 1, background: "var(--bg-muted)", display: "flex", alignItems: "center", justifyContent: "center", height: 20, flexShrink: 0 }}>›</button>
          <button type="button" onClick={() => navigate({ date: selDate, month: `${y}-${m}`, view: nextView })} style={{ ...btnReset, fontSize: 9, fontWeight: 700, color: "#b4f027", padding: "2px 4px", margin: "0 4px", borderRadius: 4, border: workMode !== "day" ? "1px dashed #b4f027" : "1px solid transparent", background: "transparent", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", flexShrink: 0, height: 28, width: 98, justifyContent: "center", lineHeight: 1.05 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", lineHeight: 1.05, textAlign: "left", fontSize: 9, fontWeight: 700 }}>
              <span>Mesa de trabajo</span>
              <span>{isMonthMode ? "del mes" : isWeekMode ? "de la semana" : "del día"}</span>
            </span>
          </button>
          <div style={{ display: "flex", gap: 1, overflow: "hidden", width: 650, flexShrink: 0, paddingRight: 6 }}>
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const ds = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isSel = day === selDay;
              const isToday = day === today && isThisMonth;
              const isInWeek = ds >= weekRange.start && ds < weekRange.end;
              const active = workMode === "month" || (workMode === "week" && isInWeek) || (workMode === "day" && isSel);
              return (
                <button type="button" key={day} onClick={() => navigate({ date: ds, month: `${y}-${m}`, view: workMode })}
                  style={{ ...btnReset, width: 20, padding: "1px 0", display: "flex", flexDirection: "column", alignItems: "center", borderRadius: 3, flexShrink: 0, background: active ? "#b4f027" : "transparent" }}>
                  <span style={{ fontSize: 5, textTransform: "uppercase", lineHeight: 1, color: active ? "rgba(0,0,0,.5)" : "var(--text3)" }}>{wd[new Date(y, m, day).getDay()]}</span>
                  <span style={{ fontSize: 8, fontWeight: isToday || isSel ? 700 : 500, lineHeight: 1, marginTop: 1, color: isToday ? "#E8553E" : active ? "#000" : "var(--text2)" }}>{day}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
