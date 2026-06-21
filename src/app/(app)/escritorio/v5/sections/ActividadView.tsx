"use client";

import { useMemo } from "react";
import { formatShortDateEsCl } from "@/lib/display-date";
import { addDaysIso, chileDateString } from "@/lib/chile-date";

interface ActivityEvent {
  type: "subida" | "aprobacion" | "emision" | "rechazo";
  fecha: string;
  descripcion: string;
  detalle?: string;
  cantidad?: number;
}

function dayLabel(s: string) {
  if (!s || s === "sin-fecha") return "Sin fecha";
  const hoy = chileDateString();
  if (s === hoy) return "Hoy";
  if (s === addDaysIso(hoy, -1)) return "Ayer";
  return formatShortDateEsCl(s, true);
}

const TYPE_META: Record<string, { icon: string; color: string; bg: string }> = {
  subida: {
    icon: "M12 5v14m-7-7l7-7 7 7",
    color: "#3B82F6",
    bg: "rgba(59,130,246,.08)",
  },
  aprobacion: {
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
    color: "#22c55e",
    bg: "rgba(34,197,94,.08)",
  },
  emision: {
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    color: "#E8553E",
    bg: "rgba(232,85,62,.08)",
  },
  rechazo: {
    icon: "M6 18L18 6M6 6l12 12",
    color: "#ef4444",
    bg: "rgba(239,68,68,.08)",
  },
};

export default function ActividadView({ events }: { events: ActivityEvent[] }) {
  const byDate = useMemo(() => {
    const m = new Map<string, ActivityEvent[]>();
    for (const e of events) {
      const key = e.fecha?.slice(0, 10) ?? "sin-fecha";
      const arr = m.get(key) ?? [];
      arr.push(e);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [events]);

  if (events.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>Actividad reciente</div>
        <div style={{ textAlign: "center", padding: "60px 20px", fontSize: 11, color: "var(--text2)" }}>
          Aún no hay actividad registrada
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Actividad reciente</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {byDate.map(([date, evts]) => (
          <div key={date}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text2)", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
              {dayLabel(date)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {evts.map((ev, i) => {
                const meta = TYPE_META[ev.type] ?? TYPE_META.subida;
                return (
                  <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                      background: meta.bg, color: meta.color,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d={meta.icon} />
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ev.descripcion}
                      </div>
                      {ev.detalle && (
                        <div style={{ fontSize: 9, color: "var(--text2)", marginTop: 1 }}>
                          {ev.detalle}{ev.cantidad != null ? ` · ${ev.cantidad} movimientos` : ""}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--text3)", flexShrink: 0, paddingTop: 3 }}>
                      {ev.fecha?.slice(11, 16) ?? ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
