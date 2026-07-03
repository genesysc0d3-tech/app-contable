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
import { purgarCuentaCompleta, type PurgaResumen } from "@/lib/derechos/purga-cuenta";
import { clearDevSupportEmpresaCookie, getDevOperatorContext, getDevSupportMode, setDevSupportEmpresaCookie } from "@/lib/dev/support-mode";
import { cuotaEmpresaMes, periodoActualChile, rangoMesActualChileUtc } from "./helpers";

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
    .select("id, razon_social, rut, plan, plan_activo, trial_inicio")
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
      trialInicio: e.trial_inicio,
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

export async function salirModoClienteDev(): Promise<{ ok: true } | { error: string }> {
  const gate = await gateOperador();
  if ("error" in gate) return gate;

  const support = await getDevSupportMode();
  if (support?.ok) {
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

  const { error, count } = await gate.sb
    .from("cuentas")
    .update({ plan_codigo: planCodigo, plan_activo: planActivo }, { count: "exact" })
    .eq("id", cuentaId);
  if (error) return { error: error.message };
  if (!count) return { error: "Cuenta no encontrada" };

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
  await recordOpsEvent({
    sb: gate.sb,
    severity: "warn",
    source: "dev-support",
    eventName: "cuenta_purgada",
    summary: `Operador dev purgó la cuenta «${cuenta.nombre}»: ${resumen.empresas} empresas, ${resumen.documentos} docs, ${resumen.auditChunks} audit_chunks, ${resumen.parserLogs} parser_logs`,
    metadata: { cuentaId, usuario_id: gate.userId, ...resumen },
  }).catch(() => {});

  revalidatePath("/dev/cuentas");
  return { ok: true, resumen };
}
