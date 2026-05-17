import { Suspense } from "react";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import RevisarClient from "../../revisar/RevisarClient";
import EmitirBoletaForm from "@/components/boletas/EmitirBoletaForm";
import BoletasList from "@/components/boletas/BoletasList";
import DashboardShell from "./DashboardShell";
import CalendarYear from "./CalendarYear";
import DocCardModal from "./DocCardModal";
import { KpiCards, BarChart, RightPanel } from "./DashboardComponents";

export default async function V3Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;
  const { tab } = await searchParams;
  const activeTab = tab ?? "dashboard";

  return (
    <DashboardShell
      empresa={usuario.empresas.razon_social}
      empresaId={empresaId}
      activeTab={activeTab}
      rightPanel={activeTab === "dashboard" ? (
        <div style={{ width: 290, borderLeft: "1px solid #2a2d36", background: "#16181d", overflowY: "auto", padding: "20px 16px", flexShrink: 0 }}>
          <RightPanel />
        </div>
      ) : undefined}
    >
      {activeTab === "dashboard" && (
        <div style={{ padding: "20px 24px" }}>
          <Suspense fallback={<div style={{ height: 120 }} />}>
            <KpiData empresaId={empresaId} />
          </Suspense>
          <Suspense fallback={<div style={{ height: 60, background: "#16181d", borderRadius: 14, marginBottom: 16 }} />}>
            <ActionRow />
          </Suspense>
          <CalendarYear empresaId={empresaId} />
          <Suspense fallback={<div style={{ height: 200, background: "#16181d", borderRadius: 14, marginTop: 16 }} />}>
            <ChartData empresaId={empresaId} />
          </Suspense>
          <Suspense fallback={<div style={{ height: 200, background: "#16181d", borderRadius: 14, marginTop: 16 }} />}>
            <DocList empresaId={empresaId} />
          </Suspense>
        </div>
      )}

      {activeTab === "emitir" && (
        <div style={{ padding: "20px 24px" }}>
          <Suspense fallback={<div style={{ height: 200, background: "#16181d", borderRadius: 14 }} />}>
            <SubirView empresaId={empresaId} />
          </Suspense>
        </div>
      )}

      {activeTab === "revisar" && (
        <div style={{ padding: "20px 24px" }}>
          <Suspense fallback={<div style={{ height: 400, background: "#16181d", borderRadius: 14 }} />}>
            <RevisarView empresaId={empresaId} />
          </Suspense>
        </div>
      )}

      {activeTab === "boletas" && (
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Suspense fallback={<div style={{ height: 400, background: "#16181d", borderRadius: 14 }} />}>
            <EmitirBoletaForm />
          </Suspense>
          <Suspense fallback={<div style={{ height: 200, background: "#16181d", borderRadius: 14 }} />}>
            <BoletasList empresaId={empresaId} />
          </Suspense>
        </div>
      )}

      {activeTab === "config" && (
        <div style={{ padding: "20px 24px" }}>
          <div style={{ background: "#16181d", border: "1px solid #2a2d36", borderRadius: 14, padding: "24px", textAlign: "center" }}>
            <p style={{ color: "#636878", fontSize: 14 }}>Configuración disponible en</p>
            <a href="/empresa" style={{ color: "#5b9cf6", fontSize: 14, fontWeight: 500, textDecoration: "none" }}>Ir a Empresa →</a>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

/* ─── KPI ─── */

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

/* ─── ACTION ROW ─── */

function ActionRow() {
  return (
    <div style={{ background: "#16181d", border: "1px solid #2a2d36", borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
      <style>{`
        .abtn {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
          padding: 12px 16px; border-radius: 10px;
          font-size: 13px; font-weight: 600; cursor: pointer;
          border: none; transition: all .25s cubic-bezier(0.22,1,0.36,1);
        }
        .abtn.primary { background: #b4f027; color: #000; }
        .abtn.primary:hover { background: #c8f94a; }
        .abtn.sec { background: #1e2028; color: #e8eaf0; border: 1px solid #333742; }
        .abtn.sec:hover { background: #252830; }
      `}</style>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <a href="/subir" className="abtn primary" style={{ textDecoration: "none" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 17 15 12 9 7"/></svg>
          Subir documento
        </a>
        <a href="/api/generar-template" className="abtn sec" style={{ textDecoration: "none" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 17 9 12 15 7"/></svg>
          Plantilla Excel
        </a>
      </div>
      <div style={{ background: "#16181d", border: "1.5px dashed #333742", borderRadius: 12, padding: "18px 20px", display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }}>
        <div style={{ width: 44, height: 44, borderRadius: 10, background: "#1e2028", border: "1px solid #333742", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "#9499a8" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "#e8eaf0" }}>Arrastra tu archivo aquí</h3>
          <p style={{ fontSize: 12, color: "#636878", margin: "2px 0 0" }}>Excel, PDF o CSV — Máximo 20MB</p>
        </div>
        <a href="/subir" style={{ background: "#b4f027", color: "#000", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" }}>Seleccionar</a>
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

/* ─── SUBIR VIEW ─── */

async function SubirView({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documentos_subidos")
    .select("id, nombre_archivo, tipo, estado, created_at")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false }).limit(20);

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: "#e8eaf0", margin: "0 0 16px" }}>Documentos</h3>
      <a href="/subir" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#b4f027", color: "#000", padding: "10px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: "none", marginBottom: 16 }}>
        + Subir nuevo documento
      </a>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {(docs ?? []).length === 0 ? (
          <p style={{ color: "#636878", fontSize: 13, padding: 20 }}>Sin documentos</p>
        ) : (docs ?? []).map((d) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#16181d", border: "1px solid #252830", borderRadius: 10, padding: "10px 14px" }}>
            <span style={{ fontSize: 10, color: d.tipo === "pdf" ? "#ef4444" : "#4ade80", fontWeight: 700 }}>{d.tipo.toUpperCase()}</span>
            <span style={{ flex: 1, fontSize: 12, color: "#e8eaf0" }}>{d.nombre_archivo}</span>
            <span style={{ fontSize: 10, color: "#636878" }}>{d.estado}</span>
            <span style={{ fontSize: 10, color: "#888" }}>{new Date(d.created_at).toLocaleDateString("es-CL")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── REVISAR VIEW ─── */

async function RevisarView({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const [{ data: propuestas }, { data: clientes }] = await Promise.all([
    supabase.from("propuestas_ia").select("*, movimientos_raw(*, documentos_subidos(id, nombre_archivo, created_at))").eq("empresa_id", empresaId).order("created_at", { ascending: false }),
    supabase.from("clientes").select("id, nombre, rut").eq("empresa_id", empresaId).order("nombre", { ascending: true }),
  ]);
  return <RevisarClient propuestas={propuestas ?? []} clientes={clientes ?? []} empresaId={empresaId} layout="desktop" />;
}

/* ─── DOC LIST WITH MODAL ─── */

async function DocList({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documentos_subidos")
    .select("id, nombre_archivo, tipo, estado, movimientos_detectados, created_at")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(5);

  const st: Record<string, { label: string; color: string }> = {
    procesado:  { label: "Completado", color: "#22c55e" },
    procesando: { label: "Procesando", color: "#3b82f6" },
    error:      { label: "Con error",  color: "#ef4444" },
    subido:     { label: "Nuevo",      color: "#aaff3b" },
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "#e8eaf0", letterSpacing: "-0.3px" }}>Documentos</h3>
        <a href="/subir" style={{ fontSize: 12, color: "#5b9cf6", cursor: "pointer", fontWeight: 500, textDecoration: "none" }}>Ver todos →</a>
      </div>
      <style>{`
        .h-card { position: relative; flex: 1; min-width: 0; height: 160px;
          border-radius: 10px; overflow: hidden; cursor: pointer;
          transition: all .6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }
        .h-card[data-status="procesado"] { background: linear-gradient(135deg, #0a1a0a, #0d2818); }
        .h-card[data-status="procesando"] { background: linear-gradient(135deg, #0a0f1a, #0c1f3a); }
        .h-card[data-status="error"] { background: linear-gradient(135deg, #1a0a0a, #2a0d0d); }
        .h-card[data-status="subido"] { background: linear-gradient(135deg, #1a1808, #2a2408); }
        .h-card:hover { transform: scale(1.03); box-shadow: 0 8px 24px rgba(0,0,0,0.3); z-index: 2; }
        .h-card .h-front { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; transition: all .5s cubic-bezier(0.175, 0.885, 0.32, 1.275); padding: 14px; }
        .h-card:hover .h-front { opacity: 0; transform: scale(0.85); }
        .h-card .h-actions-wrap { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 14px; transform: scale(0.85); opacity: 0; transition: all .5s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .h-card:hover .h-actions-wrap { transform: scale(1); opacity: 1; }
      `}</style>
      <div className="h-row" style={{ display: "flex", gap: 10 }}>
        {(docs ?? []).length === 0 ? (
          <p style={{ color: "#636878", fontSize: 13, textAlign: "center", padding: "40px 0", width: "100%" }}>Sin documentos aún</p>
        ) : (docs ?? []).map((d, i) => {
          const s = st[d.estado] ?? { label: d.estado, color: "#636878" };
          const svgPath = d.tipo === "pdf" ? "M20 2H8c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2h1.5v2H12V9.5zm4.5 3.5c0 .83-.67 1.5-1.5 1.5H13v2h1.5v2H16v-4zm2-6h-4V5.5h4V5z"
            : d.tipo === "excel" ? "M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zm-3.5 8.5l-1.5-3 1.5-3h1l-1.5 3 1.5 3h-1zm3.5 0l-1.5-3 1.5-3h1l-1.5 3 1.5 3h-1zm2 0l-1.5-3 1.5-3h1l-1.5 3 1.5 3h-1z"
            : "M6 2c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6H6zm0 18V4h7v5h5v11H6z";
          return (
            <DocCardModal key={d.id} doc={d} s={s} svgPath={svgPath} />
          );
        })}
      </div>
    </div>
  );
}
