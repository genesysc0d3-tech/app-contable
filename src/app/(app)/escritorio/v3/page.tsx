import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import DashboardShell, { KpiCards, BarChart } from "./DashboardShell";
import { Files, UploadSimple, ArrowDown } from "@phosphor-icons/react/dist/ssr";

export default async function V3Page() {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;

  return (
    <DashboardShell empresa={usuario.empresas.razon_social} empresaId={empresaId}>
      <div style={{ padding: "20px 24px" }}>
        <Suspense fallback={<div style={{ height: 120 }} />}>
          <KpiData empresaId={empresaId} />
        </Suspense>

        <Suspense fallback={<div style={{ height: 60, background: "#16181d", borderRadius: 14, marginBottom: 16 }} />}>
          <ActionRow empresaId={empresaId} />
        </Suspense>

        <Suspense fallback={<div style={{ height: 60, background: "#16181d", borderRadius: 14, marginBottom: 16 }} />}>
          <MonthTabs empresaId={empresaId} />
        </Suspense>

        <Suspense fallback={<div style={{ height: 200, background: "#16181d", borderRadius: 14, marginTop: 16 }} />}>
          <ChartData empresaId={empresaId} />
        </Suspense>

        <Suspense fallback={<div style={{ height: 200, background: "#16181d", borderRadius: 14, marginTop: 16 }} />}>
          <DocList empresaId={empresaId} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/* ─── KPI DATA ─── */

async function KpiData({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const now = new Date();
  const sm = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sd = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [p, eh, em, ap] = await Promise.all([
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("estado", "pendiente"),
    supabase.from("boletas_emitidas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).gte("created_at", sd),
    supabase.from("boletas_emitidas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).gte("created_at", sm),
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).in("estado", ["aprobado", "editado"]).gte("created_at", sm),
  ]);

  return <KpiCards pendientes={p.count ?? 0} emitidosHoy={eh.count ?? 0} emitidosMes={em.count ?? 0} aprobados={ap.count ?? 0} />;
}

/* ─── ACTION BUTTONS + DROPZONE ─── */

async function ActionRow({ empresaId }: { empresaId: string }) {
  return (
    <div style={{ background: "#16181d", border: "1px solid #2a2d36", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <button style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "none", background: "#b4f027", color: "#000" }}>
          <UploadSimple size={16} weight="bold" /> Subir documento
        </button>
        <button style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid #333742", background: "#1e2028", color: "#e8eaf0" }}>
          <ArrowDown size={16} /> Descargar plantilla
        </button>
      </div>
      <div style={{ background: "#16181d", border: "1.5px dashed #333742", borderRadius: 12, padding: "18px 20px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: "#1e2028", border: "1px solid #333742", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#9499a8" }}>
          <Files size={20} />
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "#e8eaf0" }}>Arrastra tu archivo aquí</h3>
          <p style={{ fontSize: 12, color: "#636878", margin: "2px 0 0" }}>Excel, PDF o CSV — Máximo 20MB</p>
        </div>
        <button style={{ background: "#b4f027", color: "#000", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Seleccionar</button>
      </div>
    </div>
  );
}

/* ─── MONTH TABS ─── */

async function MonthTabs({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const data = await Promise.all(months.map(async (_, i) => {
    const start = new Date(year, i, 1).toISOString();
    const end = new Date(year, i + 1, 1).toISOString();
    const { count } = await supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).gte("created_at", start).lt("created_at", end);
    return count ?? 0;
  }));

  return (
    <div style={{ background: "#16181d", border: "1px solid #2a2d36", borderRadius: 14, padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1e2028", border: "1px solid #333742", borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#e8eaf0" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          {year}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {months.map((m, i) => (
            <span key={m} style={{ padding: "5px 10px", borderRadius: 7, fontSize: 12, fontWeight: 500, color: i === month ? "#000" : "#636878", background: i === month ? "#b4f027" : "transparent", cursor: "pointer" }}>{m}</span>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, background: "#1e2028", border: "1px solid #333742", borderRadius: 8, padding: "6px 12px", fontSize: 12, color: "#9499a8", cursor: "pointer" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Limpiar filtro
        </div>
      </div>
      {/* Days strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(31, 1fr)", gap: 2 }}>
        {Array.from({ length: 31 }, (_, i) => {
          const day = i + 1;
          const isToday = day === now.getDate();
          const isWeekend = [0, 6].includes(new Date(year, month, day).getDay());
          return (
            <div key={day} style={{
              aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center",
              borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer",
              background: isToday ? "#b4f027" : "transparent",
              color: isToday ? "#000" : isWeekend ? "#3a3d45" : "#636878",
              transition: "background .15s",
            }}>{day}</div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── CHART ─── */

async function ChartData({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const year = new Date().getFullYear();
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const data = await Promise.all(months.map(async (_, i) => {
    const s = new Date(year, i, 1).toISOString();
    const e = new Date(year, i + 1, 1).toISOString();
    const { count } = await supabase.from("boletas_emitidas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).gte("created_at", s).lt("created_at", e);
    return count ?? 0;
  }));

  return <BarChart data={data} months={months} activeMonth={new Date().getMonth()} />;
}

/* ─── FRAMER-STYLE DOUBLE-LAYER CARDS ─── */

async function DocList({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documentos_subidos")
    .select("id, nombre_archivo, tipo, estado, movimientos_detectados, created_at")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(5);

  const st: Record<string, { label: string; color: string; accent: string }> = {
    procesado:  { label: "Completado", color: "#22c55e", accent: "rgba(34,197,94,0.12)" },
    procesando: { label: "Procesando", color: "#3b82f6", accent: "rgba(59,130,246,0.12)" },
    error:      { label: "Con error",  color: "#ef4444", accent: "rgba(239,68,68,0.12)" },
    subido:     { label: "Nuevo",      color: "#aaff3b", accent: "rgba(170,255,59,0.12)" },
  };

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "#e8eaf0", letterSpacing: "-0.3px" }}>Documentos</h3>
        <span style={{ fontSize: 12, color: "#5b9cf6", cursor: "pointer", fontWeight: 500 }}>Ver todos →</span>
      </div>
      <style>{`
        .flip-doc {
          background-color: transparent;
          width: 100%;
          aspect-ratio: 1;
          min-height: 150px;
          perspective: 1000px;
          font-family: 'DM Sans', sans-serif;
        }
        .flip-doc-inner {
          position: relative;
          width: 100%;
          height: 100%;
          text-align: center;
          transition: transform .6s cubic-bezier(0.22,1,0.36,1);
          transform-style: preserve-3d;
        }
        .flip-doc:hover .flip-doc-inner {
          transform: rotateY(180deg);
        }
        .flip-front, .flip-back {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
          border-radius: 1rem;
          border: 1px solid coral;
          box-shadow: 0 8px 14px 0 rgba(0,0,0,0.2);
          padding: 16px;
          overflow: hidden;
        }
        .flip-doc[data-status="procesado"] .flip-front {
          background: linear-gradient(120deg, bisque 60%, rgb(255, 231, 222) 88%, rgb(255, 211, 195) 40%, rgba(255, 127, 80, 0.603) 48%);
          color: coral;
        }
        .flip-doc[data-status="procesado"] .flip-back {
          background: linear-gradient(120deg, rgb(255, 174, 145) 30%, coral 88%, bisque 40%, rgb(255, 185, 160) 78%);
          color: white;
        }
        .flip-doc[data-status="procesando"] .flip-front {
          background: linear-gradient(120deg, #dbeafe 60%, #bfdbfe 88%, #93c5fd 40%, rgba(59,130,246,0.5) 48%);
          color: #2563eb;
        }
        .flip-doc[data-status="procesando"] .flip-back {
          background: linear-gradient(120deg, #93c5fd 30%, #3b82f6 88%, #dbeafe 40%, #60a5fa 78%);
          color: white;
          border-color: #3b82f6;
        }
        .flip-doc[data-status="error"] .flip-front {
          background: linear-gradient(120deg, #fecaca 60%, #fca5a5 88%, #f87171 40%, rgba(239,68,68,0.5) 48%);
          color: #dc2626;
        }
        .flip-doc[data-status="error"] .flip-back {
          background: linear-gradient(120deg, #f87171 30%, #ef4444 88%, #fecaca 40%, #fca5a5 78%);
          color: white;
          border-color: #ef4444;
        }
        .flip-doc[data-status="subido"] .flip-front {
          background: linear-gradient(120deg, #fef3c7 60%, #fde68a 88%, #fcd34d 40%, rgba(245,158,11,0.5) 48%);
          color: #d97706;
        }
        .flip-doc[data-status="subido"] .flip-back {
          background: linear-gradient(120deg, #fcd34d 30%, #f59e0b 88%, #fef3c7 40%, #fbbf24 78%);
          color: white;
          border-color: #f59e0b;
        }
        .flip-back {
          transform: rotateY(180deg);
        }
        @keyframes sqIn {
          from { opacity: 0; transform: translateY(16px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .flip-doc { animation: sqIn .45s ease-out both; }
        .flip-doc:nth-child(1) { animation-delay: .02s; }
        .flip-doc:nth-child(2) { animation-delay: .06s; }
        .flip-doc:nth-child(3) { animation-delay: .10s; }
        .flip-doc:nth-child(4) { animation-delay: .14s; }
        .flip-doc:nth-child(5) { animation-delay: .18s; }
      `}</style>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
        {(docs ?? []).length === 0 ? (
          <p style={{ color: "#636878", fontSize: 13, textAlign: "center", padding: "48px 0", gridColumn: "1 / -1" }}>Sin documentos aún</p>
        ) : (docs ?? []).map((d, i) => {
          const s = st[d.estado] ?? { label: d.estado, color: "#636878", accent: "rgba(99,104,120,0.12)" };
          return (
            <div key={d.id} className="flip-doc" data-status={d.estado}>
              <div className="flip-doc-inner">
                <div className="flip-front">
                  <p className="title" style={{ fontSize: "1.2em", fontWeight: 900, margin: "0 0 4px" }}>{d.estado === "procesado" ? "✓ Listo" : d.estado === "procesando" ? "⟳ En curso" : d.estado === "error" ? "⚠ Error" : "○ Nuevo"}</p>
                  <p style={{ fontSize: 11, margin: "4px 0", opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{d.nombre_archivo}</p>
                  <p style={{ fontSize: 10, margin: "2px 0", opacity: 0.6 }}>{d.tipo.toUpperCase()}{d.movimientos_detectados ? ` · ${d.movimientos_detectados}` : ""}</p>
                </div>
                <div className="flip-back">
                  <p className="title" style={{ fontSize: "1.1em", fontWeight: 900, margin: "0 0 6px" }}>{d.estado === "procesado" ? "Completado" : d.estado === "procesando" ? "Procesando" : d.estado === "error" ? "Falló" : "Pendiente"}</p>
                  <p style={{ fontSize: 11, margin: "2px 0", opacity: 0.9 }}>{d.movimientos_detectados ? `${d.movimientos_detectados} movimientos` : "Sin datos"}</p>
                  <p style={{ fontSize: 10, margin: "2px 0", opacity: 0.7 }}>{new Date(d.created_at).toLocaleDateString("es-CL")}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
