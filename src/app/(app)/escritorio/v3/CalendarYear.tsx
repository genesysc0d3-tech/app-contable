"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

interface DayInfo { p: number; a: number; d: number }

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const WDS = ["D", "L", "M", "M", "J", "V", "S"];

export default function CalendarYear({ empresaId }: { empresaId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [activeMonth, setActiveMonth] = useState<number | null>(now.getMonth());
  const [data, setData] = useState<Record<string, DayInfo>>({});
  const [loading, setLoading] = useState(true);

  const selectedDate = searchParams.get("date");

  useEffect(() => {
    setLoading(true);
    setActiveMonth(null);
    const supabase = createClient();
    const start = new Date(year, 0, 1).toISOString();
    const end = new Date(year + 1, 0, 1).toISOString();

    Promise.all([
      supabase.from("propuestas_ia").select("created_at, estado").gte("created_at", start).lt("created_at", end),
      supabase.from("documentos_subidos").select("created_at").gte("created_at", start).lt("created_at", end),
    ]).then(([propsRes, docsRes]) => {
      const map: Record<string, DayInfo> = {};
      for (const p of propsRes.data ?? []) {
        const key = p.created_at.slice(0, 10);
        if (!map[key]) map[key] = { p: 0, a: 0, d: 0 };
        if (p.estado === "pendiente") map[key].p++;
        else if (["aprobado", "editado"].includes(p.estado)) map[key].a++;
      }
      for (const d of docsRes.data ?? []) {
        const key = d.created_at.slice(0, 10);
        if (!map[key]) map[key] = { p: 0, a: 0, d: 0 };
        map[key].d++;
      }
      setData(map);
      setLoading(false);
      setActiveMonth(now.getMonth());
    });
  }, [year]);

  function pickDate(dateStr: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", dateStr);
    router.push(`/escritorio/v3?${params.toString()}`, { scroll: false });
  }

  const m = activeMonth !== null ? activeMonth : 0;
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const firstDay = new Date(year, m, 1).getDay();

  return (
    <div className="bg-white/50 dark:bg-white/[0.03] rounded-xl border border-[var(--border)] py-2 px-3 space-y-1.5">
      {/* Top row: year + months */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {/* Year */}
        <div className="flex items-center gap-0.5 shrink-0 mr-1">
          <button onClick={() => setYear((y) => y - 1)} className="p-0.5 rounded hover:bg-[var(--surface)] text-[var(--muted)] cursor-pointer"><CaretLeft size={12} /></button>
          <span className="text-[11px] font-semibold tabular-nums min-w-[32px] text-center">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} className="p-0.5 rounded hover:bg-[var(--surface)] text-[var(--muted)] cursor-pointer"><CaretRight size={12} /></button>
        </div>

        {/* Months */}
        {MONTHS.map((name, i) => {
          const isActive = i === activeMonth;
          return (
            <button key={i} onClick={() => setActiveMonth(i)}
              className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                isActive ? "bg-[#E8553E] text-white" : "hover:bg-[var(--surface)] text-[var(--muted)]"
              }`}>
              {name}
            </button>
          );
        })}

        {/* Clear filter */}
        {selectedDate && (
          <button onClick={() => { const p = new URLSearchParams(searchParams.toString()); p.delete("date"); router.push(`/escritorio/v3?${p.toString()}`, { scroll: false }); }}
            className="shrink-0 text-[9px] text-[var(--muted)] hover:text-[#E8553E] bg-[var(--surface)] hover:bg-[#E8553E]/10 rounded px-1.5 py-0.5 transition-colors ml-1">
            Limpiar
          </button>
        )}
      </div>

      {/* Days bar for active month */}
      {activeMonth !== null && (
        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar pb-0.5">
          <span className="text-[9px] text-[var(--muted-light)] font-medium mr-1 shrink-0">{MONTHS[activeMonth]}</span>
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const dateStr = `${year}-${String(activeMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const info = data[dateStr];
            const isSel = selectedDate === dateStr;
            const isToday = new Date(year, activeMonth, day).toDateString() === new Date().toDateString();
            const hasActivity = info && (info.p > 0 || info.a > 0 || info.d > 0);

            return (
              <button key={day} onClick={() => pickDate(dateStr)}
                className={`shrink-0 w-7 py-0.5 rounded-md flex flex-col items-center transition-all cursor-pointer ${
                  isSel ? "bg-[#E8553E] text-white" : isToday ? "ring-1 ring-inset ring-[#E8553E]/40" : "hover:bg-[var(--surface)]"
                }`}>
                <span className="text-[6px] uppercase leading-none text-[var(--muted-light)]">{WDS[new Date(year, activeMonth, day).getDay()]}</span>
                <span className="text-[10px] font-medium tabular-nums leading-none">{day}</span>
              </button>
            );
          })}
          {loading && <span className="text-[9px] text-[var(--muted-light)] ml-2 shrink-0">...</span>}
        </div>
      )}
    </div>
  );
}
