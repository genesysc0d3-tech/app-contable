/**
 * /dev — control de mando del operador (y futuro data room).
 * Server component: gate por usuarios.dev_mode (los usuarios normales reciben
 * 404 — la ruta no existe para ellos), métricas en paralelo vía service role.
 * Sin link en ningún nav: acceso directo por URL.
 */
import { notFound } from "next/navigation";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getUsuario } from "@/lib/dal";
import { getUfClp } from "@/lib/sii/uf";
import type { Database } from "@/lib/database.types";
import DevPanelClient, { type DevStats, type TopEmpresaUso } from "./DevPanelClient";
import { cuotaEmpresaMes, haceDiasIso, rangoMesActualChileUtc, trialVigente } from "./helpers";

type ServiceClient = ReturnType<typeof createServiceClient<Database>>;

const PAGINA = 1000;
const MAX_PAGINAS = 10;

/**
 * empresa_id de cada boleta masiva del mes, paginado (PostgREST corta en
 * 1.000 filas por request). Tope de 10.000 filas para acotar el trabajo: el
 * conteo global usa head+count exacto aparte; esto solo alimenta el top 10.
 */
async function empresaIdsMasivasMes(
  sb: ServiceClient,
  desdeIso: string,
  hastaIso: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const { data, error } = await sb
      .from("boletas_emitidas")
      .select("empresa_id")
      .not("propuesta_id", "is", null)
      .neq("estado", "anulada")
      .gte("created_at", desdeIso)
      .lt("created_at", hastaIso)
      .order("created_at", { ascending: true })
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);
    if (error || !data) break;
    for (const fila of data) ids.push(fila.empresa_id);
    if (data.length < PAGINA) break;
  }
  return ids;
}

export default async function DevPage() {
  const usuario = await getUsuario();
  if (!usuario || usuario.dev_mode !== true) notFound();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service role de Supabase no configurado");
  const sb = createServiceClient<Database>(url, key);

  const { desdeIso, hastaIso, periodo } = rangoMesActualChileUtc();
  // Ventana generosa para candidatos a trial; el filtro fino (trial_dias del
  // plan según planes_config) se aplica abajo en memoria.
  const ventanaTrialsIso = haceDiasIso(365);

  const [
    ufClp,
    planesQ,
    empresasCountQ,
    susActivasQ,
    boletasTotalQ,
    boletasMasivasQ,
    trialCandidatosQ,
    refillsMesQ,
    masivasEmpresaIds,
  ] = await Promise.all([
    getUfClp(),
    sb.from("planes_config").select("*").order("uf_mensual", { ascending: true }),
    sb.from("empresas").select("id", { count: "exact", head: true }),
    sb.from("suscripciones").select("empresa_id, plan_codigo").eq("estado", "activa"),
    sb
      .from("boletas_emitidas")
      .select("id", { count: "exact", head: true })
      .neq("estado", "anulada")
      .gte("created_at", desdeIso)
      .lt("created_at", hastaIso),
    sb
      .from("boletas_emitidas")
      .select("id", { count: "exact", head: true })
      .not("propuesta_id", "is", null)
      .neq("estado", "anulada")
      .gte("created_at", desdeIso)
      .lt("created_at", hastaIso),
    sb
      .from("empresas")
      .select("id, plan, trial_inicio")
      .not("trial_inicio", "is", null)
      .gte("trial_inicio", ventanaTrialsIso),
    sb.from("refills").select("empresa_id, boletas, origen").eq("periodo", periodo),
    empresaIdsMasivasMes(sb, desdeIso, hastaIso),
  ]);

  const planes = planesQ.data ?? [];
  const planesPorCodigo = new Map(planes.map((p) => [p.codigo, p] as const));

  // MRR = Σ uf_mensual de suscripciones activas × UF del día.
  const susActivas = susActivasQ.data ?? [];
  const activasPorPlan = new Map<string, number>();
  for (const s of susActivas) {
    activasPorPlan.set(s.plan_codigo, (activasPorPlan.get(s.plan_codigo) ?? 0) + 1);
  }
  let mrrUf = 0;
  for (const [codigo, n] of activasPorPlan) {
    mrrUf += (planesPorCodigo.get(codigo)?.uf_mensual ?? 0) * n;
  }

  // Trials en curso: trial_inicio dentro de la ventana de su plan y sin
  // suscripción activa. Plan desconocido → ventana máxima entre los planes.
  const empresasConSusActiva = new Set(susActivas.map((s) => s.empresa_id));
  const maxTrialDias = planes.reduce((max, p) => Math.max(max, p.trial_dias), 0);
  const trialsEnCurso = (trialCandidatosQ.data ?? []).filter((e) => {
    if (empresasConSusActiva.has(e.id)) return false;
    const planEmpresa = e.plan ? planesPorCodigo.get(e.plan) : undefined;
    const dias = planEmpresa ? planEmpresa.trial_dias : maxTrialDias;
    return trialVigente(e.trial_inicio, dias);
  }).length;

  // Refills del período: alimentan las cuotas del top 10 y las cortesías.
  const refillsPorEmpresa = new Map<string, number>();
  let cortesiasMesBoletas = 0;
  let cortesiasMesRegalos = 0;
  for (const r of refillsMesQ.data ?? []) {
    refillsPorEmpresa.set(r.empresa_id, (refillsPorEmpresa.get(r.empresa_id) ?? 0) + r.boletas);
    if (r.origen === "cortesia") {
      cortesiasMesBoletas += r.boletas;
      cortesiasMesRegalos += 1;
    }
  }

  // Top 10 por uso masivo del mes.
  const usoPorEmpresa = new Map<string, number>();
  for (const id of masivasEmpresaIds) {
    usoPorEmpresa.set(id, (usoPorEmpresa.get(id) ?? 0) + 1);
  }
  const top = [...usoPorEmpresa.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const susPlanPorEmpresa = new Map(susActivas.map((s) => [s.empresa_id, s.plan_codigo] as const));

  let topEmpresas: TopEmpresaUso[] = [];
  if (top.length > 0) {
    const { data: empresasTop } = await sb
      .from("empresas")
      .select("id, razon_social, rut, plan, trial_inicio")
      .in(
        "id",
        top.map(([id]) => id),
      );
    const infoPorId = new Map((empresasTop ?? []).map((e) => [e.id, e] as const));
    topEmpresas = top.map(([id, uso]) => {
      const info = infoPorId.get(id);
      const { cuota } = cuotaEmpresaMes({
        susPlanCodigo: susPlanPorEmpresa.get(id) ?? null,
        empresaPlan: info?.plan ?? null,
        trialInicio: info?.trial_inicio ?? null,
        refillsMes: refillsPorEmpresa.get(id) ?? 0,
        planes: planesPorCodigo,
      });
      return {
        id,
        nombre: info?.razon_social ?? "(empresa eliminada)",
        rut: info?.rut ?? "",
        uso,
        cuota,
      };
    });
  }

  const stats: DevStats = {
    periodo,
    ufClp,
    mrrUf,
    mrrClp: Math.round(mrrUf * ufClp),
    totalEmpresas: empresasCountQ.count ?? 0,
    susActivasTotal: susActivas.length,
    susPorPlan: planes.map((p) => ({
      codigo: p.codigo,
      nombre: p.nombre,
      activas: activasPorPlan.get(p.codigo) ?? 0,
    })),
    boletasMesTotal: boletasTotalQ.count ?? 0,
    boletasMesMasivas: boletasMasivasQ.count ?? 0,
    trialsEnCurso,
    cortesiasMesBoletas,
    cortesiasMesRegalos,
    topEmpresas,
  };

  return <DevPanelClient planes={planes} stats={stats} />;
}
