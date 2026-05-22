import Link from "next/link";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import V5Root from "./V5Root";
import GlowWrap from "./GlowWrap";
import DropzoneUpload from "./DropzoneUpload";
import DashboardTabs from "./DashboardTabs";
import ActividadView from "./sections/ActividadView";
import BoletasMensualesView from "./sections/BoletasMensualesView";

import SubidosFullView from "./sections/SubidosFullView";
import RevisarFullView from "./sections/RevisarFullView";
import EmitirFullView from "./sections/EmitirFullView";
import BoletasFullView from "./sections/BoletasFullView";

export default async function V5Page({ searchParams }: {
  searchParams: Promise<{ date?: string; month?: string }>;
}) {
  const usuario = (await getUsuario())!;
  const empresaId = usuario.empresa_id;
  const { date: dateParam, month: monthParam } = await searchParams;

  const supabase = await createClient();

  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth();
  if (monthParam) {
    const [py, pm] = monthParam.split("-").map(Number);
    if (py != null && pm != null && pm >= 0 && pm <= 11) { y = py; m = pm; }
  }

  const [rcvData, propsData, docsData, boletasData, boletasAllData, docsActivity, propsActivity, boletasActivity, cafsData] = await Promise.all([
    supabase.from("boletas_emitidas").select("monto_neto,monto_exento,iva,monto_total").eq("empresa_id", empresaId).neq("estado","anulada"),
    supabase.from("propuestas_ia").select("*,movimientos_raw(*,documentos_subidos(id,nombre_archivo,created_at))").eq("empresa_id", empresaId).order("created_at",{ascending:false}),
    supabase.from("documentos_subidos").select("id,nombre_archivo,tipo,estado,movimientos_detectados,created_at,progreso_ia")
      .eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(50),
    supabase.from("boletas_emitidas")
      .select("id,folio,tipo_dte,fecha_emision,receptor_rut,receptor_razon_social,monto_total,estado")
      .eq("empresa_id", empresaId).order("fecha_emision",{ascending:false}).order("folio",{ascending:false}).limit(20),
    supabase.from("boletas_emitidas")
      .select("id,folio,tipo_dte,fecha_emision,receptor_rut,receptor_razon_social,monto_neto,monto_exento,iva,monto_total,estado")
      .eq("empresa_id", empresaId).order("fecha_emision",{ascending:false}),
    supabase.from("documentos_subidos")
      .select("nombre_archivo,created_at,estado,movimientos_detectados").eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(20),
    supabase.from("propuestas_ia")
      .select("created_at,estado").eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(30),
    supabase.from("boletas_emitidas")
      .select("folio,fecha_emision,estado,monto_total").eq("empresa_id", empresaId).order("fecha_emision",{ascending:false}).limit(30),
    supabase.from("boletas_caf_mock")
      .select("id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado, fecha_vence")
      .eq("empresa_id", empresaId).order("fecha_solicitud", { ascending: false }),
  ]);

  // RCV calculation
  const rcvTotal = (rcvData.data ?? []).reduce((s,b) => ({
    docs: s.docs+1, neto: s.neto+(b.monto_neto??0), exento: s.exento+(b.monto_exento??0),
    iva: s.iva+(b.iva??0), total: s.total+(b.monto_total??0),
  }), { docs: 0, neto: 0, exento: 0, iva: 0, total: 0 });

  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
  const mes = String(now.getMonth() + 1).padStart(2, "0") + "-" + now.getFullYear();
  const esRcvExento = usuario.empresas.tipo_contribuyente === "exento";

  // Build activity feed
  const activityEvents: { type: "subida" | "aprobacion" | "emision" | "rechazo"; fecha: string; descripcion: string; detalle?: string; cantidad?: number }[] = [];

  for (const d of docsActivity.data ?? []) {
    activityEvents.push({
      type: "subida",
      fecha: d.created_at,
      descripcion: `Subiste "${d.nombre_archivo}"`,
      detalle: d.estado === "procesado" ? "Procesado" : d.estado,
      cantidad: d.movimientos_detectados ?? undefined,
    });
  }
  for (const p of propsActivity.data ?? []) {
    if (p.estado === "aprobado" || p.estado === "editado") {
      activityEvents.push({
        type: "aprobacion",
        fecha: p.created_at,
        descripcion: "Aprobaste una propuesta",
      });
    }
    if (p.estado === "pendiente") {
      activityEvents.push({
        type: "rechazo",
        fecha: p.created_at,
        descripcion: "Propuesta pendiente de revisión",
      });
    }
  }
  for (const b of boletasActivity.data ?? []) {
    activityEvents.push({
      type: "emision",
      fecha: b.fecha_emision,
      descripcion: b.estado === "anulada" ? `Boleta #${b.folio} anulada` : `Emitiste boleta #${b.folio}`,
      detalle: fmt(b.monto_total),
    });
  }
  activityEvents.sort((a, b) => b.fecha.localeCompare(a.fecha));

  // Calendar
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const wd = ["D","L","M","M","J","V","S"];
  const today = new Date().getDate();
  const isThisMonth = now.getFullYear() === y && now.getMonth() === m;
  const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  // RCV card
  const rcvCard = (
    <GlowWrap glow style={{borderRadius:20,overflow:"hidden"}}><div className="rcv-card" style={{background:"var(--surface)",borderRadius:20,padding:"14px 18px",border:"1px solid var(--border)",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)"}}>
      <div className="rcv-h" style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#E8553E" strokeWidth="2"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        <span style={{fontSize:12,fontWeight:700,color:"var(--text)",letterSpacing:"-0.02em"}}>REGISTRO DE VENTAS</span>
        <span className="mes" style={{fontSize:12,color:"var(--text2)",fontWeight:500}}>{mes}</span>
      </div>
      {esRcvExento ? (
      <div className="rcv-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:4}}>
        <div className="item" style={{padding:"10px 8px",borderRadius:10,background:"var(--bg-muted)",textAlign:"center"}}>
          <div className="lbl" style={{fontSize:8,color:"var(--text2)",marginBottom:3,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.04em"}}>Boletas emitidas</div>
          <div style={{fontSize:18,fontWeight:700,color:"var(--text)",fontVariantNumeric:"tabular-nums"}}>{rcvTotal.docs}</div>
        </div>
        <div className="item" style={{padding:"10px 8px",borderRadius:10,background:"var(--bg-muted)",textAlign:"center"}}>
          <div className="lbl" style={{fontSize:8,color:"var(--text2)",marginBottom:3,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.04em"}}>Total exento</div>
          <div style={{fontSize:18,fontWeight:700,color:"#BFDBFE",fontVariantNumeric:"tabular-nums"}}>{fmt(rcvTotal.total)}</div>
        </div>
      </div>
      ) : (
      <div className="rcv-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:5,marginTop:4}}>
        {[{l:"Boletas emitidas", v:String(rcvTotal.docs), c:"var(--text)"},{l:"Neto", v:fmt(rcvTotal.neto), c:"var(--text)"},{l:"IVA", v:fmt(rcvTotal.iva), c:"var(--text)"},{l:"Total", v:fmt(rcvTotal.total), c:"#b4f027", tot:true}].map((x,i) => (
          <div key={i} className="item" style={{padding:6,borderRadius:6,background:"var(--bg-muted)",textAlign:"center"}}>
            <div className="lbl" style={{fontSize:7,color:"var(--text2)",marginBottom:2,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.04em"}}>{x.l}</div>
            <div style={{fontSize:13,fontWeight:x.tot?700:600,color:x.c,fontVariantNumeric:"tabular-nums"}}>{x.v}</div>
          </div>
        ))}
      </div>
      )}
    </div></GlowWrap>
  );

  // Dashboard metrics
  const allBoletas = (boletasAllData.data ?? []) as { monto_total: number; fecha_emision: string; estado: string }[];
  const mesBoletas = allBoletas.filter(b => {
    const d = new Date(b.fecha_emision);
    return d.getFullYear() === y && d.getMonth() === m && b.estado !== "anulada";
  });
  const mesTotal = mesBoletas.reduce((s, b) => s + b.monto_total, 0);
  const mesCount = mesBoletas.length;

  const totalDocs = rcvTotal.docs;
  const totalGlobal = rcvTotal.total;

  // Calendar component (reusable)
  const calendar = (
    <div className="cal" style={{padding:"12px 16px",borderBottom:"1px solid var(--bg-muted)"}}>
      <div className="cal-h" style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
        <Link href={`/escritorio/v5?month=${y}-${m-1}${dateParam ? `&date=${dateParam}` : ""}`} className="nv" style={{fontSize:9,color:"var(--text2)",cursor:"pointer",padding:"2px 4px",borderRadius:3,textDecoration:"none"}} scroll={false}>‹</Link>
        <span className="m" style={{fontSize:11,fontWeight:600,color:"var(--text)"}}>{monthNames[m]} {y}</span>
        <Link href={`/escritorio/v5?month=${y}-${m+1}${dateParam ? `&date=${dateParam}` : ""}`} className="nv" style={{fontSize:9,color:"var(--text2)",cursor:"pointer",padding:"2px 4px",borderRadius:3,textDecoration:"none"}} scroll={false}>›</Link>
      </div>
      <div className="cal-days" style={{display:"flex",gap:1,overflowX:"auto",scrollbarWidth:"none"}}>
        {Array.from({length:daysInMonth},(_,i) => i+1).map(day => {
          const isToday = day === today && isThisMonth;
          return (
            <Link key={day} href={`/escritorio/v5?date=${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}&month=${y}-${m}`}
              className="cal-day"
              style={{width:26,padding:"3px 0",display:"flex",flexDirection:"column",alignItems:"center",borderRadius:4,cursor:"pointer",textDecoration:"none",color:isToday?"#b4f027":"var(--text2)",fontWeight:isToday?700:500,fontSize:10}}
              scroll={false}>
              <span className="d">{day}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );

  // Dashboard overview — metrics cards + calendar
  const dashboardOverview = (
    <div>
      {calendar}
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Resumen mensual</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: "rgba(180,240,39,.04)", border: "1px solid rgba(180,240,39,.1)",
          }}>
            <div style={{ fontSize: 9, color: "var(--text2)", fontWeight: 500, marginBottom: 4 }}>Boletas del mes</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#b4f027", fontVariantNumeric: "tabular-nums" }}>
              {mesCount}
            </div>
          </div>
          <div style={{
            padding: "12px 14px", borderRadius: 10,
            background: "rgba(232,85,62,.04)", border: "1px solid rgba(232,85,62,.1)",
          }}>
            <div style={{ fontSize: 9, color: "var(--text2)", fontWeight: 500, marginBottom: 4 }}>Total del mes</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#E8553E", fontVariantNumeric: "tabular-nums" }}>
              {fmt(mesTotal)}
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          <div style={{ padding: "8px", borderRadius: 8, background: "var(--bg-muted)", textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "var(--text2)", marginBottom: 2, textTransform: "uppercase" }}>Emitidas</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{totalDocs}</div>
          </div>
          <div style={{ padding: "8px", borderRadius: 8, background: "var(--bg-muted)", textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "var(--text2)", marginBottom: 2, textTransform: "uppercase" }}>Neto</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmt(rcvTotal.neto)}</div>
          </div>
          <div style={{ padding: "8px", borderRadius: 8, background: "var(--bg-muted)", textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "var(--text2)", marginBottom: 2, textTransform: "uppercase" }}>IVA</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmt(rcvTotal.iva)}</div>
          </div>
        </div>
        {activityEvents.length > 0 && (
          <div style={{ padding: "8px 10px", borderRadius: 8, background: "var(--bg-muted)", fontSize: 10, color: "var(--text2)" }}>
            {activityEvents.length} evento{activityEvents.length !== 1 ? "s" : ""} registrado{activityEvents.length !== 1 ? "s" : ""} este período
          </div>
        )}
      </div>
    </div>
  );

  const dashboardContent = (
    <DashboardTabs
      rcvCard={rcvCard}
      calendar={calendar}
      dashboardOverview={dashboardOverview}
      actividadContent={<ActividadView events={activityEvents} />}
      boletasEmitidasContent={<BoletasMensualesView boletas={(boletasAllData.data ?? []) as any} />}
    />
  );

  return (
    <V5Root
      dashboardContent={dashboardContent}
      subirContent={
        <div style={{maxWidth:640,margin:"0 auto",display:"flex",flexDirection:"column",gap:20}}>
          <DropzoneUpload />
          <SubidosFullView documentos={(docsData.data ?? []) as any} />
        </div>
      }
      revisarContent={
        <div style={{maxWidth:640,margin:"0 auto",display:"flex",flexDirection:"column",gap:20}}>
          <RevisarFullView propuestas={propsData.data ?? []} empresaId={empresaId} />
        </div>
      }
      emitirContent={
        <div style={{maxWidth:640,margin:"0 auto",display:"flex",flexDirection:"column",gap:20}}>
          <EmitirFullView empresaId={empresaId} tipoContribuyente={usuario.empresas.tipo_contribuyente ?? "afecto"} />
        </div>
      }
      visualizarContent={
        <div style={{maxWidth:640,margin:"0 auto",display:"flex",flexDirection:"column",gap:20}}>
          <BoletasFullView boletas={(boletasData.data ?? []) as any} />
        </div>
      }
      empresaInicial={{ rut: usuario.empresas.rut, razon_social: usuario.empresas.razon_social, giro: usuario.empresas.giro, direccion: usuario.empresas.direccion, comuna: usuario.empresas.comuna, email_sii: usuario.empresas.email_sii, tipo_contribuyente: usuario.empresas.tipo_contribuyente ?? "auto" }}
      empresaTieneCertificado={usuario.empresas.tiene_certificado_sii ?? false}
      empresaCafs={(cafsData.data ?? []) as any}
      empresaId={empresaId}
      hasBoletas={(boletasAllData.data ?? []).length > 0}
    />
  );
}
