"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

export default function RcvViewWrapper({ boletas, boletasYear, boletasMonth, initialYear, initialMonth }: { boletas: BoletaRow[]; boletasYear: number; boletasMonth: number; initialYear: number; initialMonth: number }) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const [monthCache, setMonthCache] = useState<Record<string, BoletaRow[]>>(() => ({ [monthKey(boletasYear, boletasMonth)]: boletas }));
  const [errorsByMonth, setErrorsByMonth] = useState<Record<string, string | null>>({});
  const currentKey = monthKey(year, month);
  const currentBoletas = useMemo(() => monthCache[currentKey] ?? [], [currentKey, monthCache]);

  // El RCV es una isla: cache propia por mes, fuera del estado de la mesa. Cuando el
  // sensor central (MesaController) detecta una boleta nueva, avisa por "massdte:emitted";
  // acá invalidamos el mes VISIBLE para forzar su re-fetch (si no, una boleta emitida en
  // el mes ya cargado no aparecía hasta navegar a otro mes y volver, o F5).
  const currentKeyRef = useRef(currentKey);
  useEffect(() => { currentKeyRef.current = currentKey; }, [currentKey]);
  useEffect(() => {
    const onEmitted = () => {
      const key = currentKeyRef.current;
      setMonthCache((current) => {
        if (!(key in current)) return current; // no cargado aún: el fetch normal lo traerá
        const next = { ...current };
        delete next[key]; // dispara el efecto de fetch (loading solo si no hay error previo)
        return next;
      });
      setErrorsByMonth((current) => ({ ...current, [currentKeyRef.current]: null }));
    };
    window.addEventListener("massdte:emitted", onEmitted);
    return () => window.removeEventListener("massdte:emitted", onEmitted);
  }, []);
  const error = errorsByMonth[currentKey] ?? null;
  const loading = !monthCache[currentKey] && !error;

  // El mes del RCV lo controla SOLO el calendario maestro (sin selector propio):
  // sigue el año/mes que emite el MesaController al togglear.
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d || typeof d.calYear !== "number" || typeof d.calMonth !== "number") return;
      setYear(d.calYear); setMonth(d.calMonth);
    };
    window.addEventListener("mesa-updated", h);
    return () => window.removeEventListener("mesa-updated", h);
  }, []);

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

  return (
    <RCVContentWrapper
      headerRight={
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", minWidth: 100, textAlign: "center", lineHeight: 1 }}>
          {monthNames[month]} {year}
        </span>
      }
    >
      {loading && (
        <div style={{ padding: "10px 18px 0", fontSize: 10, color: "var(--text2)" }}>Cargando RCV...</div>
      )}
      {error && (
        <div style={{ padding: "10px 18px 0", fontSize: 10, color: "var(--red)" }}>{error}</div>
      )}
      <BoletasMensualesView
        boletas={currentBoletas}
        month={month}
        year={year}
        onPrevMonth={() => {}}
        onNextMonth={() => {}}
      />
    </RCVContentWrapper>
  );
}
