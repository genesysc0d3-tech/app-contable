import { notFound } from "next/navigation";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportMode } from "@/lib/dev/support-mode";
import V5Root from "./V5Root";
import GlowWrap from "./GlowWrap";
import MesaController from "./MesaController";
import { fetchMesaDateDependent } from "./mesa-data";
import RcvViewWrapper from "./RcvViewWrapper";
import RegistrosToggleCard from "./RegistrosToggleCard";
import EmpresaBrand from "./EmpresaBrand";
import TeamBusinessPanel from "./TeamBusinessPanel";
import UsageCountersPanel from "./UsageCountersPanel";
import { EmisionDirectaAction, MassDTEAction, HeaderActionsRow, RCVButton } from "./LeftQuickActions";
import type { SearchItem } from "@/lib/tree-structure";
import { listarEmpresasSelector, listarEquipoBusiness, listarResumenCupos } from "./actions";
import { chileDateString } from "@/lib/chile-date";
import type { BoletasEmisionProveedor, FacturasEmisionProveedor } from "../../empresa/actions";
import type { CAFRow } from "../../empresa/CAFPanel";

function mapBoletasProveedor(raw: string | null | undefined): BoletasEmisionProveedor {
  if (raw === "sii_local") return "sii_local";
  if (raw === "simpleapi") return "simpleapi";
  return "mock";
}

function mapFacturasProveedor(raw: string | null | undefined): FacturasEmisionProveedor {
  if (raw === "simpleapi") return "simpleapi";
  return "mock";
}

type BoletaRow = {
  id: string;
  folio: number | null;
  tipo_dte: number;
  fecha_emision: string;
  created_at?: string | null;
  receptor_rut?: string | null;
  receptor_razon_social: string | null;
  monto_total: number;
  estado: string;
};

type SearchData = Record<string, unknown>;

function searchData(value: unknown): SearchData {
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}

export default async function V5Page({ searchParams }: {
  searchParams: Promise<{ date?: string; month?: string; view?: string }>;
}) {
  const sessionUsuario = (await getUsuario())!;
  const support = await getDevSupportMode();
  const supportMode = support?.ok ? support : null;
  const usuario = supportMode
    ? ({ ...sessionUsuario, empresa_id: supportMode.empresaId, empresas: supportMode.empresa } as typeof sessionUsuario)
    : sessionUsuario;
  if (!usuario.empresas) notFound();
  const supportReadOnlyReason = supportMode ? "Modo soporte: solo lectura" : undefined;
  const empresaId = usuario.empresa_id;
  const boletasProveedor = mapBoletasProveedor(usuario.empresas.boletas_emision_proveedor ?? usuario.empresas.emision_proveedor);
  const facturasProveedor = mapFacturasProveedor(usuario.empresas.facturas_emision_proveedor);
  const { date: dateParam, month: monthParam, view } = await searchParams;

  const supabase = supportMode ? supportMode.sb : await createClient();

  // Bundle inicial date-dependiente de la mesa (panel derecho + calendario).
  // El toggle de día/semana/mes lo recarga client-side vía `cargarMesa` sin
  // navegar; aquí solo se siembra el estado inicial (SSR).
  const mesaInicial = await fetchMesaDateDependent(supabase, empresaId, {
    giro: usuario.empresas.giro,
    razon_social: usuario.empresas.razon_social,
    tipo_contribuyente: usuario.empresas.tipo_contribuyente,
  }, { date: dateParam, month: monthParam, view });

  // Año/mes actuales EN CHILE (no UTC del server, que en Vercel corre): base
  // del mes RCV (resumen de ventas + visor), date-independiente del calendario.
  const nowChile = chileDateString(new Date());
  const curYear = Number(nowChile.slice(0, 4));
  const curMonth = Number(nowChile.slice(5, 7)) - 1; // 0-indexed

  // RCV: mes actual de Chile.
  const firstThisMonth = `${curYear}-${String(curMonth + 1).padStart(2, "0")}-01`;
  const firstNextMonth = curMonth === 11 ? `${curYear + 1}-01-01` : `${curYear}-${String(curMonth + 2).padStart(2, "0")}-01`;

  // Date-INDEPENDIENTE: clientes (selector de receptor) y CAFs de la empresa. Se
  // cargan una vez; el toggle del calendario no los re-consulta (eso lo cubre
  // `mesaInicial` / `cargarMesa`). El resumen de ventas del rango va en mesaInicial.
  const [clData, cafsData] = await Promise.all([
    supabase.from("clientes").select("id,nombre,rut").eq("empresa_id", empresaId).order("nombre",{ascending:true}),
    supabase.from("boletas_caf_mock")
      .select("id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado, fecha_vence")
      .eq("empresa_id", empresaId).order("fecha_solicitud", { ascending: false }),
  ]);

  const empresaLogoUrl = `/api/empresa/logo/${empresaId}`;
  const [empresasSelector, equipoBusiness, resumenCupos] = await Promise.all([
    listarEmpresasSelector(),
    listarEquipoBusiness(),
    listarResumenCupos(),
  ]);
  const empresasSelectorItems = empresasSelector.ok ? empresasSelector.empresas : [];
  const cuentaMultiempresa = empresasSelector.ok ? empresasSelector.multiempresa : false;

  const esRcvExento = usuario.empresas.tipo_contribuyente === "exento";

  // Date-INDEPENDIENTE: boletas del mes para el visor RCV + datos de
  // búsqueda/historial (últimos 100 de docs/boletas/propuestas). Van en paralelo
  // (la latencia ≈ la query más lenta). El avance del pipeline por documento
  // viaja ahora en el bundle date-dependiente de la mesa (`mesaInicial`).
  const [boletasRcvRes, searchTriple] = await Promise.all([
    supabase.from("boletas_emitidas")
      .select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,estado")
      .eq("empresa_id", empresaId)
      .gte("fecha_emision", firstThisMonth)
      .lt("fecha_emision", firstNextMonth)
      .order("fecha_emision",{ascending:false})
      .order("folio",{ascending:false})
      .limit(1000),
    Promise.all([
      supabase.from("documentos_subidos").select("id,nombre_archivo,tipo,estado,movimientos_detectados,created_at,progreso_ia,tipo_operacion_hint,glosa_comun,glosa_activa")
        .eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(100),
      supabase.from("boletas_emitidas").select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,estado")
        .eq("empresa_id", empresaId).order("fecha_emision",{ascending:false}).order("folio",{ascending:false}).limit(100),
      supabase.from("propuestas_ia").select("*,movimientos_raw(*,documentos_subidos(id,nombre_archivo,created_at))")
        .eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(100),
    ]),
  ]);
  const boletasRcvData = boletasRcvRes.data;
  const [searchDocsData, searchBoletasData, searchPropsData] = searchTriple;

  // Search & history items
  const searchHistoryItems: SearchItem[] = [];
  for (const doc of (searchDocsData.data ?? []).slice(0, 100)) {
    searchHistoryItems.push({
      id: "doc-" + doc.id, label: doc.nombre_archivo,
      subtitle: (doc.movimientos_detectados ?? 0) + " movimientos · " + doc.estado,
      type: "documento", fecha: doc.created_at, data: searchData(doc),
    });
  }
  for (const bol of (searchBoletasData.data ?? []).slice(0, 100)) {
    const fechaRegistro = bol.created_at ?? bol.fecha_emision;
    searchHistoryItems.push({
      id: "bol-" + bol.id,
      label: "Boleta #" + bol.folio + " · " + (bol.receptor_razon_social ?? "—"),
      subtitle: (bol.tipo_dte === 39 ? "AFECTA" : "EXENTA") + " · $" + Math.round(bol.monto_total).toLocaleString("es-CL"),
      type: "boleta", fecha: fechaRegistro, monto: bol.monto_total, data: searchData(bol),
    });
  }
  for (const prop of (searchPropsData.data ?? []).slice(0, 100)) {
    searchHistoryItems.push({
      id: "prop-" + prop.id,
      label: "Propuesta · " + (prop.movimientos_raw?.descripcion ?? "—"),
      subtitle: "Confianza " + Math.round((prop.confianza ?? 0) * 100) + "%",
      type: "propuesta", fecha: prop.created_at, data: searchData(prop),
    });
  }
  searchHistoryItems.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  // RCV content for right column
  const rcvContent = (
    <RcvViewWrapper boletas={(boletasRcvData ?? []) as BoletaRow[]} boletasYear={curYear} boletasMonth={curMonth} initialYear={mesaInicial.calendar.y} initialMonth={mesaInicial.calendar.m} />
  );

  const dashboardContent = (
    <>
      <style>{`
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif}
:root{--accent:#E8553E;--accent-light:rgba(232,85,62,.1);--muted-light:#888}
.ep-glow-card{transition:box-shadow 600ms cubic-bezier(0.22,1,0.36,1)}
.ep-glow-card:hover{box-shadow:0 0 40px -8px rgba(232,85,62,0.40)!important}
.app{display:grid;grid-template-columns:minmax(0,2.1fr) minmax(0,7.9fr);max-width:1400px;margin:0 auto;gap:20px;height:calc(100vh - 94px);padding:0 0;position:relative;background:transparent;min-height:0;overflow:visible}
/* Móvil/tablet: una sola columna apilada con scroll vertical; el panel de
   trabajo (tabs) conserva una altura útil propia. */
@media (max-width: 900px){
  .app{grid-template-columns:1fr;height:auto;gap:14px;padding:0 10px 24px}
  .app .left-col{padding-left:0!important}
  .app > :last-child{height:78vh;min-height:480px}
}
.v5-calendar-wrap,.left-col{transition:opacity .28s cubic-bezier(.22,1,.36,1),transform .28s cubic-bezier(.22,1,.36,1)}
:root.v5-dashboard-fullscreen .v5-calendar-wrap{opacity:0;transform:translateY(-8px);pointer-events:none}
:root.v5-dashboard-fullscreen .left-col{opacity:0;transform:translateX(-10px);pointer-events:none}
.left-glass{background:rgba(255,255,255,.03);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.06);border-radius:20px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 8px 32px rgba(0,0,0,.3)}
.panel-hd-txt .plantilla{margin-left:auto;display:flex;align-items:center;gap:3px;padding:4px 8px;border-radius:5px;border:1px solid rgba(255,255,255,.06);background:transparent;color:var(--text2);font-size:9px;font-weight:500;cursor:pointer;white-space:nowrap;transition:all .15s}
.panel-hd-txt .plantilla:hover{background:var(--bg-muted);color:var(--text)}
.panel-hd-txt .plantilla svg{width:11px;height:11px}
.e-scroll{overflow-y:auto;flex:1;scrollbar-width:none}
.e-scroll::-webkit-scrollbar{display:none}
.e-scroll .sec{padding:10px 16px}
.e-scroll .sec:first-child{padding-top:14px}
.e-scroll .sec:last-child{padding-bottom:14px}
.dz{padding:14px;border-radius:10px;border:1.5px dashed rgba(255,255,255,.06);display:flex;align-items:center;gap:10px;cursor:pointer;transition:all .2s}
.dz:hover{border-color:rgba(180,240,39,.3);background:rgba(180,240,39,.02)}
.dz-icon{width:32px;height:32px;border-radius:8px;background:rgba(180,240,39,.06);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dz-icon svg{width:16px;height:16px;color:#b4f027}
.dz-txt h4{font-size:12px;font-weight:600}
.dz-txt p{font-size:10px;color:var(--text2);margin-top:1px}
.dz-fmts{display:flex;align-items:center;gap:5px;margin-top:5px;font-size:9px;color:var(--text3);flex-wrap:wrap}
.dz-fmts .f{display:flex;align-items:center;gap:2px;color:var(--text3);line-height:1}
.doc-card{background:var(--bg-muted);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:all .15s}
.doc-card:hover{border-color:var(--text3)}
.dh{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer}
.dh:hover{background:var(--bg-muted)}
.dh .dt{width:4px;height:4px;border-radius:50%;flex-shrink:0}
.dh .nm{flex:1;font-size:11px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dh .st{font-size:9px;font-weight:600}.dh .st.ls{color:#22c55e}.dh .st.pc{color:#5b9cf6}.dh .st.er{color:#ef4444}.dh .st.pd{color:#f59e0b}
.dh .mt{font-size:9px;color:var(--text2);flex-shrink:0}
.db{padding:0 10px 8px;display:flex;flex-direction:column;gap:4px}
.da{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:2px 0}
.da button{font-size:9px;padding:3px 8px;border-radius:5px;border:none;cursor:pointer;font-weight:500;display:flex;align-items:center;gap:4px;transition:all .15s}
.da .ht{background:rgba(245,158,11,.06);color:#f59e0b;font-size:8px}
.da .ud{background:rgba(239,68,68,.06);color:#ef4444;font-size:8px}
.da .mp{background:rgba(180,240,39,.06);color:#b4f027;font-size:8px}
.da .cl{background:rgba(239,68,68,.06);color:#ef4444;font-size:8px}
.da button:hover{filter:brightness(1.2)}
.om-btn{display:flex;align-items:center;gap:4px;font-size:9px;color:#f59e0b;background:none;border:none;cursor:pointer;padding:2px 4px;border-radius:4px;transition:all .15s}
.om-btn:hover{background:rgba(245,158,11,.06)}
.om-list{display:flex;flex-direction:column;gap:2px;padding:2px 0}
.om-it{display:flex;align-items:center;gap:6px;padding:4px 6px;font-size:9px;color:var(--text2);border-radius:4px}
.om-it:hover{background:var(--bg-muted)}
.om-it .dt{width:3px;height:3px;border-radius:50%;background:#f59e0b;flex-shrink:0}
.om-it .nm{flex:1;color:var(--text2)}
.om-it .ifo{color:var(--text3);font-size:8px}
.warn{padding:6px 8px;border-radius:6px;background:rgba(245,158,11,.04);border:1px solid rgba(245,158,11,.08);font-size:9px;color:#f59e0b;display:flex;align-items:flex-start;gap:4px;line-height:1.4}
.pr{display:flex;flex-direction:column;gap:2px}
.prh{display:flex;justify-content:space-between;font-size:9px;color:var(--text2)}
.prh span:last-child{color:#E8553E;font-weight:600}
.prb{height:3px;overflow:hidden;border-radius:3px;background:rgba(255,255,255,.06)}
.prf{height:100%;border-radius:3px;background:#E8553E;position:relative;transition:width .7s ease-out}
.prs{position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);animation:sh 2s infinite}
@keyframes sh{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.prl{font-size:8px;color:var(--text2);display:flex;align-items:center;gap:3px}
.prl .pd{width:4px;height:4px;border-radius:50%;background:#E8553E;animation:pl 1.5s infinite}
@keyframes pl{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
.hist-btn{width:100%;display:flex;align-items:center;justify-content:space-between;padding:6px 0;border:none;background:none;cursor:pointer;font-size:10px;font-weight:600;color:var(--text);border-top:1px solid var(--bg-muted);transition:all .15s}
.hist-btn:hover{color:#b4f027}
.btn-cancel{padding:8px 14px;border:none;border-radius:8px;background:var(--surface2);font-size:10px;font-weight:600;color:var(--text2);cursor:pointer;transition:all .2s}
.btn-cancel:hover{background:var(--surface);color:var(--text)}
.ac-row{display:flex;gap:6px;justify-content:flex-end}
.cal{padding:12px 16px;border-bottom:1px solid var(--bg-muted);flex-shrink:0}
.cal-h{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.cal-h .m{font-size:11px;font-weight:600;color:var(--text)}
.cal-h .nv{font-size:9px;color:var(--text2);cursor:pointer;padding:2px 4px;border-radius:3px;text-decoration:none}
.cal-h .nv:hover{color:var(--text);background:var(--bg-muted)}
.cal-h .cl{font-size:9px;color:var(--text2);cursor:pointer;margin-left:auto;padding:2px 6px;border-radius:3px;text-decoration:none}
.cal-h .cl:hover{color:#b4f027;background:rgba(180,240,39,.06)}
.cal-days{display:flex;gap:1px;overflow-x:auto;scrollbar-width:none}
.cal-days::-webkit-scrollbar{display:none}
.cal-day{width:26px;padding:3px 0;display:flex;flex-direction:column;align-items:center;border-radius:4px;cursor:pointer;text-decoration:none;color:var(--text2);transition:all .15s}
.cal-day:hover{background:var(--bg-muted)}
.cal-day .wd{font-size:6px;text-transform:uppercase;line-height:1;color:var(--text3)}
.cal-day .d{font-size:10px;font-weight:500;line-height:1;margin-top:1px}
.cal-day.today .d{color:#b4f027;font-weight:700}
.cal-day.sel{background:#b4f027;color:#000}
.cal-day.sel .wd{color:rgba(0,0,0,.5)}
.cal-day.sel .d{color:#000}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--bg-muted);flex-shrink:0}
.topbar-l{display:flex;align-items:center;gap:8px}
.topbar-l .dot{width:7px;height:7px;border-radius:50%;background:#b4f027;box-shadow:0 0 8px rgba(180,240,39,.4)}
.topbar-l h1{font-size:12px;font-weight:600}
.topbar-r{display:flex;align-items:center;gap:12px}
.topbar-r .stat{display:flex;align-items:baseline;gap:4px}
.topbar-r .stat .num{font-size:16px;font-weight:300}
.topbar-r .stat .lbl{font-size:10px;color:var(--text2)}
.topbar-r .sep{color:var(--text3);font-size:9px}
.topbar-r .date{font-size:10px;color:var(--text2)}
.tab-bar{display:flex;gap:3px;padding:10px 16px;border-bottom:1px solid var(--bg-muted);flex-shrink:0}
.r-tab-content{display:none;flex-direction:column;overflow:hidden;min-height:0}
.r-tab-content.act{display:flex}
.r-scroll{overflow-y:auto;flex:1;min-height:0;scrollbar-width:none}
.r-scroll::-webkit-scrollbar{display:none}
.dtabs{display:flex;gap:4px;padding:8px 16px;border-bottom:1px solid var(--bg-muted);overflow-x:auto;scrollbar-width:none;flex-shrink:0}
.dtabs::-webkit-scrollbar{display:none}
.dtab{padding:4px 10px;border-radius:6px;border:1px solid var(--bg-muted);cursor:pointer;font-size:9px;white-space:nowrap;background:transparent;color:var(--text2);display:flex;align-items:center;gap:4px;transition:all .15s;flex-shrink:0}
.dtab:hover{border-color:rgba(255,255,255,.1);color:var(--text)}
.dtab.act{border-color:#E8553E;background:var(--accent-light);color:#E8553E}
.dtab .cnt{font-size:7px;padding:1px 4px;border-radius:4px;background:var(--accent-light);color:#E8553E;font-weight:700;line-height:1}
.r-scroll .sec{padding:6px 16px}
.r-scroll .sec:first-child{padding-top:10px}
.r-scroll .sec:last-child{padding-bottom:10px}
.em-header{display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--bg-muted)}
.em-header .big{font-size:20px;font-weight:300}
.em-header .lbl{font-size:10px;color:var(--text2)}
.em-header .blk{font-size:9px;padding:2px 8px;border-radius:12px;background:rgba(245,158,11,.1);color:#f59e0b;display:flex;align-items:center;gap:3px}
.em-header .rf{width:24px;height:24px;border-radius:6px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:var(--bg-muted);color:var(--text2);font-size:12px;margin-left:auto}
.em-header .rf:hover{background:rgba(255,255,255,.08);color:var(--text)}
.em-pills{display:flex;align-items:center;gap:4px;margin-top:8px;flex-wrap:wrap}
.em-pills .pl{font-size:9px;padding:3px 8px;border-radius:12px;border:none;cursor:pointer;font-weight:500;transition:all .15s}
.em-pills .pl.act{background:var(--accent-light);color:#E8553E}
.em-pills .pl.ina{background:transparent;color:var(--text2)}
.em-pills .pl.ina:hover{background:var(--bg-muted);color:var(--text)}
.em-pills .sc{font-size:9px;color:var(--text2);display:flex;align-items:center;gap:4px;margin-left:auto;padding:3px 6px;border-radius:4px;cursor:pointer}
.em-pills .sc:hover{background:var(--bg-muted)}
.em-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;border:1px solid var(--bg-muted);margin-bottom:4px;transition:all .15s}
.em-item:hover{border-color:var(--text3)}
.em-item.dis{opacity:.6;border-color:rgba(245,158,11,.2);background:rgba(245,158,11,.03);cursor:not-allowed}
.em-item .cb{width:14px;height:14px;border-radius:3px;border:1.5px solid var(--border);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:transparent;transition:all .15s}
.em-item .cb.sel{background:#E8553E;border-color:#E8553E}
.em-item .cb.dis{cursor:not-allowed;opacity:.3}
.em-item .inf{flex:1;min-width:0}
.em-item .inf .tt{font-size:10px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.em-item .inf .sub{font-size:9px;color:var(--text2);margin-top:1px}
.em-item .inf .sub .rn{color:#f59e0b;font-size:8px;display:flex;align-items:center;gap:2px;margin-top:2px}
.em-item .inf .rz{font-size:8px;color:var(--text3);margin-top:1px}
.em-item .inf .rz .lb{font-size:8px}
.em-item .tp{display:flex;gap:2px;flex-shrink:0}
.em-item .tp button{font-size:8px;padding:2px 6px;border-radius:4px;border:none;cursor:pointer;font-weight:700;transition:all .15s}
.em-item .tp .af{background:var(--accent-light);color:#E8553E}
.em-item .tp .ex{background:rgba(59,130,246,.1);color:#5b9cf6}
.em-item .tp .au{background:rgba(167,139,250,.15);color:#a78bfa}
.em-item .tp .ina{background:var(--bg-muted);color:var(--text3)}
.em-item .mo{font-size:11px;font-weight:600;text-align:right;min-width:56px;font-variant-numeric:tabular-nums}
.em-bar{position:sticky;bottom:0;padding:10px 16px;background:var(--surface);border-top:1px solid var(--bg-muted);display:flex;align-items:center;justify-content:space-between;gap:10px;z-index:2}
.em-bar .l{font-size:10px;color:var(--text2)}
.em-bar .l .b{font-weight:600;color:var(--text)}
.em-bar .r button{font-size:10px;padding:7px 14px;border-radius:8px;border:none;cursor:pointer;font-weight:600;display:flex;align-items:center;gap:4px;transition:all .15s}
.em-bar .r .emit{background:#E8553E;color:#fff}
.em-bar .r .emit:hover{filter:brightness(1.1)}
.em-bar .r .emit:disabled{opacity:.4;cursor:not-allowed}
.em-bar .r .emit .sp{width:12px;height:12px;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:sp .5s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.em-empty{text-align:center;padding:24px 16px}
.em-empty .ic{width:40px;height:40px;border-radius:10px;background:var(--bg-muted);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;color:var(--text2)}
.em-empty .ic svg{width:18px;height:18px}
.em-empty h4{font-size:12px;font-weight:500;margin-bottom:4px}
.em-empty p{font-size:10px;color:var(--text2);max-width:280px;margin:0 auto;line-height:1.4}
.em-empty .wrn{margin-top:8px;padding:8px 10px;border-radius:6px;background:rgba(245,158,11,.04);border:1px solid rgba(245,158,11,.08);font-size:9px;color:#f59e0b;text-align:left;line-height:1.4}
`}</style>

      <div style={{ fontFamily: "'DM Sans','Inter',sans-serif", color: "var(--text)", minHeight: "100vh", padding: "20px 20px 20px" }}>

        {/* MESA: calendario (toggle sin navegar) + columnas izquierda/derecha */}
        <MesaController
          initialMesa={mesaInicial}
          empresaId={empresaId}
          empresaGiro={usuario.empresas.giro}
          empresaRazon={usuario.empresas.razon_social}
          empresaTipo={usuario.empresas.tipo_contribuyente}
          clientes={clData.data ?? []}
          rcvContent={rcvContent}
          searchHistoryItems={searchHistoryItems}
          empresaNombre={usuario.empresas.razon_social}
          empresaLogoUrl={empresaLogoUrl}
          brandSlot={<div key="brand" style={{position:"absolute",left:0,top:0,height:38,width:180,display:"flex",alignItems:"center",justifyContent:"flex-start",minWidth:0,overflow:"visible",zIndex:2}}><EmpresaBrand nombre={usuario.empresas.razon_social} logoUrl={empresaLogoUrl} empresas={empresasSelectorItems} multiempresa={cuentaMultiempresa} size={38} maxWidth={180} /></div>}
          actionsSlot={<div key="actions" style={{position:"absolute",right:0,top:0,height:38,width:132,display:"flex",justifyContent:"flex-end",minWidth:0,zIndex:2}}><HeaderActionsRow /></div>}
          leftColumn={
          <div key="left" className="left-col" style={{display:"flex",flexDirection:"column",gap:10,overflow:"visible",minHeight:0,scrollbarWidth:"none",paddingLeft:8}}>

            {/* EMITIR PANEL */}
             <GlowWrap glow style={{borderRadius:16,overflow:"visible"}}><div style={{background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)"}}>
              <EmisionDirectaAction
                empresaTipo={usuario.empresas.tipo_contribuyente}
                empresaId={empresaId}
                emisionProveedor={boletasProveedor}
                facturasProveedor={facturasProveedor}
                empresaRut={usuario.empresas.rut}
                empresaRazonSocial={usuario.empresas.razon_social}
                empresaGiro={usuario.empresas.giro}
                empresaDireccion={usuario.empresas.direccion}
                empresaComuna={usuario.empresas.comuna}
                readOnlyReason={supportReadOnlyReason}
              />
            </div></GlowWrap>
             <GlowWrap glow style={{borderRadius:16,overflow:"visible"}}><div style={{background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)"}}>
              <MassDTEAction empresaId={empresaId} readOnlyReason={supportReadOnlyReason} />
            </div></GlowWrap>

            {/* REGISTROS — card única con toggle Ventas / Actividad (2/3 ↔ 1/3) */}
            <RegistrosToggleCard
              esRcvExento={esRcvExento}
              ventasDocs={mesaInicial.ventasDocs}
              ventasTotal={mesaInicial.ventasTotal}
              actividadCount={mesaInicial.actividadItems.length}
              actividadUltimo={mesaInicial.actividadItems[0]?.descripcion}
              periodo={mesaInicial.calendar.selectedDateLabel}
            />
            <div style={{display:"none"}}><RCVButton /></div>
            {equipoBusiness.ok && equipoBusiness.equipo && (
              <TeamBusinessPanel
                cuentaId={equipoBusiness.cuentaId}
                usuarioId={equipoBusiness.usuarioId}
                empresaActivaId={equipoBusiness.empresaActivaId}
                empresaActivaNombre={equipoBusiness.empresaActivaNombre}
                personas={equipoBusiness.personas}
              />
            )}

            {/* USO DEL MES — al final, debajo de todas las cards */}
            {resumenCupos.ok && <UsageCountersPanel resumen={resumenCupos.resumen} />}
          </div>
          }
        />
      </div>
    </>
  );

  return (
    <V5Root
      dashboardContent={dashboardContent}
      empresaInicial={{ rut: usuario.empresas.rut, razon_social: usuario.empresas.razon_social, giro: usuario.empresas.giro, direccion: usuario.empresas.direccion, comuna: usuario.empresas.comuna, email_sii: usuario.empresas.email_sii, tipo_contribuyente: usuario.empresas.tipo_contribuyente ?? "auto" }}
      empresaCafs={(cafsData.data ?? []) as CAFRow[]}
      empresaId={empresaId}
      empresaEmisionConfig={{ boletasProveedor, facturasProveedor, baseapiSandbox: false }}
      devMode={usuario.dev_mode === true}
    />
  );
}
