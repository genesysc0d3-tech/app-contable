import { Suspense } from "react";
import Link from "next/link";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import RevisarClient from "../../revisar/RevisarClient";
import RevisarBoletasTabs from "@/components/RevisarBoletasTabs";
import EmitirBoletaForm from "@/components/boletas/EmitirBoletaForm";
import BoletasList from "@/components/boletas/BoletasList";
import { Calendar as CalendarIcon, X } from "@phosphor-icons/react/dist/ssr";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function fmtShort(dateStr: string) {
  const [y,m,d] = dateStr.split("-").map(Number);
  return `${d} ${["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][m-1]}`;
}

export default async function V4Page({ searchParams }: {
  searchParams: Promise<{ date?: string }>;
}) {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;
  const { date: dateParam } = await searchParams;
  const selDate = dateParam === "all" ? null : (dateParam ?? todayStr());

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#000", fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#f4f4f5", overflow: "hidden" }}>
      <div style={{ display: "flex", height: "calc(100vh - 10px)", width: "calc(100vw - 10px)", maxWidth: "calc(100vw - 10px)", background: "#18181b", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.5), 0 2px 10px rgba(0,0,0,0.3)" }}>
      <Sidebar empresa={usuario.empresas.razon_social} />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        <div style={{ padding: "24px 24px 12px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1 }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600 }}>Stats</h1>
              <p style={{ margin: 0, color: "#a1a1aa", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{selDate ? fmtShort(selDate) : "Todas las fechas"}</p>
            </div>
            <div style={{ background: "#000", color: "#fff", padding: "8px 18px", borderRadius: 20, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>{usuario.empresas.razon_social} <span>▼</span></div>
          </header>
          <Suspense fallback={<KpiSkl />}><TopCharts empresaId={empresaId} /></Suspense>
          <Suspense fallback={<CalSkl />}><CalStrip empresaId={empresaId} selDate={selDate} /></Suspense>
          <div style={{ flex: 1, minHeight: 0 }}>
            <RevisarBoletasTabs
              revisarHint={selDate ? `Del ${fmtShort(selDate)}` : "Todas"}
              revisarContent={<Suspense fallback={<Shim />} key={selDate ?? "all"}><RevisarV4 empresaId={empresaId} filterDate={selDate} /></Suspense>}
              emitirContent={<EmitirBoletaForm />}
              boletasContent={<Suspense fallback={<Shim />}><BoletasV4 empresaId={empresaId} /></Suspense>}
            />
          </div>
        </div>
      </main>
      <div style={{ width: 300, flexShrink: 0, background: "#27272a", borderLeft: "1px solid #3f3f46", overflowY: "auto", padding: "20px 14px" }}>
        <Suspense fallback={<div style={{ color: "#a1a1aa" }}>...</div>}><RightV4 empresaId={empresaId} /></Suspense>
      </div>
      </div>
    </div>
  );
}

/* ─── SIDEBAR ─── */
function Sidebar({ empresa }: { empresa: string }) {
  const items = [
    { name: "Dashboard", svg: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
    { name: "Subir", svg: '<path d="M12 5v14m-7-7l7-7 7 7" stroke="currentColor" fill="none" stroke-width="2"/>' },
    { name: "Revisar", svg: '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" fill="none" stroke-width="2"/>' },
    { name: "Emitir", svg: '<path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" fill="none" stroke-width="2"/>' },
    { name: "Boletas", svg: '<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" stroke="currentColor" fill="none" stroke-width="2"/>' },
    { name: "Config", svg: '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" fill="none" stroke-width="2"/>' },
  ];
  return (
    <aside style={{ width: 80, flexShrink: 0, background: "#1f1f22", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 0", borderRight: "1px solid #2a2a2d" }}>
      <div style={{ fontSize: 24, fontWeight: "bold", marginBottom: 40, color: "#f4f4f5" }}>AC</div>
      <style>{`.nv4:hover{opacity:1!important;color:#f4f4f5!important}`}</style>
      <nav style={{ display: "flex", flexDirection: "column", gap: 24, flexGrow: 1 }}>
        {items.map((ico) => (
          <div key={ico.name} title={ico.name} className="nv4" style={{ width: 24, height: 24, opacity: 0.5, cursor: "pointer", color: "#a1a1aa", transition: "opacity .15s" }}>
            <svg viewBox="0 0 24 24" width="24" height="24" dangerouslySetInnerHTML={{ __html: ico.svg }} />
          </div>
        ))}
      </nav>
      <div style={{ width: 40, height: 40, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", borderRadius: "50%", marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff", cursor: "pointer" }}>{empresa[0]}</div>
    </aside>
  );
}

/* ─── KPI ─── */
async function TopCharts({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const now = new Date();
  const sm = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sd = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const [pr, eh, em, ap] = await Promise.all([
    supabase.from("propuestas_ia").select("id",{count:"exact",head:true}).eq("empresa_id",empresaId).eq("estado","pendiente"),
    supabase.from("boletas_emitidas").select("id",{count:"exact",head:true}).eq("empresa_id",empresaId).gte("created_at",sd),
    supabase.from("boletas_emitidas").select("id",{count:"exact",head:true}).eq("empresa_id",empresaId).gte("created_at",sm),
    supabase.from("propuestas_ia").select("id",{count:"exact",head:true}).eq("empresa_id",empresaId).in("estado",["aprobado","editado"]).gte("created_at",sm),
  ]);
  const cards = [
    { title: "Tasks Completed", value: ap.count??0, change: "+12%", col: "+", bg: "linear-gradient(180deg,#3b5998,#1e2a47)" },
    { title: "New Tasks", value: pr.count??0, change: "+8%", col: "g", bg: "linear-gradient(180deg,#5c7c5a,#2c3e2c)" },
    { title: "Emitidas Hoy", value: eh.count??0, change: "+4%", col: "+", bg: "linear-gradient(180deg,#3b7a8a,#1e3d45)" },
    { title: "Emitidas Mes", value: em.count??0, pct: true, change: "+8%", col: "g", bg: "linear-gradient(180deg,#4a633d,#25311e)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
      {cards.map((c,i) => (
        <div key={i} style={{ borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between", height: 120, position: "relative", overflow: "hidden", background: c.bg }}>
          <div style={{ position: "absolute", bottom: -20, left: 0, width: "100%", height: 50, background: "rgba(0,0,0,0.3)", filter: "blur(10px)" }} />
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,0.7)", lineHeight: 1.4 }}>{c.title}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: 26, fontWeight: "bold" }}>{c.pct ? <>{c.value}<span style={{fontSize:13}}>%</span></> : c.value}</div>
            <div style={{ fontSize: 11, color: c.col === "g" ? "#d9f95d" : "#ff6b6b" }}>{c.change}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
function KpiSkl() { return <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,height:120}}>{[1,2,3,4].map(i=><div key={i} style={{borderRadius:14,background:"#222"}}/>)}</div>; }

/* ─── CALENDAR ─── */
async function CalStrip({ empresaId, selDate }: { empresaId: string; selDate: string|null }) {
  const supabase = await createClient();
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const sm = new Date(y,m,1).toISOString(), em = new Date(y,m+1,1).toISOString();
  const days = new Date(y,m+1,0).getDate();
  const [pr, dr] = await Promise.all([
    supabase.from("propuestas_ia").select("created_at,estado").eq("empresa_id",empresaId).gte("created_at",sm).lt("created_at",em),
    supabase.from("documentos_subidos").select("created_at").eq("empresa_id",empresaId).gte("created_at",sm).lt("created_at",em),
  ]);
  const byDay = new Map<number,{p:number;a:number;d:number}>();
  for (let d=1; d<=days; d++) byDay.set(d,{p:0,a:0,d:0});
  for (const p of pr.data??[]) { const day=new Date(p.created_at).getDate(); const inf=byDay.get(day)!; if(p.estado==="pendiente") inf.p++; else if(["aprobado","editado"].includes(p.estado)) inf.a++; }
  for (const d of dr.data??[]) { byDay.get(new Date(d.created_at).getDate())!.d++; }
  const today = now.getDate();
  const selDay = selDate ? (()=>{const [sy,sm,sd]=selDate.split("-").map(Number); return sy===y&&sm===m+1?sd:null;})() : null;
  const wd = ["D","L","M","M","J","V","S"];
  return (
    <div style={{ background: "#000", borderRadius: 18, padding: "12px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 2, overflowX: "auto", paddingBottom: 2 }}>
        <CalendarIcon size={13} weight="bold" style={{color:"#a1a1aa",marginRight:6}} />
        {selDay && <a href="/escritorio/v4" style={{display:"flex",alignItems:"center",gap:2,fontSize:9,color:"#a1a1aa",textDecoration:"none",padding:"2px 6px",borderRadius:4,background:"#1f1f22",marginRight:4}}><X size={7} weight="bold"/> Todo</a>}
        {Array.from({length:days},(_,i) => i+1).map(day => {
          const info = byDay.get(day)!;
          const ds = `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const isSel = day === selDay, isToday = day === today;
          return (
            <a key={day} href={`/escritorio/v4?date=${ds}`} style={{textDecoration:"none",display:"flex",flexDirection:"column",alignItems:"center",gap:1,width:26,padding:"3px 0",borderRadius:5,cursor:"pointer",background:isSel?"#d9f95d":isToday?"#333":"transparent",color:isSel?"#000":"#a1a1aa"}}>
              <span style={{fontSize:6,textTransform:"uppercase",lineHeight:1}}>{wd[new Date(y,m,day).getDay()]}</span>
              <span style={{fontSize:10,fontWeight:500,lineHeight:1}}>{day}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
function CalSkl() { return <div style={{background:"#000",borderRadius:18,height:48}}/>; }

/* ─── REVISAR ─── */
async function RevisarV4({ empresaId, filterDate }: { empresaId: string; filterDate: string|null }) {
  const supabase = await createClient();
  const [{ data: pr }, { data: cl }] = await Promise.all([
    supabase.from("propuestas_ia").select("*,movimientos_raw(*,documentos_subidos(id,nombre_archivo,created_at))").eq("empresa_id",empresaId).order("created_at",{ascending:false}),
    supabase.from("clientes").select("id,nombre,rut").eq("empresa_id",empresaId).order("nombre",{ascending:true}),
  ]);
  const all = pr ?? [];
  const filtered = filterDate ? all.filter(p => p.created_at?.startsWith(filterDate)) : all;
  return <RevisarClient propuestas={filtered} clientes={cl ?? []} empresaId={empresaId} layout="desktop" />;
}

async function BoletasV4({ empresaId }: { empresaId: string }) {
  return <BoletasList empresaId={empresaId} />;
}

/* ─── RIGHT PANEL ─── */
async function RightV4({ empresaId }: { empresaId: string }) {
  const supabase = await createClient();
  const now = new Date();
  const sm = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const [pend, emit] = await Promise.all([
    supabase.from("propuestas_ia").select("id",{count:"exact",head:true}).eq("empresa_id",empresaId).eq("estado","pendiente"),
    supabase.from("boletas_emitidas").select("id",{count:"exact",head:true}).eq("empresa_id",empresaId).gte("created_at",sm),
  ]);
  const today = now.toLocaleDateString("es-CL",{weekday:"long",day:"numeric",month:"short"});
  return (
    <>
      <header style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div style={{display:"flex",gap:3,background:"#000",padding:3,borderRadius:6}}>
          <div style={{width:18,height:9,background:"#d9f95d",borderRadius:2}} /><div style={{width:9,height:9,background:"#555",borderRadius:2}} />
        </div>
        <div style={{fontSize:12,fontWeight:600}}>{today}</div>
        <div style={{cursor:"pointer",fontSize:14}}>🔔</div>
      </header>
      <div style={{fontSize:10,color:"#a1a1aa",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span>📋 Pendientes</span><span style={{color:"#d9f95d",fontWeight:600,fontSize:15}}>{pend.count??0}</span></div>
        <div style={{display:"flex",justifyContent:"space-between"}}><span>📅 Emitidos mes</span><span style={{color:"#f4f4f5",fontWeight:600,fontSize:15}}>{emit.count??0}</span></div>
      </div>
      <div style={{position:"relative",flexGrow:1,display:"flex",flexDirection:"column",gap:16}}>
        {[{time:"8:30",title:"Revisar propuestas",person:"Pendientes",color:"#4a3b7a"},{time:"9:00",title:"Emitir boletas",person:`${emit.count??0} emitidas`,color:"#3b7a8a"},{time:"10:30",title:"Subir documentos",person:"Cartolas",color:"#3b7a4a"},{time:"11:00",title:"Estado folios",person:"Verificar",color:"#3b3b7a"}].map((ev,i)=>(
          <div key={i} style={{background:"#333",padding:"8px 10px",borderRadius:8,marginLeft:12,zIndex:2,position:"relative",display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:24,height:24,borderRadius:"50%",background:ev.color,flexShrink:0}} />
            <div><div style={{fontSize:12,fontWeight:500}}>{ev.title}</div><div style={{fontSize:9,color:"#a1a1aa"}}>{ev.time} · {ev.person}</div></div>
          </div>
        ))}
      </div>
    </>
  );
}
function Shim() { return <div style={{background:"#222",borderRadius:10,height:180}}/>; }
