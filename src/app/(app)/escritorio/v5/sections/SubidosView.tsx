"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Tables } from "@/lib/database.types";
import { formatDisplayDateEsCl, formatShortDateEsCl } from "@/lib/display-date";

const stColors: Record<string, string> = { procesado: "var(--green)", procesando: "var(--blue)", error: "var(--accent)", subido: "var(--amber)" };
const stLabels: Record<string, string> = { procesado: "Listo", procesando: "Procesando", error: "Error", subido: "Pendiente" };
const extIcons: Record<string, string> = { excel: "XLS", pdf: "PDF", csv: "CSV", imagen: "IMG", whatsapp: "WP" };

function fmtFecha(s: string) {
  return formatShortDateEsCl(s, true) || s;
}

export default function SubidosView({
  documentos, selDate, viewMode: initialMode,
}: {
  documentos: Tables<"documentos_subidos">[];
  selDate: string;
  viewMode: "day" | "full";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"day" | "full">(initialMode);
  const hayProcesando = documentos.some(d => d.estado === "procesando");
  useEffect(() => {
    if (!hayProcesando) return;
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [hayProcesando, router]);
  const activeMode = mode;
  // Group docs by date for full mode
  const byDate = useMemo(() => {
    const m = new Map<string, Tables<"documentos_subidos">[]>();
    for (const doc of documentos) {
      const key = doc.created_at?.slice(0, 10) ?? "sin-fecha";
      const arr = m.get(key) ?? [];
      arr.push(doc);
      m.set(key, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => b.localeCompare(a));
  }, [documentos]);

  const dayDocs = useMemo(
    () => documentos.filter(d => d.created_at?.startsWith(selDate)),
    [documentos, selDate],
  );

  if (activeMode === "day") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{display:"flex",gap:2}}>
          <button onClick={() => setMode("day")}
            style={{padding:"4px 10px",borderRadius:4,border:"none",cursor:"pointer",fontSize:9,fontWeight:500,
              background:"#E8553E",color:"#fff"}}>Día</button>
          <button onClick={() => setMode("full")}
            style={{padding:"4px 10px",borderRadius:4,border:"none",cursor:"pointer",fontSize:9,fontWeight:500,
              background:"var(--border)",color:"var(--text2)"}}>Historial</button>
        </div>
        {dayDocs.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, fontSize: 11, color: "var(--text3)" }}>
            No hay documentos subidos en esta fecha
          </div>
        ) : (
          <>
          {dayDocs.map(doc => (
            <div key={doc.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 10,
              background: "var(--surface)", border: "1px solid var(--border)",
            }}>
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: stColors[doc.estado] ?? "var(--text3)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {doc.nombre_archivo}
                </div>
                <div style={{ fontSize: 9, color: "var(--text2)" }}>
                  {extIcons[doc.tipo] ?? doc.tipo} · {fmtFecha(doc.created_at ?? "")}
                </div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: stColors[doc.estado] ?? "var(--text2)" }}>
                {stLabels[doc.estado] ?? doc.estado}
              </span>
              {doc.movimientos_detectados != null && (
                <span style={{ fontSize: 9, color: "var(--text2)" }}>{doc.movimientos_detectados} mov</span>
              )}
            </div>
          ))}
          {dayDocs.some(d => d.estado === "procesado") && (
            <button onClick={() => window.dispatchEvent(new CustomEvent("go-to-tab", { detail: { tab: "revisar" } }))}
              style={{fontSize:11,padding:"8px 20px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,background:"#E8553E",color:"#fff",alignSelf:"flex-start"}}>
              CONTINUAR A PREPARAR
            </button>
          )}
          </>
        )}
      </div>
    );
  }

  // FULL mode — multi-column by date
  const dates = byDate.slice(0, 14);

  return (
    <>
      <div style={{display:"flex",gap:2,marginBottom:8}}>
        <button onClick={() => setMode("day")}
          style={{padding:"4px 10px",borderRadius:4,border:"none",cursor:"pointer",fontSize:9,fontWeight:500,
            background:"var(--border)",color:"var(--text2)"}}>Día</button>
        <button onClick={() => setMode("full")}
          style={{padding:"4px 10px",borderRadius:4,border:"none",cursor:"pointer",fontSize:9,fontWeight:500,
            background:"#E8553E",color:"#fff"}}>Historial</button>
      </div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, minHeight: 200 }}>
      {dates.map(([date, docs]) => (
        <div key={date} style={{ minWidth: 200, maxWidth: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: "var(--text2)", padding: "0 0 4px",
            borderBottom: "1px solid var(--border)",
          }}>
            {formatDisplayDateEsCl(date, { weekday: "short", day: "numeric", month: "short" }, date)}
          </div>
          {docs.length === 0 ? (
            <div style={{ fontSize: 9, color: "var(--text3)", padding: 8, textAlign: "center" }}>Sin docs</div>
          ) : (
            docs.slice(0, 8).map(doc => (
              <div key={doc.id} style={{
                padding: "6px 8px", borderRadius: 6, background: "var(--surface2)",
                fontSize: 10, display: "flex", flexDirection: "column", gap: 2,
              }}>
                <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {doc.nombre_archivo}
                </span>
                <span style={{ fontSize: 8, color: stColors[doc.estado] ?? "var(--text2)", fontWeight: 600 }}>
                  {stLabels[doc.estado] ?? doc.estado}
                </span>
              </div>
            ))
          )}
          {docs.length > 8 && (
            <span style={{ fontSize: 8, color: "var(--accent)", cursor: "pointer" }}>+{docs.length - 8} más</span>
          )}
        </div>
      ))}
    </div>
    </>
  );
}
