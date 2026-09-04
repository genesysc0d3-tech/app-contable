"use server";

/**
 * Actions del panel /dev — control de mando del operador.
 * TODAS pasan primero por el doble gate server-side (sesión + usuarios.dev_mode)
 * antes de tocar nada con service role. Los updates usan allowlist explícita
 * campo a campo con validación numérica — jamás spread del payload.
 */
import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database, TablesUpdate } from "@/lib/database.types";
import { contextoCuentaPorEmpresa, trialGlobalHabilitado } from "@/lib/entitlements";
import { recordCuentaAudit } from "@/lib/audit/account";
import { recordOpsEvent } from "@/lib/ops/events";
import { inicioTrial } from "@/lib/pagos/metering";
import { purgarCuentaCompleta, type PurgaResumen } from "@/lib/derechos/purga-cuenta";
import { clearDevSupportEmpresaCookie, getDevOperatorContext, getDevSupportMode, setDevSupportEmpresaCookie } from "@/lib/dev/support-mode";
import { cuotaEmpresaMes, periodoActualChile, rangoMesActualChileUtc } from "./helpers";
import { syncPlanActivo } from "@/lib/pagos/activacion";

type ServiceClient = ReturnType<typeof createServiceClient<Database>>;

/**
 * Doble gate: usuario autenticado + usuarios.dev_mode === true. Solo si pasa
 * ambas se entrega el service client. Mismo patrón que /api/config/ai-key.
 */
async function gateOperador(): Promise<{ error: string } | { sb: ServiceClient; userId: string }> {
  const operador = await getDevOperatorContext();
  if (!operador.ok) return { error: "Solo operador Genesys" };
  return { sb: operador.sb, userId: operador.userId };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODIGO_PLAN_RE = /^[a-z0-9_-]{1,32}$/;

/** Valida un número del payload: tipo number real, finito, rango y entero si aplica. */
function numeroValido(valor: unknown, min: number, max: number, entero: boolean): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  if (entero && !Number.isInteger(valor)) return null;
  if (valor < min || valor > max) return null;
  return valor;
}

export type PlanCamposInput = {
  uf_mensual?: number;
  cuota_masivas?: number;
  ruts_incluidos?: number;
  uf_rut_adicional?: number;
  refill_boletas?: number;
  refill_clp_neto?: number;
  trial_dias?: number;
  trial_boletas?: number;
  activo?: boolean;
};

/**
 * Edita un plan de planes_config. Allowlist explícita de las 9 columnas
 * editables; cambiar precios sin deploy es el propósito de este panel.
 */
export async function actualizarPlan(
  codigo: string,
  campos: PlanCamposInput,
): Promise<{ ok: true } | { error: string }> {
  if (process.env.MASSDTE_ENABLE_LEGACY_DEV !== "1") {
    void codigo;
    void campos;
    return { error: "Panel legacy deshabilitado. Usa /dev/cuentas." };
  }

  const gate = await gateOperador();
  if ("error" in gate) return gate;

  if (typeof codigo !== "string" || !CODIGO_PLAN_RE.test(codigo)) {
    return { error: "Código de plan inválido" };
  }
  if (!campos || typeof campos !== "object") return { error: "Campos inválidos" };

  // Allowlist explícita campo a campo — nada de spread del payload.
  const update: TablesUpdate<"planes_config"> = {};

  if (campos.uf_mensual !== undefined) {
    const v = numeroValido(campos.uf_mensual, 0, 100, false);
    if (v === null) return { error: "UF/mes fuera de rango (0–100)" };
    update.uf_mensual = v;
  }
  if (campos.uf_rut_adicional !== undefined) {
    const v = numeroValido(campos.uf_rut_adicional, 0, 100, false);
    if (v === null) return { error: "UF por RUT adicional fuera de rango (0–100)" };
    update.uf_rut_adicional = v;
  }
  if (campos.cuota_masivas !== undefined) {
    const v = numeroValido(campos.cuota_masivas, 0, 1_000_000, true);
    if (v === null) return { error: "Cuota masivas fuera de rango (0–1.000.000)" };
    update.cuota_masivas = v;
  }
  if (campos.ruts_incluidos !== undefined) {
    const v = numeroValido(campos.ruts_incluidos, 0, 10_000, true);
    if (v === null) return { error: "RUTs incluidos fuera de rango (0–10.000)" };
    update.ruts_incluidos = v;
  }
  if (campos.refill_boletas !== undefined) {
    const v = numeroValido(campos.refill_boletas, 0, 1_000_000, true);
    if (v === null) return { error: "Refill boletas fuera de rango (0–1.000.000)" };
    update.refill_boletas = v;
  }
  if (campos.refill_clp_neto !== undefined) {
    const v = numeroValido(campos.refill_clp_neto, 0, 100_000_000, true);
    if (v === null) return { error: "Refill CLP neto fuera de rango (0–100.000.000)" };
    update.refill_clp_neto = v;
  }
  if (campos.trial_dias !== undefined) {
    const v = numeroValido(campos.trial_dias, 0, 365, true);
    if (v === null) return { error: "Trial días fuera de rango (0–365)" };
    update.trial_dias = v;
  }
  if (campos.trial_boletas !== undefined) {
    const v = numeroValido(campos.trial_boletas, 0, 1_000_000, true);
    if (v === null) return { error: "Trial boletas fuera de rango (0–1.000.000)" };
    update.trial_boletas = v;
  }
  if (campos.activo !== undefined) {
    if (typeof campos.activo !== "boolean") return { error: "Activo inválido" };
    update.activo = campos.activo;
  }

  if (Object.keys(update).length === 0) return { error: "Sin cambios que guardar" };
  update.updated_at = new Date().toISOString();

  const { error, count } = await gate.sb
    .from("planes_config")
    .update(update, { count: "exact" })
    .eq("codigo", codigo);
  if (error) return { error: error.message };
  if (!count) return { error: "Plan no encontrado" };

  revalidatePath("/dev");
  return { ok: true };
}

/** Activa o desactiva el acceso de una empresa (empresas.plan_activo). */
export async function togglePlanActivo(
  empresaId: string,
  activo: boolean,
): Promise<{ ok: true } | { error: string }> {
  if (process.env.MASSDTE_ENABLE_LEGACY_DEV !== "1") {
    void empresaId;
    void activo;
    return { error: "Panel legacy deshabilitado. Usa /dev/cuentas." };
  }

  const gate = await gateOperador();
  if ("error" in gate) return gate;

  if (typeof empresaId !== "string" || !UUID_RE.test(empresaId)) {
    return { error: "Empresa inválida" };
  }
  if (typeof activo !== "boolean") return { error: "Valor inválido" };

  const { error, count } = await gate.sb
    .from("empresas")
    .update({ plan_activo: activo }, { count: "exact" })
    .eq("id", empresaId);
  if (error) return { error: error.message };
  if (!count) return { error: "Empresa no encontrada" };

  revalidatePath("/dev");
  return { ok: true };
}

/** Regala boletas masivas del mes actual a una empresa (refill de cortesía). */
export async function otorgarRefillCortesia(
  empresaId: string,
  boletas: number,
): Promise<{ ok: true; boletas: number } | { error: string }> {
  if (process.env.MASSDTE_ENABLE_LEGACY_DEV !== "1") {
    void empresaId;
    void boletas;
    return { error: "Panel legacy deshabilitado. Usa /dev/cuentas." };
  }

  const gate = await gateOperador();
  if ("error" in gate) return gate;

  if (typeof empresaId !== "string" || !UUID_RE.test(empresaId)) {
    return { error: "Empresa inválida" };
  }
  const cantidad = numeroValido(boletas, 1, 100_000, true);
  if (cantidad === null) return { error: "Cantidad fuera de rango (1–100.000)" };

  const { error } = await gate.sb.from("refills").insert({
    empresa_id: empresaId,
    boletas: cantidad,
    origen: "cortesia",
    periodo: periodoActualChile(),
  });
  if (error) return { error: error.message };

  revalidatePath("/dev");
  return { ok: true, boletas: cantidad };
}

export type EmpresaHit = {
  id: string;
  nombre: string;
  rut: string;
  planActivo: boolean;
  planCodigo: string | null;
  uso: number;
  cuota: number;
  refillSugerido: number;
};

/**
 * Busca empresas por RUT o razón social (ilike, máx. 8) y las enriquece con
 * uso masivo del mes, cuota vigente y el refill sugerido según su plan.
 */
export async function buscarEmpresa(
  q: string,
): Promise<{ ok: true; resultados: EmpresaHit[] } | { error: string }> {
  if (process.env.MASSDTE_ENABLE_LEGACY_DEV !== "1") {
    void q;
    return { error: "Panel legacy deshabilitado. Usa /dev/cuentas." };
  }

  const gate = await gateOperador();
  if ("error" in gate) return gate;
  const sb = gate.sb;

  // Sanitizado: solo letras/números/espacios/puntos/guiones — sin comodines
  // ni separadores de la sintaxis or() de PostgREST.
  const limpio = String(q ?? "")
    .trim()
    .slice(0, 60)
    .replace(/[^0-9a-záéíóúñü\s.\-k]/gi, "");
  if (limpio.length < 2) return { error: "Escribe al menos 2 caracteres" };

  const patronNombre = `%${limpio}%`;
  const patronRut = `%${limpio.replace(/\./g, "")}%`;

  const { data: empresas, error } = await sb
    .from("empresas")
    .select("id, razon_social, rut, plan, plan_activo, trial_inicio, created_at")
    .or(`rut.ilike.${patronRut},razon_social.ilike.${patronNombre}`)
    .order("razon_social", { ascending: true })
    .limit(8);
  if (error) return { error: error.message };
  if (!empresas || empresas.length === 0) return { ok: true, resultados: [] };

  const ids = empresas.map((e) => e.id);
  const { desdeIso, hastaIso, periodo } = rangoMesActualChileUtc();

  const [planesQ, susQ, refillsQ, usoCounts] = await Promise.all([
    sb
      .from("planes_config")
      .select("codigo, cuota_masivas, trial_boletas, trial_dias, refill_boletas")
      .order("uf_mensual", { ascending: true }),
    sb
      .from("suscripciones")
      .select("empresa_id, plan_codigo")
      .eq("estado", "activa")
      .in("empresa_id", ids),
    sb.from("refills").select("empresa_id, boletas").eq("periodo", periodo).in("empresa_id", ids),
    Promise.all(
      ids.map((id) =>
        sb
          .from("boletas_emitidas")
          .select("id", { count: "exact", head: true })
          .eq("empresa_id", id)
          .not("propuesta_id", "is", null)
          .neq("estado", "anulada")
          .gte("created_at", desdeIso)
          .lt("created_at", hastaIso),
      ),
    ),
  ]);

  const planes = new Map((planesQ.data ?? []).map((p) => [p.codigo, p] as const));
  const susPorEmpresa = new Map(
    (susQ.data ?? []).map((s) => [s.empresa_id, s.plan_codigo] as const),
  );
  const refillsPorEmpresa = new Map<string, number>();
  for (const r of refillsQ.data ?? []) {
    refillsPorEmpresa.set(r.empresa_id, (refillsPorEmpresa.get(r.empresa_id) ?? 0) + r.boletas);
  }
  const primerPlan = (planesQ.data ?? [])[0];

  const resultados: EmpresaHit[] = empresas.map((e, i) => {
    const { cuota, planCodigo } = cuotaEmpresaMes({
      susPlanCodigo: susPorEmpresa.get(e.id) ?? null,
      empresaPlan: e.plan,
      // Misma regla que el sistema real: el trial parte al abrir la cuenta y
      // `trial_inicio` es solo el override manual (ver inicioTrial). Sin esto
      // el panel mostraba cuota 0 para cuentas que SÍ están en trial.
      trialInicio: inicioTrial(e),
      refillsMes: refillsPorEmpresa.get(e.id) ?? 0,
      planes,
    });
    const plan = planCodigo ? planes.get(planCodigo) : undefined;
    return {
      id: e.id,
      nombre: e.razon_social,
      rut: e.rut,
      planActivo: e.plan_activo,
      planCodigo,
      uso: usoCounts[i].count ?? 0,
      cuota,
      refillSugerido: plan?.refill_boletas ?? primerPlan?.refill_boletas ?? 100,
    };
  });

  return { ok: true, resultados };
}

export async function entrarModoClienteDev(
  empresaId: string,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateOperador();
  if ("error" in gate) return gate;

  if (typeof empresaId !== "string" || !UUID_RE.test(empresaId)) {
    return { error: "Empresa invalida" };
  }

  const [empresaRes, cuenta] = await Promise.all([
    gate.sb.from("empresas").select("id").eq("id", empresaId).maybeSingle(),
    contextoCuentaPorEmpresa(gate.sb, empresaId).catch(() => null),
  ]);
  if (empresaRes.error) return { error: empresaRes.error.message };
  if (!empresaRes.data) return { error: "Empresa no encontrada" };
  if (!cuenta) return { error: "Empresa sin cuenta pagadora" };

  await setDevSupportEmpresaCookie(empresaId);
  await recordCuentaAudit({
    sb: gate.sb,
    cuentaId: cuenta.cuentaId,
    empresaId,
    usuarioId: gate.userId,
    accion: "modo_soporte_entrado",
    recursoTipo: "empresa",
    recursoId: empresaId,
    resumen: "Operador dev entro en modo cliente read-only",
  });
  revalidatePath("/massdte");
  revalidatePath("/escritorio/v5");
  return { ok: true };
}

/**
 * Intervención con permiso del cliente (ver lib/dev/intervencion):
 * solicitar genera el código EN EL CANAL DEL CLIENTE; canjear abre 1 hora de
 * escritura auditada; terminar corta antes. Todas requieren modo soporte activo.
 */
export async function solicitarIntervencionDev(): Promise<
  { ok: true; canal: "telegram" | "app" } | { error: string }
> {
  const support = await getDevSupportMode();
  if (!support?.ok) return { error: "Modo soporte no activo" };
  const { solicitarIntervencion } = await import("@/lib/dev/intervencion");
  const res = await solicitarIntervencion(support.sb, support.empresaId, support.operatorEmail, null);
  if (!res.ok) return { error: res.error };
  await recordCuentaAudit({
    sb: support.sb,
    empresaId: support.empresaId,
    usuarioId: support.operatorUserId,
    accion: "soporte_intervencion_solicitada",
    recursoTipo: "soporte_intervencion",
    recursoId: res.id,
    resumen: `Soporte pidió permiso de intervención (código enviado por ${res.canal})`,
    metadata: { operador: support.operatorEmail, canal: res.canal },
  });
  revalidatePath("/massdte");
  return { ok: true, canal: res.canal };
}

export async function canjearIntervencionDev(
  codigo: string,
): Promise<{ ok: true; expiraAt: string } | { error: string }> {
  const support = await getDevSupportMode();
  if (!support?.ok) return { error: "Modo soporte no activo" };
  const { canjearIntervencion } = await import("@/lib/dev/intervencion");
  const res = await canjearIntervencion(support.sb, support.empresaId, codigo);
  if (!res.ok) return { error: res.error };
  await recordCuentaAudit({
    sb: support.sb,
    empresaId: support.empresaId,
    usuarioId: support.operatorUserId,
    accion: "soporte_intervencion_autorizada",
    recursoTipo: "soporte_intervencion",
    recursoId: res.id,
    resumen: `Cliente autorizó intervención de soporte por 1 hora (hasta ${res.expiraAt})`,
    metadata: { operador: support.operatorEmail, expira_at: res.expiraAt },
  });
  revalidatePath("/massdte");
  return { ok: true, expiraAt: res.expiraAt };
}

export async function terminarIntervencionDev(): Promise<{ ok: true } | { error: string }> {
  const support = await getDevSupportMode();
  if (!support?.ok) return { error: "Modo soporte no activo" };
  const { terminarIntervencion } = await import("@/lib/dev/intervencion");
  const res = await terminarIntervencion(support.sb, support.empresaId);
  if (res.habia) {
    await recordCuentaAudit({
      sb: support.sb,
      empresaId: support.empresaId,
      usuarioId: support.operatorUserId,
      accion: "soporte_intervencion_terminada",
      recursoTipo: "soporte_intervencion",
      resumen: "El operador terminó la intervención antes de la hora",
      metadata: { operador: support.operatorEmail },
    });
  }
  revalidatePath("/massdte");
  return { ok: true };
}

export async function salirModoClienteDev(): Promise<{ ok: true } | { error: string }> {
  const gate = await gateOperador();
  if ("error" in gate) return gate;

  const support = await getDevSupportMode();
  if (support?.ok) {
    // Salir del modo soporte SIEMPRE cierra la intervención: sin ventana
    // viva colgando después de que el operador se fue.
    const { terminarIntervencion } = await import("@/lib/dev/intervencion");
    await terminarIntervencion(support.sb, support.empresaId).catch(() => null);
    const cuenta = await contextoCuentaPorEmpresa(gate.sb, support.empresaId).catch(() => null);
    await recordCuentaAudit({
      sb: gate.sb,
      cuentaId: cuenta?.cuentaId ?? null,
      empresaId: support.empresaId,
      usuarioId: support.operatorUserId,
      accion: "modo_soporte_salido",
      recursoTipo: "empresa",
      recursoId: support.empresaId,
      resumen: "Operador dev salio de modo cliente read-only",
    });
  }
  await clearDevSupportEmpresaCookie();
  revalidatePath("/massdte");
  revalidatePath("/escritorio/v5");
  return { ok: true };
}

const PLAN_CODES = ["start", "pro", "business"] as const;

/**
 * Fija el plan de una cuenta a mano (control de operador): test de tiers y ops
 * cuando la pasarela falla o alguien baja de plan (bajarlo y que deje de estar
 * activo). UPDATE de cuentas.plan_codigo + plan_activo con allowlist de planes.
 * OJO: si la cuenta tiene suscripción activa, su plan_codigo manda sobre esto
 * (ver entitlements.contextoCuentaPorEmpresa) — usar en cuentas sin suscripción.
 */
export async function setCuentaPlan(
  cuentaId: string,
  planCodigo: string,
  planActivo: boolean,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateOperador();
  if ("error" in gate) return gate;
  if (typeof cuentaId !== "string" || !UUID_RE.test(cuentaId)) return { error: "Cuenta inválida" };
  if (!PLAN_CODES.includes(planCodigo as (typeof PLAN_CODES)[number])) return { error: "Plan inválido" };
  if (typeof planActivo !== "boolean") return { error: "Valor inválido" };

  const { count } = await gate.sb
    .from("cuentas")
    .select("id", { count: "exact", head: true })
    .eq("id", cuentaId);
  if (!count) return { error: "Cuenta no encontrada" };

  // LA MISMA función que usan las pasarelas, no una copia. Acá vivía una copia
  // a medias que actualizaba la cuenta y revivía las membresías pero NO
  // propagaba el plan a `empresas.plan_activo`. Caso real (2026-08-28): una
  // cuenta Business activa con una empresa que emitía todos los días quedó
  // "bloqueada" porque su flag nunca se encendió, y el panel mostraba el
  // problema sin dar forma de arreglarlo. El archivo compartido lo advierte en
  // su cabecera: estas reglas se importan, no se reescriben.
  try {
    await syncPlanActivo(gate.sb, { cuentaId, empresaId: null }, planCodigo, planActivo);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo sincronizar el plan" };
  }

  await recordCuentaAudit({
    sb: gate.sb,
    cuentaId,
    empresaId: null,
    usuarioId: gate.userId,
    accion: "plan_cambiado_dev",
    recursoTipo: "cuenta",
    recursoId: cuentaId,
    resumen: `Operador dev fijó plan ${planCodigo} (${planActivo ? "activo" : "inactivo"})`,
  }).catch(() => {});

  revalidatePath(`/dev/cuentas/${cuentaId}`);
  return { ok: true };
}

/** Lee el estado del trial global para pintarlo en el panel. */
export async function obtenerTrialGlobal(): Promise<boolean> {
  const gate = await gateOperador();
  if ("error" in gate) return false;
  return trialGlobalHabilitado(gate.sb);
}

/**
 * Prende/apaga el trial GLOBAL (config_global['trial_habilitado']) — la oferta pública
 * de prueba para TODAS las cuentas sin plan (auditoría #4). Default OFF.
 */
export async function setTrialGlobal(
  habilitado: boolean,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateOperador();
  if ("error" in gate) return gate;
  if (typeof habilitado !== "boolean") return { error: "Valor inválido" };

  const { error } = await gate.sb
    .from("config_global")
    .upsert(
      { clave: "trial_habilitado", valor: habilitado, updated_at: new Date().toISOString() },
      { onConflict: "clave" },
    );
  if (error) return { error: error.message };

  await recordOpsEvent({
    sb: gate.sb,
    severity: "info",
    source: "dev-support",
    eventName: "trial_global_cambiado",
    summary: `Operador dev ${habilitado ? "prendió" : "apagó"} el trial global`,
    metadata: { habilitado, usuario_id: gate.userId },
  }).catch(() => {});

  revalidatePath("/dev");
  revalidatePath("/dev/cuentas");
  return { ok: true };
}

/**
 * Otorga/quita trial de CORTESÍA a una cuenta puntual (cuentas.trial_cortesia), para
 * "amistades" aunque el trial global esté apagado (auditoría #4).
 */
export async function setCuentaTrialCortesia(
  cuentaId: string,
  habilitado: boolean,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateOperador();
  if ("error" in gate) return gate;
  if (typeof cuentaId !== "string" || !UUID_RE.test(cuentaId)) return { error: "Cuenta inválida" };
  if (typeof habilitado !== "boolean") return { error: "Valor inválido" };

  const { error, count } = await gate.sb
    .from("cuentas")
    .update({ trial_cortesia: habilitado }, { count: "exact" })
    .eq("id", cuentaId);
  if (error) return { error: error.message };
  if (!count) return { error: "Cuenta no encontrada" };

  await recordCuentaAudit({
    sb: gate.sb,
    cuentaId,
    empresaId: null,
    usuarioId: gate.userId,
    accion: "trial_cortesia_cambiado",
    recursoTipo: "cuenta",
    recursoId: cuentaId,
    resumen: `Operador dev ${habilitado ? "otorgó" : "quitó"} trial de cortesía`,
  }).catch(() => {});

  revalidatePath(`/dev/cuentas/${cuentaId}`);
  return { ok: true };
}


/**
 * REINICIAR EL RELOJ DEL TRIAL de una empresa (operador, 2026-09-04).
 *
 * El trial arranca solo, con la creación de la cuenta, y se apaga cuando pasan
 * sus días — el temporizador "desactiva el cosito". Esto es la única forma de
 * volver a prenderlo: escribe `empresas.trial_inicio` (el override manual) con
 * la hora actual, así el cliente vuelve a tener sus días completos desde HOY.
 *
 * Ojo, esto NO es lo mismo que "prestarle la prueba" (`trial_cortesia`): esa
 * palanca decide si la cuenta PUEDE tener trial cuando el global está apagado,
 * pero no mueve la fecha — a una empresa creada hace 10 días la cortesía sola
 * no le sirve de nada, porque su ventana ya venció.
 *
 * Regala días de servicio real: queda auditado como cualquier otra
 * intervención de soporte.
 */
export async function reiniciarTrialEmpresa(
  empresaId: string,
): Promise<{ ok: true } | { error: string }> {
  const gate = await gateOperador();
  if ("error" in gate) return gate;
  if (typeof empresaId !== "string" || !UUID_RE.test(empresaId)) return { error: "Empresa inválida" };

  const ahora = new Date().toISOString();
  const { data: empresa, error: buscarError } = await gate.sb
    .from("empresas")
    .select("id, razon_social")
    .eq("id", empresaId)
    .maybeSingle();
  if (buscarError) return { error: buscarError.message };
  if (!empresa) return { error: "Empresa no encontrada" };

  const { error } = await gate.sb
    .from("empresas")
    .update({ trial_inicio: ahora })
    .eq("id", empresaId);
  if (error) return { error: error.message };

  const cuenta = await contextoCuentaPorEmpresa(gate.sb, empresaId);
  await recordCuentaAudit({
    sb: gate.sb,
    cuentaId: cuenta?.cuentaId ?? null,
    empresaId,
    usuarioId: gate.userId,
    accion: "trial_reiniciado",
    recursoTipo: "empresa",
    recursoId: empresaId,
    resumen: `Operador dev reinició la prueba gratis de ${empresa.razon_social} (cuenta desde ${ahora})`,
  }).catch(() => {});

  if (cuenta?.cuentaId) revalidatePath(`/dev/cuentas/${cuenta.cuentaId}`);
  return { ok: true };
}

/**
 * MIGRACIÓN DE EMPRESA entre cuentas (LEGO del fundador, 2026-08-22): los datos
 * cuelgan de empresa_id y no se mueven jamás — esto re-apunta el ÚNICO vínculo
 * cuenta_empresas hacia la cuenta destino. Solo operador, nunca cliente.
 * Checklist de la revisión adversarial: destino con plan efectivo activo
 * y cupo (contando dormidas fuera_de_plan), cero emisiones a medio camino,
 * cero pipeline en vuelo, sin suscripción viva en el origen (se cancela antes,
 * a mano), Telegram de la empresa desconectado en el acto, auditoría en ambas
 * cuentas. Los logins del origen que quedan parados en la empresa que se fue se
 * re-apuntan solos a otra empresa del origen SI le queda alguna; si no queda,
 * es paso humano (docs/runbook-login-huerfano.md) y el panel lo marca en rojo.
 * Verificación de identidad previa (runbook, en el panel): unificación = la
 * persona responde desde ambos correos; recuperación = $1 con código desde la
 * cuenta bancaria de la empresa. Jamás pedir/almacenar cédulas.
 */
export async function migrarEmpresaACuenta(
  empresaId: string,
  cuentaDestinoId: string,
  confirmacion: string,
): Promise<{ ok: true; resumen: string } | { error: string }> {
  const gate = await gateOperador();
  if ("error" in gate) return gate;
  if (typeof empresaId !== "string" || !UUID_RE.test(empresaId)) return { error: "Empresa inválida" };
  if (typeof cuentaDestinoId !== "string" || !UUID_RE.test(cuentaDestinoId)) return { error: "Cuenta destino inválida" };
  const sb = gate.sb;

  const { data: empresa } = await sb.from("empresas").select("id, razon_social, rut").eq("id", empresaId).maybeSingle();
  if (!empresa) return { error: "Empresa no encontrada" };
  if (typeof confirmacion !== "string" || confirmacion.trim() !== empresa.razon_social.trim()) {
    return { error: "La confirmación no coincide con la razón social exacta de la empresa" };
  }

  const { data: vinculo } = await sb
    .from("cuenta_empresas")
    .select("cuenta_id, activa, desactivada_motivo")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!vinculo?.cuenta_id) return { error: "La empresa no tiene cuenta de origen (estado legacy — resolver a mano)" };
  const origenId = vinculo.cuenta_id;
  if (origenId === cuentaDestinoId) return { error: "La empresa ya pertenece a esa cuenta" };
  if (!vinculo.activa) return { error: `La empresa está desactivada en su cuenta (motivo: ${vinculo.desactivada_motivo ?? "?"}) — reactivar/resolver antes de migrar` };

  // Plan EFECTIVO del destino (la suscripción activa manda sobre cuentas.plan_codigo).
  const { data: destino } = await sb
    .from("cuentas")
    .select("id, nombre, owner_usuario_id, plan_codigo, plan_activo")
    .eq("id", cuentaDestinoId)
    .maybeSingle();
  if (!destino) return { error: "Cuenta destino no encontrada" };
  const { data: suscDestino } = await sb
    .from("suscripciones")
    .select("plan_codigo")
    .eq("cuenta_id", cuentaDestinoId)
    .eq("estado", "activa")
    .maybeSingle();
  const planEfectivo = suscDestino?.plan_codigo ?? destino.plan_codigo;
  const planVivo = Boolean(suscDestino) || destino.plan_activo === true;
  if (!planEfectivo || !planVivo) return { error: "La cuenta destino no tiene un plan activo" };
  const { data: planRow } = await sb
    .from("planes_config")
    .select("empresas_incluidas")
    .eq("codigo", planEfectivo)
    .maybeSingle();
  // Divorcio (decisión del fundador, 2026-08-31): la regla NO es "multiempresa",
  // es CUPO. Una empresa puede mudarse a un Start/Pro vacío — el caso del socio
  // que se separa y contrata su propio plan. El modelo "Pro = 1 empresa" lo
  // sigue defendiendo el conteo de abajo: un Pro con su empresa (despierta o
  // dormida) no recibe una segunda ni por soporte.
  if (!planRow) return { error: `El plan del destino (${planEfectivo}) no existe en planes_config` };

  // Cupo contando también las dormidas fuera_de_plan (reviven en el próximo upgrade).
  const { count: cupoUsado } = await sb
    .from("cuenta_empresas")
    .select("empresa_id", { count: "exact", head: true })
    .eq("cuenta_id", cuentaDestinoId)
    .or("activa.eq.true,desactivada_motivo.eq.fuera_de_plan");
  if ((cupoUsado ?? 0) + 1 > (planRow.empresas_incluidas ?? 1)) {
    return { error: `Sin cupo en el destino: ${cupoUsado} empresa(s) (dormidas incluidas) de ${planRow.empresas_incluidas}` };
  }

  // Nada a medio camino: folios reales primero (revision_pendiente ES bloqueante).
  const [jobs, locks, docJobs, reservas, suscOrigen] = await Promise.all([
    sb.from("emision_jobs").select("job_id", { count: "exact", head: true }).eq("empresa_id", empresaId).in("estado", ["created", "running", "revision_pendiente"]),
    sb.from("emision_locks").select("cuenta_id", { count: "exact", head: true }).eq("cuenta_id", origenId),
    sb.from("document_processing_jobs").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).in("status", ["queued", "running", "retryable"]),
    sb.from("folio_reservas").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).eq("estado", "pendiente"),
    sb.from("suscripciones").select("id", { count: "exact", head: true }).eq("cuenta_id", origenId).in("estado", ["activa", "pendiente", "morosa", "pausada"]),
  ]);
  if ((jobs.count ?? 0) > 0) return { error: `Hay ${jobs.count} emisión(es) a medio camino (incluye revision_pendiente) — resolver antes` };
  if ((locks.count ?? 0) > 0) return { error: "La cuenta origen tiene candados de emisión retenidos — resolver antes" };
  if ((docJobs.count ?? 0) > 0) return { error: `Hay ${docJobs.count} documento(s) procesándose — esperar o cancelar antes` };
  if ((reservas.count ?? 0) > 0) return { error: `Hay ${reservas.count} folio(s) reservado(s) pendiente(s) — resolver antes` };
  if ((suscOrigen.count ?? 0) > 0) return { error: "La cuenta origen tiene una suscripción viva (cobraría por cero empresas) — cancelarla primero" };

  // EL MOVE: un solo UPDATE atómico e idempotente (guard por cuenta origen).
  const { count: movidas, error: movErr } = await sb
    .from("cuenta_empresas")
    .update({ cuenta_id: cuentaDestinoId, es_principal: false, activa: true, desactivada_motivo: null }, { count: "exact" })
    .eq("empresa_id", empresaId)
    .eq("cuenta_id", origenId);
  if (movErr) return { error: `El move falló: ${movErr.message}` };
  if (movidas !== 1) return { error: "El move no encontró el vínculo esperado (¿carrera?) — nada cambió, re-verificar" };

  // Post-move (re-ejecutables): plan legacy de la empresa y Telegram fuera (se
  // re-vincula desde la cuenta destino). El acceso del titular destino no
  // necesita paso extra: es miembro de su cuenta y la empresa acaba de llegar
  // a ella — el RLS por cuenta pagadora hace el resto.
  // Se sincroniza la cuenta DESTINO COMPLETA, no solo la empresa que llega.
  // Antes esta línea encendía únicamente a la recién llegada y las que ya
  // vivían ahí se quedaban con el flag que traían: así una empresa que llevaba
  // 200 boletas emitidas amaneció bloqueada el día que le migraron una hermana.
  try {
    await syncPlanActivo(sb, { cuentaId: cuentaDestinoId, empresaId: null }, planEfectivo, true);
  } catch {
    // Si la sincronización falla, al menos la empresa migrada queda operativa:
    // el move ya ocurrió y dejarla sin plan sería peor.
    await sb.from("empresas").update({ plan: planEfectivo, plan_activo: true }).eq("id", empresaId);
  }
  const { count: tgCortados } = await sb
    .from("telegram_chats")
    .update({ activo: false }, { count: "exact" })
    .eq("empresa_id", empresaId)
    .eq("activo", true);

  // Logins del ORIGEN que quedaron parados en la empresa que se fue. Desde el
  // RLS por cuenta pagadora ya no ven nada (la base exige membresía en la
  // cuenta destino), pero su `empresa_id` apunta a una empresa que dal.ts ya no
  // les resuelve: pantalla en blanco. Si al origen le queda otra empresa
  // activa, se les re-apunta ahí; si no queda ninguna, se deja tal cual y el
  // panel lo marca en rojo (runbook-login-huerfano). Los miembros activos del
  // DESTINO no se tocan: su empresa_id sigue siendo válido donde llegó.
  let loginsReapuntados = 0;
  const { data: parados } = await sb.from("usuarios").select("id").eq("empresa_id", empresaId);
  if (parados?.length) {
    const { data: miembrosDestino } = await sb
      .from("cuenta_usuarios")
      .select("usuario_id")
      .eq("cuenta_id", cuentaDestinoId)
      .eq("activo", true)
      .in("usuario_id", parados.map((p) => p.id));
    const enDestino = new Set((miembrosDestino ?? []).map((m) => m.usuario_id));
    const huerfanos = parados.filter((p) => !enDestino.has(p.id));
    if (huerfanos.length) {
      const { data: quedaEnOrigen } = await sb
        .from("cuenta_empresas")
        .select("empresa_id")
        .eq("cuenta_id", origenId)
        .eq("activa", true)
        .limit(1)
        .maybeSingle();
      if (quedaEnOrigen?.empresa_id) {
        const { count } = await sb
          .from("usuarios")
          .update({ empresa_id: quedaEnOrigen.empresa_id }, { count: "exact" })
          .in("id", huerfanos.map((h) => h.id));
        loginsReapuntados = count ?? 0;
      }
    }
  }

  const meta = { empresa_id: empresaId, rut: empresa.rut, cuenta_origen: origenId, cuenta_destino: cuentaDestinoId, telegram_desconectados: tgCortados ?? 0, logins_reapuntados: loginsReapuntados, operador: gate.userId };
  await recordCuentaAudit({ sb, cuentaId: cuentaDestinoId, empresaId, usuarioId: gate.userId, accion: "empresa_migrada_entrante", recursoTipo: "empresa", recursoId: empresaId, resumen: `Migración de soporte: «${empresa.razon_social}» llega desde otra cuenta`, metadata: meta }).catch(() => {});
  await recordCuentaAudit({ sb, cuentaId: origenId, empresaId, usuarioId: gate.userId, accion: "empresa_migrada_saliente", recursoTipo: "empresa", recursoId: empresaId, resumen: `Migración de soporte: «${empresa.razon_social}» sale hacia otra cuenta`, metadata: meta }).catch(() => {});

  revalidatePath("/dev/cuentas");
  revalidatePath(`/dev/cuentas/${cuentaDestinoId}`);
  revalidatePath(`/dev/cuentas/${origenId}`);
  return {
    ok: true,
    resumen: `«${empresa.razon_social}» migrada a «${destino.nombre}». Telegram desconectados: ${tgCortados ?? 0}. Logins del origen re-apuntados a otra empresa suya: ${loginsReapuntados}. Si el panel marca un login colgado en rojo, resolverlo por docs/runbook-login-huerfano.md. Avisar al cliente.`,
  };
}

/**
 * Purga TOTAL de una cuenta (auditoría #27B, derecho de eliminación Ley 21.719). Es
 * DESTRUCTIVO e irreversible: exige que el operador tipee el nombre exacto de la
 * cuenta como confirmación. Conserva auth + consentimientos (prueba ARCO). Ver
 * purgarCuentaCompleta.
 */
export async function purgarCuenta(
  cuentaId: string,
  confirmacion: string,
): Promise<{ ok: true; resumen: PurgaResumen } | { error: string }> {
  const gate = await gateOperador();
  if ("error" in gate) return gate;
  if (typeof cuentaId !== "string" || !UUID_RE.test(cuentaId)) return { error: "Cuenta inválida" };

  const { data: cuenta } = await gate.sb.from("cuentas").select("nombre").eq("id", cuentaId).maybeSingle();
  if (!cuenta) return { error: "Cuenta no encontrada" };
  if (typeof confirmacion !== "string" || confirmacion.trim() !== cuenta.nombre.trim()) {
    return { error: "La confirmación no coincide con el nombre exacto de la cuenta" };
  }

  let resumen: PurgaResumen;
  try {
    resumen = await purgarCuentaCompleta(gate.sb, cuentaId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error al purgar la cuenta" };
  }

  // La auditoría por-cuenta ya no existe (se purgó): registra en ops_events.
  // Si algún archivo no se pudo borrar, el evento sube a `error`: el titular
  // ejerció supresión y quedó un binario suyo vivo en un proveedor. Eso se
  // cierra a mano, y tiene que verse — no puede quedar dentro de un "listo".
  const archivosPendientes = resumen.archivosFallidos.length;
  await recordOpsEvent({
    sb: gate.sb,
    severity: archivosPendientes > 0 ? "error" : "warn",
    source: "dev-support",
    eventName: archivosPendientes > 0 ? "cuenta_purgada_con_archivos_pendientes" : "cuenta_purgada",
    summary: `Operador dev purgó la cuenta «${cuenta.nombre}»: ${resumen.empresas} empresas, ${resumen.documentos} docs, ${resumen.archivos} archivos borrados, ${resumen.auditChunks} audit_chunks, ${resumen.parserLogs} parser_logs`
      + (archivosPendientes > 0 ? ` — ⚠ ${archivosPendientes} archivo(s) NO se pudieron borrar del almacenamiento: hay que eliminarlos a mano` : ""),
    metadata: { cuentaId, usuario_id: gate.userId, ...resumen },
  }).catch(() => {});

  revalidatePath("/dev/cuentas");
  return { ok: true, resumen };
}
