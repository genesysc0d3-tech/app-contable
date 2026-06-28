import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPendientesEmision } from "@/lib/intermediario/pendientes-emision";
import { chileDateString, chileDayStartUtc, chileDayOfMonth } from "@/lib/chile-date";
import { formatDisplayDateEsCl } from "@/lib/display-date";
import type { ActividadItem } from "./ActividadView";

// ── Helpers de fecha (compartidos con el render del escritorio) ──────────────
export function todayStr() {
  return chileDateString();
}
export function addDaysStr(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(year, month - 1, day + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function weekRangeStr(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  const start = new Date(d);
  start.setDate(d.getDate() - d.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const fmt = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

const MONTH_NAMES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export type DocRow = {
  id: string; nombre_archivo: string; tipo: string; estado: string;
  movimientos_detectados: number | null; created_at: string; progreso_ia: unknown;
  tipo_operacion_hint: string | null; glosa_comun: string | null; glosa_activa: boolean | null;
};

export type MesaParams = { date?: string; month?: string; view?: string };

export type EmpresaMesa = {
  giro: string | null;
  razon_social: string;
  tipo_contribuyente: string | null;
};

/**
 * Resuelve TODO lo que depende de la fecha/vista del calendario para la mesa
 * (panel derecho) + los puntos del calendario. NO toca lo date-independiente
 * (empresa, cupos, equipo, clientes, pendientes de emisión) — eso lo carga el
 * page una sola vez y se reusa al togglear, para no re-consultar de más.
 *
 * Se usa en el render inicial (SSR) y en el server action `cargarMesa`, así la
 * lógica es una sola y no diverge.
 */
export async function fetchMesaDateDependent(
  supabase: SupabaseClient,
  empresaId: string,
  empresa: EmpresaMesa,
  params: MesaParams,
) {
  const selDate = params.date && params.date !== "all" ? params.date : todayStr();
  const nextSelDate = addDaysStr(selDate, 1);
  const weekRange = weekRangeStr(selDate);
  const workMode: "day" | "week" | "month" =
    params.view === "month" || params.date === "all" ? "month" : params.view === "week" ? "week" : "day";

  const nowChile = chileDateString(new Date());
  const curYear = Number(nowChile.slice(0, 4));
  const curMonth = Number(nowChile.slice(5, 7)) - 1;
  const curDay = Number(nowChile.slice(8, 10));

  let y = curYear, m = curMonth;
  if (params.month) {
    const [py, pm] = params.month.split("-").map(Number);
    if (py && Number.isInteger(pm) && pm >= 0 && pm <= 11) { y = py; m = pm; }
  }
  if (workMode === "day") {
    const [sy, smonth] = selDate.split("-").map(Number);
    if (sy && smonth) { y = sy; m = smonth - 1; }
  }

  const firstOfMonth = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const firstOfNextMonth = m === 11 ? `${y + 1}-01-01` : `${y}-${String(m + 2).padStart(2, "0")}-01`;
  const sm = chileDayStartUtc(firstOfMonth);
  const em = chileDayStartUtc(firstOfNextMonth);
  const isMonthMode = workMode === "month";
  const isWeekMode = workMode === "week";

  const workStart = isMonthMode ? sm : chileDayStartUtc(isWeekMode ? weekRange.start : selDate);
  const workEnd = isMonthMode ? em : chileDayStartUtc(isWeekMode ? weekRange.end : nextSelDate);
  const workStartDay = workStart.slice(0, 10);
  const workEndDay = workEnd.slice(0, 10);
  const inWorkRange = (fecha?: string | null) => {
    const day = fecha?.slice(0, 10);
    return !!day && day >= workStartDay && day < workEndDay;
  };

  // ── Consultas date-dependientes (paralelas) ──
  const [propsData, calProps, calDocs, docsData, pendCountData, aprobCountData, boletasRawRes, progRowsRes, ventasRangoRes] = await Promise.all([
    supabase.from("propuestas_ia").select("*,movimientos_raw(*,documentos_subidos(id,nombre_archivo,created_at))").eq("empresa_id", empresaId).gte("created_at", workStart).lt("created_at", workEnd).order("created_at", { ascending: false }),
    supabase.from("propuestas_ia").select("created_at,estado").eq("empresa_id", empresaId).gte("created_at", sm).lt("created_at", em),
    supabase.from("documentos_subidos").select("created_at").eq("empresa_id", empresaId).gte("created_at", sm).lt("created_at", em),
    supabase.from("documentos_subidos").select("id,nombre_archivo,tipo,estado,movimientos_detectados,created_at,progreso_ia,tipo_operacion_hint,glosa_comun,glosa_activa").eq("empresa_id", empresaId).gte("created_at", workStart).lt("created_at", workEnd).order("created_at", { ascending: false }).limit(50),
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("estado", "pendiente").gte("created_at", workStart).lt("created_at", workEnd),
    supabase.from("propuestas_ia").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).in("estado", ["aprobado", "editado"]).gte("created_at", workStart).lt("created_at", workEnd),
    supabase.from("boletas_emitidas").select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,monto_neto,monto_exento,iva,estado,detalles").eq("empresa_id", empresaId).order("created_at", { ascending: false }).order("folio", { ascending: false }).limit(100),
    supabase.rpc("documento_pipeline_counts", { p_empresa: empresaId, p_desde: workStart, p_hasta: workEnd }),
    supabase.from("boletas_emitidas").select("monto_total").eq("empresa_id", empresaId).neq("estado", "anulada").gte("fecha_emision", workStartDay).lt("fecha_emision", workEndDay),
  ]);
  // Ventas del rango (registro de ventas atado al calendario maestro).
  const ventasRows = (ventasRangoRes.data ?? []) as { monto_total: number | null }[];
  const ventasDocs = ventasRows.length;
  const ventasTotal = ventasRows.reduce((s, b) => s + (b.monto_total ?? 0), 0);

  // ── Puntos del calendario (por día del mes) ──
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const byDay: Record<number, { p: number; a: number; d: number }> = {};
  for (let d = 1; d <= daysInMonth; d++) byDay[d] = { p: 0, a: 0, d: 0 };
  for (const p of calProps.data ?? []) { const inf = byDay[chileDayOfMonth(new Date(p.created_at))]; if (!inf) continue; if (p.estado === "pendiente") inf.p++; else if (["aprobado", "editado"].includes(p.estado)) inf.a++; }
  for (const d of calDocs.data ?? []) { const inf = byDay[chileDayOfMonth(new Date(d.created_at))]; if (inf) inf.d++; }

  const today = curDay;
  const isThisMonth = curYear === y && curMonth === m;
  const selDay = (() => { const [sy, smo, sd] = selDate.split("-").map(Number); return sy === y && smo === m + 1 ? sd : null; })();
  const prevMonthParam = m === 0 ? `${y - 1}-11` : `${y}-${m - 1}`;
  const nextMonthParam = m === 11 ? `${y + 1}-0` : `${y}-${m + 1}`;
  const selectedDateLabel = isMonthMode
    ? MONTH_NAMES[m].toLowerCase() + " " + y
    : isWeekMode
      ? `semana ${weekRange.start.slice(8, 10)}-${addDaysStr(weekRange.end, -1).slice(8, 10)} ${MONTH_NAMES[m].toLowerCase()}`
      : formatDisplayDateEsCl(selDate, { weekday: "long", day: "numeric", month: "long" }, selDate);

  // ── Boletas del rango + agregados sintéticos (boletas únicas) ──
  const boletas = (boletasRawRes.data ?? []).filter((b) => inWorkRange(b.fecha_emision) || inWorkRange(b.created_at)).slice(0, 20);
  const docsBase = (docsData.data ?? []) as DocRow[];
  const boletasComoAgregados = boletas
    .filter((boleta) => !docsBase.some((doc) => (doc.progreso_ia as { boleta_id?: string } | null)?.boleta_id === boleta.id))
    .map((boleta) => {
      const fechaRegistro = boleta.created_at ?? `${boleta.fecha_emision}T12:00:00.000Z`;
      return {
        id: `boleta-unica-${boleta.id}`,
        nombre_archivo: `Boleta unica #${boleta.folio} - ${boleta.receptor_razon_social ?? "consumidor final"}`,
        tipo: "boleta_unica", estado: "procesado", movimientos_detectados: 1, created_at: fechaRegistro,
        progreso_ia: { origen: "emision_directa", boleta_id: boleta.id, folio: boleta.folio, tipo_dte: boleta.tipo_dte, monto_total: boleta.monto_total, receptor: boleta.receptor_razon_social ?? "consumidor final", sintetico_desde_boleta: true },
      };
    });
  const docsAgregados = [...boletasComoAgregados, ...docsBase].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const boletaUnicaIds = new Set(
    docsAgregados.filter((d) => ["boleta_unica", "boleta_sii_local", "dte_simpleapi"].includes(d.tipo)).map((d) => (d.progreso_ia as { boleta_id?: string } | null)?.boleta_id).filter((v): v is string => Boolean(v)),
  );
  const glosaDe = (detalles: unknown) => Array.isArray(detalles) && detalles[0] && typeof detalles[0] === "object" ? String((detalles[0] as { nombre?: unknown }).nombre ?? "") : "";
  const boletasView = boletas.map((b) => ({ ...b, es_unica: boletaUnicaIds.has(b.id), detalle: glosaDe((b as { detalles?: unknown }).detalles) }));

  // ── Feed de actividad del rango (vista Actividad del panel derecho) ──
  // Es date-DEPENDIENTE: se arma con los docs y boletas del rango visible.
  const actividadItems: ActividadItem[] = [];
  for (const doc of docsBase.slice(0, 10)) {
    actividadItems.push({ id: "doc-" + doc.id, tipo: "subida", descripcion: doc.nombre_archivo, detalle: (doc.movimientos_detectados ?? 0) + " movimientos · " + doc.estado, fecha: doc.created_at });
  }
  for (const bol of boletas.slice(0, 10)) {
    const fechaRegistro = bol.created_at ?? bol.fecha_emision;
    actividadItems.push({ id: "bol-" + bol.id, tipo: "emision", descripcion: "Boleta #" + bol.folio + " · " + (bol.tipo_dte === 39 ? "AFECTA" : "EXENTA"), detalle: bol.receptor_razon_social ?? "Sin receptor", fecha: fechaRegistro, monto: bol.monto_total });
  }
  actividadItems.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  // ── Composición por documento (afectas/exentas/gastos) ──
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

  // ── Avance del pipeline por documento ──
  const docProgress: Record<string, { total: number; emitida: number; lista: number; porRevisar: number; noAplica: number }> = {};
  for (const r of (progRowsRes.data ?? []) as Array<{ documento_id: string; total: number; emitida: number; lista: number; por_revisar: number; no_aplica: number }>) {
    docProgress[r.documento_id] = { total: r.total, emitida: r.emitida, lista: r.lista, porRevisar: r.por_revisar, noAplica: r.no_aplica };
  }

  // ── Pendientes de emisión (cola del tab Emitir) — depende de empresa, no del rango ──
  const pendientes = await getPendientesEmision(supabase, empresaId, {
    giro: empresa.giro, razon_social: empresa.razon_social, tipo_contribuyente: empresa.tipo_contribuyente,
  }, { start: workStart, end: workEnd }).catch(() => ({
    items: [] as Awaited<ReturnType<typeof getPendientesEmision>>["items"],
    totales: { total_pendientes: 0, listas_emitir: 0, por_revisar: 0, bloqueadas: 0, monto_total: 0, monto_listo: 0 },
    aprobadas_otros_tipos: {} as Record<string, number>,
  }));

  return {
    selDate, workMode,
    propuestas: propsData.data ?? [],
    docsAgregados,
    docTipoMix,
    docProgress,
    boletasView,
    boletasCount: boletas.length,
    ventasDocs,
    ventasTotal,
    actividadItems,
    pendCount: pendCountData.count ?? 0,
    aprobCount: aprobCountData.count ?? 0,
    pendientes,
    calendar: {
      y, m, monthName: MONTH_NAMES[m], daysInMonth, byDay, today, isThisMonth, selDay,
      weekRange, prevMonthParam, nextMonthParam, selectedDateLabel, workMode, selDate,
    },
  };
}

export type MesaDateDependent = Awaited<ReturnType<typeof fetchMesaDateDependent>>;
