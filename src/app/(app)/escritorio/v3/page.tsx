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

/* ─── TASK-STYLE DOCUMENT CARDS ─── */

async function DocList({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documentos_subidos")
    .select("id, nombre_archivo, tipo, estado, movimientos_detectados, created_at")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(6);

  const typeMeta: Record<string, { icon: string; color: string; bg: string }> = {
    pdf:    { icon: "📄", color: "#f87171", bg: "rgba(239,68,68,0.08)" },
    excel:  { icon: "📊", color: "#4ade80", bg: "rgba(74,222,128,0.08)" },
    csv:    { icon: "📋", color: "#60a5fa", bg: "rgba(91,156,246,0.08)" },
    image:  { icon: "🖼️", color: "#c084fc", bg: "rgba(167,139,250,0.08)" },
  };

  const statusMeta: Record<string, { label: string; color: string; dot: string }> = {
    procesado:   { label: "Completado", color: "#4ade80", dot: "#22c55e" },
    procesando:  { label: "Procesando", color: "#60a5fa", dot: "#3b82f6" },
    error:       { label: "Con error",  color: "#f87171", dot: "#ef4444" },
    subido:      { label: "Pendiente",  color: "#fbbf24", dot: "#f59e0b" },
  };

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "#e8eaf0" }}>Documentos</h3>
        <span style={{ fontSize: 12, color: "#5b9cf6", cursor: "pointer", fontWeight: 500 }}>Ver todos →</span>
      </div>
      <style>{`
        .tcard { transition: all .2s cubic-bezier(0.22,1,0.36,1); cursor: pointer; border-radius: 12px; }
        .tcard:hover { background: #1a1c23 !important; border-color: #3a3d48 !important; }
        .tcard:active { transform: scale(0.99); }
        @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
        .tcard { animation: slideUp .4s ease-out both; }
        .tcard:nth-child(1) { animation-delay: .00s; }
        .tcard:nth-child(2) { animation-delay: .06s; }
        .tcard:nth-child(3) { animation-delay: .12s; }
        .tcard:nth-child(4) { animation-delay: .18s; }
        .tcard:nth-child(5) { animation-delay: .24s; }
        .tcard:nth-child(6) { animation-delay: .30s; }
      `}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(docs ?? []).length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#636878", fontSize: 13 }}>Sin documentos aún — subí tu primer archivo.</div>
        ) : (docs ?? []).map((d, i) => {
          const t = typeMeta[d.tipo] ?? { icon: "📁", color: "#9499a8", bg: "rgba(99,104,120,0.08)" };
          const s = statusMeta[d.estado] ?? { label: d.estado, color: "#9499a8", dot: "#636878" };
          return (
            <div key={d.id} className="tcard" style={{
              background: "#16181d", border: "1px solid #252830", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
              borderLeft: `3px solid ${s.dot}`,
            }}>
              <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{t.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "#e8eaf0" }}>{d.nombre_archivo}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, fontSize: 11, color: "#636878" }}>
                  <span style={{ color: t.color, fontWeight: 600 }}>{d.tipo.toUpperCase()}</span>
                  {d.movimientos_detectados && <><span>·</span><span>{d.movimientos_detectados} mov</span></>}
                  <span>·</span>
                  <span>{new Date(d.created_at).toLocaleDateString("es-CL")}</span>
                </div>
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20,
                fontSize: 11, fontWeight: 600, background: s.dot + "15", color: s.color, whiteSpace: "nowrap",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.dot }} />
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
