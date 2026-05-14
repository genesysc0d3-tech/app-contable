"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight, CalendarBlank } from "@phosphor-icons/react";
import { createClient } from "@/lib/supabase/client";

interface DayInfo { p: number; a: number; d: number }

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const WDS = ["D", "L", "M", "M", "J", "V", "S"];

export default function CalendarYear({ empresaId }: { empresaId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<Record<string, DayInfo>>({});
  const [loading, setLoading] = useState(true);

  const selectedDate = searchParams.get("date");

  useEffect(() => {
    setLoading(true);
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
    });
  }, [year]);

  function pickDate(dateStr: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", dateStr);
    router.push(`/escritorio/v3?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="bg-white/50 dark:bg-white/[0.03] rounded-xl border border-[var(--border)] p-3">
      {/* Year selector */}
      <div className="flex items-center gap-3 mb-2.5">
        <button onClick={() => setYear((y) => y - 1)} className="p-1 rounded-md hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer transition-colors">
          <CaretLeft size={14} />
        </button>
        <span className="text-sm font-semibold tabular-nums">{year}</span>
        <button onClick={() => setYear((y) => y + 1)} className="p-1 rounded-md hover:bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer transition-colors">
          <CaretRight size={14} />
        </button>
        {selectedDate && (
          <button onClick={() => { const p = new URLSearchParams(searchParams.toString()); p.delete("date"); router.push(`/escritorio/v3?${p.toString()}`, { scroll: false }); }}
            className="text-[9px] text-[var(--muted)] hover:text-[#E8553E] bg-[var(--surface)] hover:bg-[#E8553E]/10 rounded px-1.5 py-0.5 transition-colors ml-auto">
            Limpiar filtro
          </button>
        )}
        {loading && <div className="ml-auto"><span className="text-[9px] text-[var(--muted-light)]">cargando...</span></div>}
      </div>

      {/* 12 months horizontal */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {Array.from({ length: 12 }, (_, m) => {
          const daysInMonth = new Date(year, m + 1, 0).getDate();
          const firstDay = new Date(year, m, 1).getDay(); // 0=Sun
          const today = new Date();
          const isCurrentMonth = m === today.getMonth() && year === today.getFullYear();
          const todayDay = today.getDate();

          return (
            <div key={m} className="shrink-0 w-[196px]">
              <p className="text-[10px] font-semibold text-[var(--foreground)] mb-1.5 px-0.5">{MONTHS[m]}</p>
              {/* Weekday headers */}
              <div className="grid grid-cols-7 gap-px mb-px">
                {WDS.map((wd) => (
                  <span key={wd} className="text-[6px] text-[var(--muted-light)] text-center uppercase leading-none py-0.5">{wd}</span>
                ))}
              </div>
              {/* Days grid */}
              <div className="grid grid-cols-7 gap-px">
                {/* Empty cells before first day */}
                {Array.from({ length: firstDay === 0 ? 6 : firstDay - 1 }, (_, i) => (
                  <div key={`empty-${i}`} className="h-4" />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const info = data[dateStr];
                  const isSel = selectedDate === dateStr;
                  const isToday = isCurrentMonth && day === todayDay;
                  const hasActivity = info && (info.p > 0 || info.a > 0 || info.d > 0);

                  return (
                    <button key={day} onClick={() => pickDate(dateStr)}
                      className={`
                        relative h-4 rounded-sm text-[8px] font-medium tabular-nums
                        flex items-center justify-center cursor-pointer transition-colors
                        ${isSel ? "bg-[#E8553E] text-white font-bold" : isToday ? "ring-1 ring-inset ring-[#E8553E]/50" : "hover:bg-[var(--surface)] text-[var(--muted)]"}
                      `}>
                      {day}
                      {hasActivity && !isSel && (
                        <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 flex gap-[1px]">
                          {info!.p > 0 && <span className="w-0.5 h-0.5 rounded-full bg-[#E8553E]" />}
                          {info!.a > 0 && <span className="w-0.5 h-0.5 rounded-full bg-[#22C55E]" />}
                          {info!.d > 0 && <span className="w-0.5 h-0.5 rounded-full bg-[#3B82F6]" />}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
