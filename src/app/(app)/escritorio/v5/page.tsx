import Link from "next/link";
import { notFound } from "next/navigation";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportMode } from "@/lib/dev/support-mode";
import V5Root from "./V5Root";
import GlowWrap from "./GlowWrap";
import TabsV5 from "./TabsV5";
import RevisarTabContent from "./RevisarTabContent";
import EmitirTabContent from "./EmitirTabContent";
import { getPendientesEmision } from "@/lib/intermediario/pendientes-emision";
import SubidosFullView from "./sections/SubidosFullView";
import RevisarFullView from "./sections/RevisarFullView";
import EmitirFullView from "./sections/EmitirFullView";
import BoletasFullView from "./sections/BoletasFullView";
import DescargarBoletaButton from "@/components/boletas/DescargarBoletaButton";
import PreviewBoletaButton from "@/components/boletas/PreviewBoletaButton";
import RightColumnView from "./RightColumnView";
import type { ActividadItem } from "./ActividadView";
import type { SearchItem } from "@/lib/tree-structure";
import { EmisionDirectaAction, MassDTEAction, HeaderActionsRow, ActivityButton, RCVButton } from "./LeftQuickActions";
import DocCardList from "./DocCardList";
import RcvViewWrapper from "./RcvViewWrapper";
import RCVSummaryCard from "./RCVSummaryCard";
import EmpresaBrand from "./EmpresaBrand";
import TeamBusinessPanel from "./TeamBusinessPanel";
import UsageCountersPanel from "./UsageCountersPanel";
import { listarEmpresasSelector, listarEquipoBusiness, listarResumenCupos } from "./actions";
import { chileDateString, chileDayStartUtc, chileDayOfMonth } from "@/lib/chile-date";
import { formatDisplayDateEsCl, formatShortDateEsCl } from "@/lib/display-date";
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

type DocRow = {
  id: string;
  nombre_archivo: string;
  tipo: string;
  estado: string;
  movimientos_detectados: number | null;
  created_at: string;
  progreso_ia: unknown;
  tipo_operacion_hint: string | null;
  glosa_comun: string | null;
  glosa_activa: boolean | null;
};

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

function todayStr() {
  return chileDateString();
}

function addDaysStr(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(year, month - 1, day + days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function weekRangeStr(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const fmt = (value: Date) => `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,"0")}-${String(value.getDate()).padStart(2,"0")}`;
  return { start: fmt(start), end: fmt(end) };
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
  const selDate = dateParam && dateParam !== "all" ? dateParam : todayStr();
  const nextSelDate = addDaysStr(selDate, 1);
  const weekRange = weekRangeStr(selDate);
  const workMode = view === "month" || dateParam === "all" ? "month" : view === "week" ? "week" : "day";

  const supabase = supportMode ? supportMode.sb : await createClient();

  const now = new Date();
  // Año/mes/día actuales EN CHILE (no UTC del server, que en Vercel corre el
  // calendario y los rangos): base de todos los filtros y del calendario.
  const nowChile = chileDateString(now);
  const curYear = Number(nowChile.slice(0, 4));
  const curMonth = Number(nowChile.slice(5, 7)) - 1; // 0-indexed
  const curDay = Number(nowChile.slice(8, 10));

  let y = curYear, m = curMonth;
  if (monthParam) {
    // month es 0-indexado ("2026-0" = enero). OJO: pm=0 es falsy — no usar
    // `py && pm`, o enero queda inalcanzable.
    const [py, pm] = monthParam.split("-").map(Number);
    if (py && Number.isInteger(pm) && pm >= 0 && pm <= 11) { y = py; m = pm; }
  }
  if (workMode === "day") {
    const [sy, smonth] = selDate.split("-").map(Number);
    if (sy && smonth) { y = sy; m = smonth - 1; }
  }
  // Primer día del mes (y,m) y del siguiente, como "YYYY-MM-DD" de Chile.
  const firstOfMonth = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const firstOfNextMonth = m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, "0")}-01`;
  // Rangos para filtrar created_at (timestamptz): inicio del día/mes EN CHILE
  // expresado como instante UTC, así no se corren 3-4 h respecto a la hora local.
  const sm = chileDayStartUtc(firstOfMonth);
  const em = chileDayStartUtc(firstOfNextMonth);
  const isMonthMode = workMode === "month";
  const isWeekMode = workMode === "week";
  const workStart = isMonthMode ? sm : chileDayStartUtc(isWeekMode ? weekRange.start : selDate);
  const workEnd = isMonthMode ? em : chileDayStartUtc(isWeekMode ? weekRange.end : nextSelDate);
  // RCV: mes actual de Chile.
  const firstThisMonth = `${curYear}-${String(curMonth + 1).padStart(2, "0")}-01`;
  const firstNextMonth = curMonth === 11 ? `${curYear + 1}-01-01` : `${curYear}-${String(curMonth + 2).padStart(2, "0")}-01`;
  const rcvSummaryStart = chileDayStartUtc(firstThisMonth);
  const rcvSummaryEnd = chileDayStartUtc(firstNextMonth);

  const [rcvData, propsData, clData, calProps, calDocs, docsData, pendCountData, aprobCountData, cafsData, pendientesData] = await Promise.all([
    supabase.from("boletas_emitidas").select("monto_neto,monto_exento,iva,monto_total").eq("empresa_id", empresaId).neq("estado","anulada").gte("fecha_emision",rcvSummaryStart).lt("fecha_emision",rcvSummaryEnd),
    supabase.from("propuestas_ia").select("*,movimientos_raw(*,documentos_subidos(id,nombre_archivo,created_at))").eq("empresa_id", empresaId).gte("created_at",workStart).lt("created_at",workEnd).order("created_at",{ascending:false}),
    supabase.from("clientes").select("id,nombre,rut").eq("empresa_id", empresaId).order("nombre",{ascending:true}),
    supabase.from("propuestas_ia").select("created_at,estado").eq("empresa_id", empresaId).gte("created_at",sm).lt("created_at",em),
    supabase.from("documentos_subidos").select("created_at").eq("empresa_id", empresaId).gte("created_at",sm).lt("created_at",em),
    supabase.from("documentos_subidos").select("id,nombre_archivo,tipo,estado,movimientos_detectados,created_at,progreso_ia,tipo_operacion_hint,glosa_comun,glosa_activa")
      .eq("empresa_id", empresaId).gte("created_at",workStart).lt("created_at",workEnd).order("created_at",{ascending:false}).limit(50),
    supabase.from("propuestas_ia").select("id",{count:"exact",head:true}).eq("empresa_id", empresaId).eq("estado","pendiente").gte("created_at",workStart).lt("created_at",workEnd),
    supabase.from("propuestas_ia").select("id",{count:"exact",head:true}).eq("empresa_id", empresaId).in("estado",["aprobado","editado"]).gte("created_at",workStart).lt("created_at",workEnd),
    supabase.from("boletas_caf_mock")
      .select("id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado, fecha_vence")
      .eq("empresa_id", empresaId).order("fecha_solicitud", { ascending: false }),
    getPendientesEmision(supabase, empresaId, {
      giro: usuario.empresas.giro,
      razon_social: usuario.empresas.razon_social,
      tipo_contribuyente: usuario.empresas.tipo_contribuyente,
    }).catch(() => ({
      items: [] as Awaited<ReturnType<typeof getPendientesEmision>>["items"],
      totales: { total_pendientes: 0, listas_emitir: 0, bloqueadas: 0, monto_total: 0, monto_listo: 0 },
      aprobadas_otros_tipos: {} as Record<string, number>,
    })),
  ]);

  const rcvTotal = (rcvData.data ?? []).reduce((s,b) => ({
    docs: s.docs+1, neto: s.neto+(b.monto_neto??0), exento: s.exento+(b.monto_exento??0),
    iva: s.iva+(b.iva??0), total: s.total+(b.monto_total??0),
  }), { docs: 0, neto: 0, exento: 0, iva: 0, total: 0 });

  const esRcvExento = usuario.empresas.tipo_contribuyente === "exento";
  const empresaLogoUrl = `/api/empresa/logo/${empresaId}`;
  const empresasSelector = await listarEmpresasSelector();
  const empresasSelectorItems = empresasSelector.ok ? empresasSelector.empresas : [];
  const cuentaMultiempresa = empresasSelector.ok ? empresasSelector.multiempresa : false;
  const equipoBusiness = await listarEquipoBusiness();
  const resumenCupos = await listarResumenCupos();

  const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;
  const mes = String(curMonth + 1).padStart(2, "0") + "-" + curYear;

  // Calendar
  const daysInMonth = new Date(y,m+1,0).getDate();
  const byDay = new Map<number,{p:number;a:number;d:number}>();
  for (let d=1; d<=daysInMonth; d++) byDay.set(d,{p:0,a:0,d:0});
  for (const p of calProps.data ?? []) { const inf=byDay.get(chileDayOfMonth(new Date(p.created_at))); if(!inf) continue; if(p.estado==="pendiente") inf.p++; else if(["aprobado","editado"].includes(p.estado)) inf.a++; }
  for (const d of calDocs.data ?? []) { const inf=byDay.get(chileDayOfMonth(new Date(d.created_at))); if(inf) inf.d++; }
  const today = curDay;
  const isThisMonth = curYear === y && curMonth === m;
  const selDay = selDate ? (()=>{const [sy,sm,sd]=selDate.split("-").map(Number); return sy===y&&sm===m+1?sd:null;})() : null;
  const wd = ["D","L","M","M","J","V","S"];

  const monthNames = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  // Navegación ‹/› con rollover de año (dic → ene del siguiente, ene → dic del anterior).
  const prevMonthParam = m === 0 ? `${y - 1}-11` : `${y}-${m - 1}`;
  const nextMonthParam = m === 11 ? `${y + 1}-0` : `${y}-${m + 1}`;
  const selectedDateLabel = (() => {
    if (isMonthMode) return monthNames[m].toLowerCase() + " " + y;
    if (isWeekMode) return `semana ${weekRange.start.slice(8, 10)}-${addDaysStr(weekRange.end, -1).slice(8, 10)} ${monthNames[m].toLowerCase()}`;
    return formatDisplayDateEsCl(selDate, { weekday: "long", day: "numeric", month: "long" }, selDate);
  })();

  const workStartDay = workStart.slice(0, 10);
  const workEndDay = workEnd.slice(0, 10);
  const inWorkRange = (fecha?: string | null) => {
    const day = fecha?.slice(0, 10);
    return !!day && day >= workStartDay && day < workEndDay;
  };

  // Boletas latest 20. Proveedores reales pueden devolver fechas distintas;
  // por eso la vista considera fecha tributaria y fecha de creación.
  const { data: boletasRaw } = await supabase.from("boletas_emitidas")
    .select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,estado,detalles")
    .eq("empresa_id", empresaId).order("created_at",{ascending:false}).order("folio",{ascending:false}).limit(100);
  const boletas = (boletasRaw ?? []).filter((boleta) => inWorkRange(boleta.fecha_emision) || inWorkRange(boleta.created_at)).slice(0, 20);

  const docsBase = (docsData.data ?? []) as DocRow[];
  const boletasComoAgregados = (boletas ?? [])
    .filter((boleta) => !docsBase.some((doc) => (doc.progreso_ia as { boleta_id?: string } | null)?.boleta_id === boleta.id))
    .map((boleta) => {
      const fechaRegistro = boleta.created_at ?? `${boleta.fecha_emision}T12:00:00.000Z`;
      return {
        id: `boleta-unica-${boleta.id}`,
        nombre_archivo: `Boleta unica #${boleta.folio} - ${boleta.receptor_razon_social ?? "consumidor final"}`,
        tipo: "boleta_unica",
        estado: "procesado",
        movimientos_detectados: 1,
        created_at: fechaRegistro,
        progreso_ia: {
          origen: "emision_directa",
          boleta_id: boleta.id,
          folio: boleta.folio,
          tipo_dte: boleta.tipo_dte,
          monto_total: boleta.monto_total,
          receptor: boleta.receptor_razon_social ?? "consumidor final",
          sintetico_desde_boleta: true,
        },
      };
    });
  const docsAgregados = [...boletasComoAgregados, ...docsBase].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Boletas únicas (emisión directa): mismo criterio que Agregados, para que
  // el tab Boletas las marque igual y muestre su glosa — sin receptor, el
  // detalle es la única referencia para reconocerlas.
  const boletaUnicaIds = new Set(
    docsAgregados
      .filter((d) => ["boleta_unica", "boleta_sii_local", "dte_simpleapi"].includes(d.tipo))
      .map((d) => (d.progreso_ia as { boleta_id?: string } | null)?.boleta_id)
      .filter((v): v is string => Boolean(v)),
  );
  const glosaDe = (detalles: unknown) =>
    Array.isArray(detalles) && detalles[0] && typeof detalles[0] === "object"
      ? String((detalles[0] as { nombre?: unknown }).nombre ?? "")
      : "";
  const boletasView = boletas.map((b) => ({
    ...b,
    es_unica: boletaUnicaIds.has(b.id),
    detalle: glosaDe((b as { detalles?: unknown }).detalles),
  }));

  // Composición por documento (afectas/exentas/gastos): se muestra en la
  // card para decidir de un vistazo qué trae la cartola, y si la empresa
  // fijó afecto/exento se recalca el desacuerdo o la cartola mixta.
  // Solo aviso — la app procesa igual.
  const docTipoMix: Record<string, { afectas: number; exentas: number; gastos: number }> = {};
  for (const p of propsData.data ?? []) {
    if (p.estado !== "pendiente" && p.estado !== "aprobado" && p.estado !== "editado") continue;
    const docId = p.movimientos_raw?.documentos_subidos?.id;
    if (!docId) continue;
    const t = p.tipo_propuesto;
    const mix = (docTipoMix[docId] ??= { afectas: 0, exentas: 0, gastos: 0 });
    if (t === "gasto_egreso" || t === "no_comercial") mix.gastos++;
    else if (t === "boleta" || t === "factura") mix.afectas++;
    else mix.exentas++;
  }

  // Avance de cada documento por el pipeline (Subidos), reconciliando al total
  // de propuestas. "emitida" = la propuesta tiene boleta vigente (folio real en
  // el SII). Sirve además para CONGELAR el documento: con ≥1 emitida no se puede
  // re-mapear ni deshacer — corregir una boleta emitida es vía Nota de Crédito.
  // El conteo se agrega en una sola función Postgres (indexada) en vez de traer
  // todos los ids al server con un IN — escala a documentos con miles de
  // movimientos. RLS aplica (security invoker): solo ve la empresa del usuario.
  const { data: progRows } = await supabase.rpc("documento_pipeline_counts", {
    p_empresa: empresaId, p_desde: workStart, p_hasta: workEnd,
  });
  const docProgress: Record<string, { total: number; emitida: number; lista: number; porRevisar: number; noAplica: number }> = {};
  for (const r of progRows ?? []) {
    docProgress[r.documento_id] = { total: r.total, emitida: r.emitida, lista: r.lista, porRevisar: r.por_revisar, noAplica: r.no_aplica };
  }

  // Boletas para el visor RCV: SSR carga solo el mes inicial; los demás meses
  // se piden bajo demanda desde /api/boletas/rcv para no hidratar miles de filas.
  const { data: boletasRcvData } = await supabase.from("boletas_emitidas")
    .select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,estado")
    .eq("empresa_id", empresaId)
    .gte("fecha_emision", firstThisMonth)
    .lt("fecha_emision", firstNextMonth)
    .order("fecha_emision",{ascending:false})
    .order("folio",{ascending:false})
    .limit(1000);

  const [searchDocsData, searchBoletasData, searchPropsData] = await Promise.all([
    supabase.from("documentos_subidos").select("id,nombre_archivo,tipo,estado,movimientos_detectados,created_at,progreso_ia,tipo_operacion_hint,glosa_comun,glosa_activa")
      .eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(100),
    supabase.from("boletas_emitidas").select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,estado")
      .eq("empresa_id", empresaId).order("fecha_emision",{ascending:false}).order("folio",{ascending:false}).limit(100),
    supabase.from("propuestas_ia").select("*,movimientos_raw(*,documentos_subidos(id,nombre_archivo,created_at))")
      .eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(100),
  ]);

  // Activity feed
  const actividadItems: ActividadItem[] = [];
  for (const doc of (docsData.data ?? []).slice(0, 10)) {
    actividadItems.push({
      id: "doc-" + doc.id, tipo: "subida",
      descripcion: doc.nombre_archivo,
      detalle: (doc.movimientos_detectados ?? 0) + " movimientos · " + doc.estado,
      fecha: doc.created_at,
    });
  }
  for (const bol of (boletas ?? []).slice(0, 10)) {
    const fechaRegistro = bol.created_at ?? bol.fecha_emision;
    actividadItems.push({
      id: "bol-" + bol.id, tipo: "emision",
      descripcion: "Boleta #" + bol.folio + " · " + (bol.tipo_dte === 39 ? "AFECTA" : "EXENTA"),
      detalle: bol.receptor_razon_social ?? "Sin receptor",
      fecha: fechaRegistro,
      monto: bol.monto_total,
    });
  }
  actividadItems.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

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
    <RcvViewWrapper boletas={(boletasRcvData ?? []) as BoletaRow[]} initialYear={curYear} initialMonth={curMonth} />
  );

  const compactEmpty = (kind: "subidos" | "boletas") => {
    const isSubidos = kind === "subidos";
    return (
      <div className="r-scroll" style={{display:"grid",placeItems:"center",minHeight:320,padding:"42px 18px",textAlign:"center",color:"var(--text2)"}}>
        <style>{`@keyframes emptySonar{0%{transform:scale(.72);opacity:.45}70%,100%{transform:scale(1.22);opacity:0}}@keyframes emptyDraw{0%{stroke-dashoffset:54;opacity:.28}50%{opacity:1}100%{stroke-dashoffset:0;opacity:.48}}`}</style>
        <div>
          <div style={{position:"relative",width:104,height:104,margin:"0 auto 16px"}}>
            <div style={{position:"absolute",inset:8,borderRadius:"50%",border:isSubidos?"1px solid rgba(232,85,62,.26)":"1px solid rgba(59,130,246,.25)",animation:"emptySonar 2.8s ease-out infinite"}} />
            {isSubidos ? (
              <svg viewBox="0 0 96 96" fill="none" style={{position:"absolute",inset:0,color:"#E8553E"}}><path d="M30 72h36a8 8 0 0 0 8-8V34L56 16H30a8 8 0 0 0-8 8v40a8 8 0 0 0 8 8Z" stroke="currentColor" strokeWidth="4"/><path d="M55 16v17h18" stroke="currentColor" strokeWidth="4"/><path d="M35 49h26M35 59h18" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="54" style={{animation:"emptyDraw 2.8s ease-in-out infinite"}}/></svg>
            ) : (
              <svg viewBox="0 0 96 96" fill="none" style={{position:"absolute",inset:0,color:"#3B82F6"}}><path d="M29 15h30l12 12v54H29a6 6 0 0 1-6-6V21a6 6 0 0 1 6-6Z" stroke="currentColor" strokeWidth="4"/><path d="M59 16v13h13" stroke="currentColor" strokeWidth="4"/><path d="M35 45h26M35 56h20M35 67h27" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="54" style={{animation:"emptyDraw 2.8s ease-in-out infinite"}}/></svg>
            )}
          </div>
          <div style={{fontSize:15,fontWeight:800,color:"var(--text)",letterSpacing:"-.025em"}}>{isSubidos ? "Nada por aquí" : "Aún no hay boletas"}</div>
          <div style={{marginTop:5,fontSize:11,lineHeight:1.45,maxWidth:270}}>{isSubidos ? "Esta mesa no tiene documentos agregados todavía." : "Las boletas emitidas en esta mesa aparecerán aquí."}</div>
        </div>
      </div>
    );
  };

  const dashboardContent = (
    <>
      <style>{`
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif}
:root{--accent:#E8553E;--accent-light:rgba(232,85,62,.1);--muted-light:#888}
.ep-glow-card{transition:box-shadow 600ms cubic-bezier(0.22,1,0.36,1)}
.ep-glow-card:hover{box-shadow:0 0 40px -8px rgba(232,85,62,0.40)!important}
.app{display:grid;grid-template-columns:2.55fr 7.45fr;max-width:1400px;margin:0 auto;gap:20px;height:calc(100vh - 94px);padding:0 0;position:relative;background:transparent;min-height:0;overflow:visible}
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

        {/* CALENDAR + ACTIONS ROW */}
        <div style={{position:"relative",height:38,marginBottom:12}}>
          <div style={{position:"absolute",left:0,top:0,height:38,width:180,display:"flex",alignItems:"center",justifyContent:"flex-start",minWidth:0,overflow:"visible",zIndex:2}}>
            <EmpresaBrand nombre={usuario.empresas.razon_social} logoUrl={empresaLogoUrl} empresas={empresasSelectorItems} multiempresa={cuentaMultiempresa} size={38} maxWidth={180} />
          </div>
          <div className="v5-calendar-wrap" style={{position:"absolute",left:"50%",top:0,transform:"translateX(-50%)",height:38,display:"flex",justifyContent:"center",minWidth:0,overflow:"hidden",zIndex:1}}>
          <div style={{background:"var(--surface)",borderRadius:12,border:"1px solid var(--border)",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)",minWidth:0,height:38,display:"flex",alignItems:"center",width:"fit-content"}}>
            <div style={{padding:"0 6px",display:"flex",alignItems:"center",gap:2}}>
            <Link href={`/massdte?month=${prevMonthParam}&date=${selDate}&view=${workMode}`} style={{fontSize:11,fontWeight:700,color:"var(--text)",cursor:"pointer",padding:"1px 5px",borderRadius:4,textDecoration:"none",lineHeight:1,background:"var(--bg-muted)",display:"flex",alignItems:"center",justifyContent:"center",height:20,flexShrink:0}} scroll={false}>‹</Link>
            <span style={{fontSize:10,fontWeight:600,color:"var(--text)",whiteSpace:"nowrap",flexShrink:0,width:100,textAlign:"center"}}>{monthNames[m]} {y}</span>
            <Link href={`/massdte?month=${nextMonthParam}&date=${selDate}&view=${workMode}`} style={{fontSize:11,fontWeight:700,color:"var(--text)",cursor:"pointer",padding:"1px 5px",borderRadius:4,textDecoration:"none",lineHeight:1,background:"var(--bg-muted)",display:"flex",alignItems:"center",justifyContent:"center",height:20,flexShrink:0}} scroll={false}>›</Link>
            <Link href={`/massdte?date=${selDate}&month=${y}-${m}&view=${workMode === "day" ? "week" : workMode === "week" ? "month" : "day"}`} style={{fontSize:9,fontWeight:700,color:"#b4f027",cursor:"pointer",padding:"2px 4px",margin:"0 4px",borderRadius:4,textDecoration:"none",border:workMode !== "day" ? "1px dashed #b4f027" : "1px solid transparent",background:"transparent",display:"flex",alignItems:"center",gap:4,whiteSpace:"nowrap",flexShrink:0,height:28,width:98,justifyContent:"center",lineHeight:1.05}} scroll={false}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0}}><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <span style={{display:"flex",flexDirection:"column",alignItems:"flex-start",justifyContent:"center",lineHeight:1.05,textAlign:"left",fontSize:9,fontWeight:700}}>
                <span>Mesa de trabajo</span>
                <span>{isMonthMode ? "del mes" : isWeekMode ? "de la semana" : "del día"}</span>
              </span>
            </Link>
            <div style={{display:"flex",gap:1,overflow:"hidden",width:650,flexShrink:0,paddingRight:6}}>
            {Array.from({length:daysInMonth},(_,i) => i+1).map(day => {
              const ds = `${y}-${String(m+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const isSel = day === selDay;
              const isToday = day === today && isThisMonth;
              const isInWeek = ds >= weekRange.start && ds < weekRange.end;
              const isActiveDay = workMode === "day" && isSel;
              const isActiveWeekDay = workMode === "week" && isInWeek;
              const isActiveMonthDay = workMode === "month";
              return (
                <Link key={day} href={`/massdte?date=${ds}&month=${y}-${m}&view=${workMode}`}
                  style={{
                    width:20,padding:"1px 0",display:"flex",flexDirection:"column",alignItems:"center",borderRadius:3,textDecoration:"none",flexShrink:0,
                    background: isActiveMonthDay || isActiveWeekDay || isActiveDay ? "#b4f027" : "transparent",
                  }}
                  scroll={false}>
                  <span style={{fontSize:5,textTransform:"uppercase",lineHeight:1,color: isActiveMonthDay || isActiveWeekDay || isActiveDay ? "rgba(0,0,0,.5)" : "var(--text3)"}}>{wd[new Date(y,m,day).getDay()]}</span>
                  <span style={{fontSize:8,fontWeight: isToday || isSel ? 700 : 500,lineHeight:1,marginTop:1,color: isToday ? "#E8553E" : (isActiveMonthDay || isActiveWeekDay || isActiveDay ? "#000" : "var(--text2)")}}>{day}</span>
                </Link>
              );
            })}
            </div>
            </div>
          </div>
          </div>
          <div style={{position:"absolute",right:0,top:0,height:38,width:132,display:"flex",justifyContent:"flex-end",minWidth:0,zIndex:2}}><HeaderActionsRow /></div>
        </div>

        {/* MAIN GRID */}
        <div className="app">

          {/* ═══ LEFT COLUMN ═══ */}
          <div className="left-col" style={{display:"flex",flexDirection:"column",gap:10,overflow:"visible",minHeight:0,scrollbarWidth:"none",paddingLeft:8}}>

            {/* RCV CARD */}
            <RCVSummaryCard mes={mes} esRcvExento={esRcvExento} docs={rcvTotal.docs} neto={fmt(rcvTotal.neto)} iva={fmt(rcvTotal.iva)} total={fmt(rcvTotal.total)} />

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

            {/* ACTION BUTTONS */}
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <ActivityButton />
            <div style={{display:"none"}}><RCVButton /></div>
            </div>
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

          {/* ═══ RIGHT COLUMN ═══ */}
          <RightColumnView
            actividadItems={actividadItems}
            rcvContent={rcvContent}
            searchHistoryItems={searchHistoryItems}
            empresaNombre={usuario.empresas.razon_social}
            empresaLogoUrl={empresaLogoUrl}
            defaultContent={
              <>

            {/* TABS */}
            <TabsV5
              pendCount={pendCountData.count ?? 0}
              aprobCount={aprobCountData.count ?? 0}
              nombreEmpresa={usuario.empresas.razon_social}
              fecha={selectedDateLabel}
              subidosContent={
                docsAgregados.length > 0 ? (
                  <div className="r-scroll">
                    <div className="sec" style={{paddingTop:6}}>
                      <DocCardList docs={docsAgregados} empresaId={empresaId} tipoEmpresa={usuario.empresas.tipo_contribuyente} tipoMix={docTipoMix} docProgress={docProgress} />
                    </div>
                  </div>
                ) : (
                  compactEmpty("subidos")
                )
              }
              revisarContent={
                <RevisarTabContent
                  propuestas={propsData.data ?? []}
                  clientes={clData.data ?? []}
                  empresaId={empresaId}
                  empresaGiro={usuario.empresas.giro}
                  empresaRazonSocial={usuario.empresas.razon_social}
                  empresaTipoContribuyente={usuario.empresas.tipo_contribuyente}
                />
              }
              emitirContent={<EmitirTabContent initial={{ ok: true, items: pendientesData.items, totales: pendientesData.totales, aprobadas_otros_tipos: pendientesData.aprobadas_otros_tipos }} />}
              boletasContent={
                (boletas ?? []).length === 0 ? (
                  compactEmpty("boletas")
                ) : (
                <div className="r-scroll">
                  <div className="sec">
                    <div className="bl-header" style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 0 8px"}}>
                      <span style={{fontSize:10,color:"var(--text)",fontWeight:600}}>Últimas emitidas</span>
                      <Link href="/boletas/reportes" style={{fontSize:9,color:"var(--text2)",textDecoration:"none",display:"flex",alignItems:"center",gap:4,fontWeight:600}}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                        Ver reporte RCV
                      </Link>
                    </div>
                      {boletasView.map(b => {
                        const esAnulada = b.estado === "anulada";
                        return (
                          <div key={b.id} className={`bl-item ${esAnulada ? "an" : ""}`}
                            style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid rgba(255,255,255,.03)",opacity:esAnulada?0.5:1}}>
                            <div className="ic" style={{width:28,height:28,borderRadius:6,background:b.es_unica?"rgba(232,85,62,.07)":"var(--bg-muted)",border:b.es_unica?"1px dashed rgba(232,85,62,.5)":"none",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,color:b.es_unica?"#E8553E":"var(--text2)"}}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            </div>
                            <div className="inf" style={{flex:1,minWidth:0}}>
                              <div className="top" style={{display:"flex",alignItems:"center",gap:4,fontSize:10,fontWeight:600,color:"var(--text)"}}>
                                <span className="fl" style={{color:"var(--text)"}}>#{b.folio}</span>
                                <span className={`bd ${b.tipo_dte === 39 ? "af" : b.tipo_dte === 41 ? "ex" : "an"}`}
                                  style={{fontSize:7,padding:"1px 5px",borderRadius:8,fontWeight:600,
                                    background: b.tipo_dte === 39 ? "var(--accent-light)" : b.tipo_dte === 41 ? "rgba(59,130,246,.1)" : "var(--bg-muted)",
                                    color: b.tipo_dte === 39 ? "#E8553E" : b.tipo_dte === 41 ? "#5b9cf6" : "var(--text2)"}}
                                >{b.tipo_dte === 39 ? "AFECTA" : b.tipo_dte === 41 ? "EXENTA" : `DTE ${b.tipo_dte}`}</span>
                                {b.es_unica && (
                                  <span style={{fontSize:7,padding:"1px 5px",borderRadius:8,fontWeight:800,border:"1px dashed rgba(232,85,62,.55)",background:"rgba(232,85,62,.06)",color:"#E8553E"}}>ÚNICA</span>
                                )}
                                {esAnulada && (
                                  <span className="bd an" style={{fontSize:7,padding:"1px 5px",borderRadius:8,fontWeight:600,background:"var(--bg-muted)",color:"var(--text2)"}}>ANULADA</span>
                                )}
                              </div>
                              <div className="sub" style={{fontSize:9,color:"var(--text2)",marginTop:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {b.es_unica && b.detalle ? <><span style={{color:"var(--text)"}}>{b.detalle}</span> · </> : null}
                                {b.receptor_razon_social ?? "Sin receptor"} · {formatShortDateEsCl(b.fecha_emision, true)}
                              </div>
                            </div>
                            <span className="mo" style={{fontSize:11,fontWeight:600,textAlign:"right",fontVariantNumeric:"tabular-nums",flexShrink:0}}>
                              {fmt(b.monto_total)}
                            </span>
                            <PreviewBoletaButton id={b.id} />
                            <DescargarBoletaButton id={b.id} />
                          </div>
                        );
                      })}
                    </div>
                </div>
                )
              }
            />
              </>
            }
          />
        </div>
      </div>
    </>
  );

  return (
    <V5Root
      dashboardContent={dashboardContent}
      subidosContent={<SubidosFullView documentos={docsAgregados} />}
      revisarContent={<RevisarFullView propuestas={propsData.data ?? []} empresaId={empresaId} />}
      emitirContent={<EmitirFullView empresaId={empresaId} />}
      boletasContent={<BoletasFullView boletas={boletasView as (BoletaRow & { es_unica?: boolean; detalle?: string })[]} />}
      empresaInicial={{ rut: usuario.empresas.rut, razon_social: usuario.empresas.razon_social, giro: usuario.empresas.giro, direccion: usuario.empresas.direccion, comuna: usuario.empresas.comuna, email_sii: usuario.empresas.email_sii, tipo_contribuyente: usuario.empresas.tipo_contribuyente ?? "auto" }}
      empresaCafs={(cafsData.data ?? []) as CAFRow[]}
      empresaId={empresaId}
      empresaEmisionConfig={{ boletasProveedor, facturasProveedor, baseapiSandbox: false }}
      devMode={usuario.dev_mode === true}
    />
  );
}
