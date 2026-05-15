import { Suspense } from "react";
import Link from "next/link";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import RevisarClient from "../../revisar/RevisarClient";
import { Gear, ChartBar, Files, CalendarDots, Receipt, MagnifyingGlass, Bell } from "@phosphor-icons/react/dist/ssr";
import CalendarYear from "./CalendarYear";
import EmitirTab from "./EmitirTab";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; tab?: string }>;
}) {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;
  const { date: dateParam, tab: tabParam } = await searchParams;
  const selectedDate = dateParam === "all" ? null : (dateParam ?? todayStr());
  const activeTab = tabParam ?? "dashboard";

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#0f1014", color: "#e8eaf0", fontFamily: "'DM Sans', sans-serif" }}>
      <Sidebar activeTab={activeTab} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar */}
        <div style={{ display: "flex", alignItems: "center", padding: "14px 24px", borderBottom: "1px solid #2a2d36", gap: 12, flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.3px", color: "#e8eaf0", margin: 0 }}>
              {activeTab === "dashboard" ? "Facturación Electrónica" : activeTab === "emitir" ? "Emitir documentos" : activeTab === "revisar" ? "Revisar propuestas" : activeTab === "boletas" ? "Boletas emitidas" : "Configuración"}
            </h1>
            <p style={{ fontSize: 12, color: "#636878", margin: "1px 0 0" }}>
              {activeTab === "dashboard" ? "Resumen de emisiones y documentos" : "Gestión de documentos tributarios"}
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1e2028", border: "1px solid #2a2d36", borderRadius: 9, padding: "6px 12px" }}>
              <MagnifyingGlass size={14} color="#636878" />
              <input placeholder="Buscar..." style={{ background: "none", border: "none", outline: "none", color: "#e8eaf0", fontSize: 13, width: 120 }} />
            </div>
            <IconButton icon={Bell} notif />
            <UserPill name={usuario.empresas.razon_social} />
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Center column */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            {activeTab === "dashboard" && (
              <>
                <Suspense fallback={<KpiSkeleton />}>
                  <KpiRow empresaId={empresaId} />
                </Suspense>
                <CalendarYear empresaId={empresaId} />
                <Suspense fallback={<div style={{ height: 200, background: "#16181d", borderRadius: 14, marginTop: 16 }} />}>
                  <ChartSection empresaId={empresaId} />
                </Suspense>
                <Suspense fallback={<div style={{ height: 150, background: "#16181d", borderRadius: 14, marginTop: 16 }} />}>
                  <RecentTable empresaId={empresaId} filterDate={selectedDate} />
                </Suspense>
              </>
            )}
            {activeTab === "emitir" && <EmitirTab empresaId={empresaId} />}
            {activeTab === "revisar" && (
              <Suspense fallback={<div style={{ height: 300, background: "#16181d", borderRadius: 14 }} />}>
                <RevisarView empresaId={empresaId} filterDate={selectedDate} />
              </Suspense>
            )}
            {activeTab === "boletas" && (
              <div style={{ color: "#636878", fontSize: 14 }}>Sección de boletas emitidas — próximamente</div>
            )}
            {activeTab === "config" && (
              <div style={{ color: "#636878", fontSize: 14 }}>Configuración de empresa — próximamente</div>
            )}
          </div>

          {/* Right panel (only in dashboard) */}
          {activeTab === "dashboard" && (
            <div style={{ width: 290, borderLeft: "1px solid #2a2d36", overflowY: "auto", padding: "20px 16px", flexShrink: 0 }}>
              <RightPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── SIDEBAR ─── */

function Sidebar({ activeTab }: { activeTab: string }) {
  const items = [
    { id: "dashboard", icon: ChartBar },
    { id: "emitir", icon: Files },
    { id: "revisar", icon: Receipt },
    { id: "boletas", icon: CalendarDots },
    { id: "config", icon: Gear },
  ];

  return (
    <>
      <style>{`.nav-item-dash:hover{background:#1e2028!important;color:#9499a8!important}`}</style>
      <div style={{ width: 72, background: "#16181d", borderRight: "1px solid #2a2d36", display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 0 12px", gap: 6, flexShrink: 0 }}>
        <Link href="/escritorio/v3" scroll={false} style={{ textDecoration: "none" }}>
          <div style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#b4f027"/><rect x="8" y="8" width="6" height="16" rx="2" fill="#0f1014"/><rect x="18" y="12" width="6" height="12" rx="2" fill="#0f1014"/></svg>
          </div>
        </Link>
        {items.map((item) => (
          <Link key={item.id} href={`/escritorio/v3?tab=${item.id}`} scroll={false} style={{ textDecoration: "none" }}>
            <NavItem icon={item.icon} active={activeTab === item.id} />
          </Link>
        ))}
        <div style={{ marginTop: "auto" }}>
          <a href="/empresa" style={{ textDecoration: "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #6b7280, #374151)", border: "2px solid #333742", position: "relative", cursor: "pointer" }}>
              <div style={{ position: "absolute", bottom: 1, right: 1, width: 9, height: 9, borderRadius: "50%", background: "#22c55e", border: "2px solid #16181d" }} />
            </div>
          </a>
        </div>
      </div>
    </>
  );
}

function NavItem({ icon: Icon, active }: { icon: typeof ChartBar; active?: boolean }) {
  return (
    <div className="nav-item-dash" style={{
      width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
      borderRadius: 10, cursor: "pointer",
      background: active ? "#b4f027" : "transparent",
      color: active ? "#000" : "#636878",
      transition: "all .15s",
    }}>
      <Icon size={20} weight={active ? "fill" : "bold"} />
    </div>
  );
}

/* ─── HELPERS ─── */

function IconButton({ icon: Icon, notif }: { icon: typeof Bell; notif?: boolean }) {
  return (
    <div style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 9, background: "#1e2028", border: "1px solid #2a2d36", cursor: "pointer", color: "#9499a8", position: "relative" }}>
      <Icon size={17} />
      {notif && <div style={{ position: "absolute", top: 6, right: 6, width: 7, height: 7, borderRadius: "50%", background: "#b4f027", border: "1.5px solid #1e2028" }} />}
    </div>
  );
}

function UserPill({ name }: { name: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#1e2028", border: "1px solid #2a2d36", borderRadius: 9, padding: "5px 10px 5px 5px", cursor: "pointer" }}>
      <div style={{ width: 26, height: 26, borderRadius: 6, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>A</div>
      <span style={{ fontSize: 13, fontWeight: 500, color: "#e8eaf0" }}>{name.slice(0, 12)}</span>
    </div>
  );
}

function KpiSkeleton() {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18, height: 120 }} />;
}

/* ─── KPI ─── */

async function KpiRow({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const [pendientes, emitidosHoy, emitidosMes, aprobadosMes] = await Promise.all([
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("estado", "pendiente"),
    supabase.from("boletas_emitidas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).gte("created_at", startDay),
    supabase.from("boletas_emitidas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).gte("created_at", startMonth),
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).in("estado", ["aprobado", "editado"]).gte("created_at", startMonth),
  ]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18 }}>
      <KpiCard icon={ChartBar} value={`${emitidosHoy.count ?? 0}`} label="Emitidas hoy" sub="Tasa de emisión" color="#b4f027" iconBg="rgba(180,240,39,0.12)" />
      <KpiCard icon={Files} value={`${pendientes.count ?? 0}`} label="Pendientes" sub="Por revisar" color="#5b9cf6" iconBg="rgba(91,156,246,0.12)" />
      <KpiCard icon={Receipt} value={`${emitidosMes.count ?? 0}`} label="Emitidas mes" sub="Total del período" color="#a78bfa" iconBg="rgba(167,139,250,0.12)" />
      <KpiCard icon={ChartBar} value={`${aprobadosMes.count ?? 0}`} label="Aprobadas" sub="Tasa de éxito" color="#22c55e" iconBg="rgba(34,197,94,0.12)" />
    </div>
  );
}

function KpiCard({ icon: Icon, value, label, sub, color, iconBg }: {
  icon: typeof ChartBar; value: string; label: string; sub: string; color: string; iconBg: string;
}) {
  return (
    <div style={{ background: "#16181d", border: "1px solid #2a2d36", borderRadius: 14, padding: "16px 18px 14px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: iconBg }}>
          <Icon size={18} color={color} weight="fill" />
        </div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-1px", lineHeight: 1, marginTop: 6, color: "#e8eaf0" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#636878", marginTop: 2 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6, fontSize: 11, color: "#636878" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
        {sub}
      </div>
    </div>
  );
}

/* ─── CHART ─── */

async function ChartSection({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const year = new Date().getFullYear();
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  const counts = await Promise.all(months.map(async (_, i) => {
    const start = new Date(year, i, 1).toISOString();
    const end = new Date(year, i + 1, 1).toISOString();
    const { count } = await supabase.from("boletas_emitidas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).gte("created_at", start).lt("created_at", end);
    return count ?? 0;
  }));

  const max = Math.max(...counts, 1);
  const currentMonth = new Date().getMonth();

  return (
    <div style={{ background: "#16181d", border: "1px solid #2a2d36", borderRadius: 14, padding: "18px 20px", marginTop: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600, color: "#e8eaf0", margin: "0 0 14px" }}>Emisiones mensuales</h3>
      <div style={{ display: "flex", alignItems: "end", gap: 6, height: 120 }}>
        {counts.map((c, i) => {
          const h = Math.max((c / max) * 100, 4);
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 9, color: "#636878" }}>{c}</span>
              <div style={{ width: "100%", height: h, borderRadius: "6px 6px 2px 2px", background: i === currentMonth ? "#b4f027" : "#2a2d36", minHeight: 4 }} />
              <span style={{ fontSize: 9, color: i === currentMonth ? "#b4f027" : "#636878", fontWeight: i === currentMonth ? 600 : 400 }}>{months[i]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── RECENT TABLE ─── */

async function RecentTable({ empresaId, filterDate }: { empresaId: string; filterDate: string | null }) {
  const supabase = await createClient();
  const { data: propuestas } = await supabase
    .from("propuestas_ia")
    .select("*, movimientos_raw(descripcion, fecha, monto)")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(8);
  const all = propuestas ?? [];
  const filtered = filterDate ? all.filter((p) => p.created_at?.startsWith(filterDate)) : all;

  return (
    <div style={{ background: "#16181d", border: "1px solid #2a2d36", borderRadius: 14, padding: "16px 18px", marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: "#e8eaf0", margin: 0 }}>Movimientos recientes</h3>
        <span style={{ fontSize: 12, color: "#5b9cf6", cursor: "pointer", fontWeight: 500 }}>Ver todo</span>
      </div>
      {filtered.length === 0 ? (
        <p style={{ color: "#636878", fontSize: 13, textAlign: "center", padding: 20 }}>Sin movimientos</p>
      ) : filtered.slice(0, 6).map((p) => {
        const monto = (p.movimientos_raw as any)?.monto;
        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #2a2d36" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.estado === "pendiente" ? "#f59e0b" : p.estado === "aprobado" ? "#22c55e" : "#636878" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#e8eaf0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.movimientos_raw?.descripcion || "Sin descripción"}</div>
              <div style={{ fontSize: 11, color: "#636878", marginTop: 1 }}>{(p.movimientos_raw as any)?.fecha?.slice(0, 10)}</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#e8eaf0", whiteSpace: "nowrap" }}>
              {monto ? `$${Number(monto).toLocaleString("es-CL")}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── REVISAR ─── */

async function RevisarView({ empresaId, filterDate }: { empresaId: string; filterDate: string | null }) {
  const supabase = await createClient();
  const [{ data: propuestas }, { data: clientes }] = await Promise.all([
    supabase.from("propuestas_ia").select("*, movimientos_raw(*, documentos_subidos(id, nombre_archivo, created_at))").eq("empresa_id", empresaId).order("created_at", { ascending: false }),
    supabase.from("clientes").select("id, nombre, rut").eq("empresa_id", empresaId).order("nombre", { ascending: true }),
  ]);
  const all = propuestas ?? [];
  const filtered = filterDate ? all.filter((p) => p.created_at?.startsWith(filterDate)) : all;
  return <RevisarClient propuestas={filtered} clientes={clientes ?? []} empresaId={empresaId} layout="desktop" />;
}

/* ─── RIGHT PANEL ─── */

function RightPanel() {
  const items = [
    { label: "Boleta emitida", sub: "Folio #0042 — $150.000", time: "hace 5 min", color: "#b4f027" },
    { label: "Propuesta aprobada", sub: "Transferencia recibida", time: "hace 18 min", color: "#22c55e" },
    { label: "Cartola subida", sub: "santander.xlsx — 238 mov.", time: "hace 1 h", color: "#5b9cf6" },
    { label: "Documento procesado", sub: "IA clasificó 238 mov.", time: "hace 2 h", color: "#a78bfa" },
    { label: "Folios restantes", sub: "42 disponibles", time: "hace 3 h", color: "#f59e0b" },
  ];

  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "#e8eaf0", margin: "0 0 16px" }}>Actividad reciente</h3>
      {items.map((item, i) => (
        <div key={i} style={{ display: "flex", gap: 10, paddingBottom: 12, marginBottom: 12, borderBottom: i < items.length - 1 ? "1px solid #2a2d36" : "none" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color, marginTop: 4, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#e8eaf0" }}>{item.label}</div>
            <div style={{ fontSize: 11, color: "#636878", marginTop: 1 }}>{item.sub}</div>
            <div style={{ fontSize: 10, color: "#9499a8", marginTop: 2 }}>{item.time}</div>
          </div>
        </div>
      ))}
      <div style={{ marginTop: 24, background: "#1e2028", borderRadius: 12, border: "1px solid #2a2d36", padding: 16 }}>
        <h4 style={{ fontSize: 12, fontWeight: 600, color: "#e8eaf0", margin: "0 0 8px" }}>Resumen del mes</h4>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#636878", marginBottom: 4 }}>
          <span>Total emitido</span>
          <span style={{ color: "#b4f027", fontWeight: 600 }}>$2.450.000</span>
        </div>
      </div>
    </div>
  );
}
