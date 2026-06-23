"use client";

import { useEffect, useMemo, useState } from "react";
import { RCVContentWrapper } from "./LeftQuickActions";
import BoletasMensualesView, { type BoletaRow } from "./sections/BoletasMensualesView";

const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

interface RcvMonthResponse {
  ok?: boolean;
  boletas?: BoletaRow[];
  error?: string;
  detalle?: string;
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

export default function RcvViewWrapper({ boletas, initialYear, initialMonth }: { boletas: BoletaRow[]; initialYear: number; initialMonth: number }) {
  const initialKey = monthKey(initialYear, initialMonth);
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [monthCache, setMonthCache] = useState<Record<string, BoletaRow[]>>(() => ({ [initialKey]: boletas }));
  const [errorsByMonth, setErrorsByMonth] = useState<Record<string, string | null>>({});
  const currentKey = monthKey(year, month);
  const currentBoletas = useMemo(() => monthCache[currentKey] ?? [], [currentKey, monthCache]);
  const error = errorsByMonth[currentKey] ?? null;
  const loading = !monthCache[currentKey] && !error;

  useEffect(() => {
    if (monthCache[currentKey]) return;

    let cancelled = false;
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    fetch(`/api/boletas/rcv?${params.toString()}`, { cache: "no-store" })
      .then((response) => response.json().catch(() => ({ ok: false, error: "BAD_JSON" })))
      .then((json: RcvMonthResponse) => {
        if (cancelled) return;
        if (!json.ok) {
          setErrorsByMonth((current) => ({
            ...current,
            [currentKey]: json.detalle ?? json.error ?? "No se pudo cargar el RCV.",
          }));
          return;
        }
        setErrorsByMonth((current) => ({ ...current, [currentKey]: null }));
        setMonthCache((current) => ({ ...current, [currentKey]: json.boletas ?? [] }));
      })
      .catch(() => {
        if (!cancelled) {
          setErrorsByMonth((current) => ({ ...current, [currentKey]: "No se pudo cargar el RCV." }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentKey, month, monthCache, year]);

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
      {loading && (
        <div style={{ padding: "10px 18px 0", fontSize: 10, color: "var(--text2)" }}>Cargando RCV...</div>
      )}
      {error && (
        <div style={{ padding: "10px 18px 0", fontSize: 10, color: "#ef4444" }}>{error}</div>
      )}
      <BoletasMensualesView
        boletas={currentBoletas}
        month={month}
        year={year}
        onPrevMonth={prevMonth}
        onNextMonth={nextMonth}
      />
    </RCVContentWrapper>
  );
}
