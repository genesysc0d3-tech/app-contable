"use client";

import { useState } from "react";
import { RCVContentWrapper } from "./LeftQuickActions";
import BoletasMensualesView from "./sections/BoletasMensualesView";

const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

export default function RcvViewWrapper({ boletas }: { boletas: any[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  return (
    <RCVContentWrapper
      headerRight={
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={prevMonth}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text2)", padding: "0 4px", fontSize: 13, lineHeight: 1 }}>
            ‹
          </button>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", minWidth: 100, textAlign: "center", lineHeight: 1 }}>
            {monthNames[month]} {year}
          </span>
          <button onClick={nextMonth}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text2)", padding: "0 4px", fontSize: 13, lineHeight: 1 }}>
            ›
          </button>
        </div>
      }
    >
      <BoletasMensualesView
        boletas={boletas}
        month={month}
        year={year}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
      />
    </RCVContentWrapper>
  );
}
