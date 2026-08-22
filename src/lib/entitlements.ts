import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { chileDateString } from "./chile-date";

type Sb = SupabaseClient<Database>;

export interface CuentaContexto {
  cuentaId: string;
  empresaActivaId: string;
  plan: string | null;
  planActivo: boolean;
  suscripcionActiva: boolean;
  suscripcionEstado: string | null;
  empresasIncluidas: number;
  personasIncluidas: number;
  telegramComprobantes: number;
  equipo: boolean;
  multiempresa: boolean;
  empresasActivas: number;
  personasActivas: number;
  trialCortesia: boolean;
}

/**
 * ¿El trial está ofrecido GLOBALMENTE? (config_global['trial_habilitado'], operado
 * desde /dev). Sin PII → lectura permitida a autenticados. NO importa metering (ciclo).
 */
export async function trialGlobalHabilitado(sb: Sb): Promise<boolean> {
  const { data, error } = await sb
    .from("config_global")
    .select("valor")
    .eq("clave", "trial_habilitado")
    .maybeSingle();
  if (error) return false; // fail-closed: ante duda, no se ofrece trial
  return data?.valor === true;
}

/**
 * ¿Esta cuenta tiene trial disponible? = global ON, o cortesía puntual de la cuenta
 * (cuentas.trial_cortesia, para "amistades" con el global apagado).
 */
export async function trialDisponibleCuenta(sb: Sb, cuentaId: string): Promise<boolean> {
  if (await trialGlobalHabilitado(sb)) return true;
  const { data } = await sb.from("cuentas").select("trial_cortesia").eq("id", cuentaId).maybeSingle();
  return data?.trial_cortesia === true;
}

export type AccesoCuenta =
  | { ok: true; cuentaId: string; planActivo: boolean; plan: string | null }
  | { ok: false; codigo: "EMPRESA_SIN_CUENTA" | "EMPRESA_INACTIVA" | "USUARIO_SIN_CUENTA" | "CUENTA_INACTIVA" };

export async function cuentaIdDeEmpresa(sb: Sb, empresaId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("cuenta_empresas")
    .select("cuenta_id, activa")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo resolver la cuenta de la empresa: ${error.message}`);
  if (!data?.activa) return null;
  return data.cuenta_id;
}

export async function empresasActivasDeCuenta(sb: Sb, cuentaId: string): Promise<string[]> {
  const { data, error } = await sb
    .from("cuenta_empresas")
    .select("empresa_id")
    .eq("cuenta_id", cuentaId)
    .eq("activa", true);
  if (error) throw new Error(`No se pudieron leer empresas de la cuenta: ${error.message}`);
  return (data ?? []).map((row) => row.empresa_id);
}

export async function empresaPrincipalDeCuenta(sb: Sb, cuentaId: string): Promise<string | null> {
  const { data, error } = await sb
    .from("cuenta_empresas")
    .select("empresa_id")
    .eq("cuenta_id", cuentaId)
    .eq("activa", true)
    .order("es_principal", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo resolver la empresa principal: ${error.message}`);
  return data?.empresa_id ?? null;
}

export async function validarAccesoCuenta(sb: Sb, userId: string, empresaId: string): Promise<AccesoCuenta> {
  const { data: membresiaEmpresa, error: empresaError } = await sb
    .from("cuenta_empresas")
    .select("cuenta_id, activa")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (empresaError) throw new Error(`No se pudo validar la empresa activa: ${empresaError.message}`);
  if (!membresiaEmpresa) return { ok: false, codigo: "EMPRESA_SIN_CUENTA" };
  if (!membresiaEmpresa.activa) return { ok: false, codigo: "EMPRESA_INACTIVA" };

  const { data: membresiaUsuario, error: usuarioError } = await sb
    .from("cuenta_usuarios")
    .select("activo")
    .eq("cuenta_id", membresiaEmpresa.cuenta_id)
    .eq("usuario_id", userId)
    .maybeSingle();
  if (usuarioError) throw new Error(`No se pudo validar el usuario en la cuenta: ${usuarioError.message}`);
  if (!membresiaUsuario?.activo) return { ok: false, codigo: "USUARIO_SIN_CUENTA" };

  const { data: cuenta, error: cuentaError } = await sb
    .from("cuentas")
    .select("plan_activo, plan_codigo")
    .eq("id", membresiaEmpresa.cuenta_id)
    .maybeSingle();
  if (cuentaError) throw new Error(`No se pudo leer la cuenta: ${cuentaError.message}`);
  if (!cuenta) return { ok: false, codigo: "CUENTA_INACTIVA" };

  return {
    ok: true,
    cuentaId: membresiaEmpresa.cuenta_id,
    planActivo: cuenta.plan_activo,
    plan: cuenta.plan_codigo,
  };
}

export async function contextoCuentaPorEmpresa(sb: Sb, empresaId: string): Promise<CuentaContexto | null> {
  const cuentaId = await cuentaIdDeEmpresa(sb, empresaId);
  if (!cuentaId) return null;

  const [cuentaRes, suscripcionRes, empresasRes, usuariosRes] = await Promise.all([
    sb.from("cuentas").select("plan_codigo, plan_activo, trial_cortesia").eq("id", cuentaId).maybeSingle(),
    sb
      .from("suscripciones")
      .select("plan_codigo, estado")
      .eq("cuenta_id", cuentaId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("cuenta_empresas")
      .select("empresa_id", { count: "exact", head: true })
      .eq("cuenta_id", cuentaId)
      .eq("activa", true),
    sb
      .from("cuenta_usuarios")
      .select("usuario_id", { count: "exact", head: true })
      .eq("cuenta_id", cuentaId)
      .eq("activo", true),
  ]);

  if (cuentaRes.error) throw new Error(`No se pudo leer la cuenta: ${cuentaRes.error.message}`);
  if (suscripcionRes.error) throw new Error(`No se pudo leer la suscripción: ${suscripcionRes.error.message}`);
  if (empresasRes.error) throw new Error(`No se pudo contar empresas: ${empresasRes.error.message}`);
  if (usuariosRes.error) throw new Error(`No se pudo contar personas: ${usuariosRes.error.message}`);

  const cuenta = cuentaRes.data;
  const suscripcion = suscripcionRes.data ?? null;
  const suscripcionActiva = suscripcion?.estado === "activa";
  const planCodigo = suscripcionActiva ? suscripcion.plan_codigo : cuenta?.plan_codigo ?? null;
  const planActivo = suscripcionActiva || cuenta?.plan_activo === true;
  const planRes = planCodigo
    ? await sb
        .from("planes_config")
        .select("empresas_incluidas, personas_incluidas, telegram_comprobantes, equipo, multiempresa")
        .eq("codigo", planCodigo)
        .maybeSingle()
    : { data: null, error: null };
  if (planRes.error) throw new Error(`No se pudo leer el plan: ${planRes.error.message}`);

  return {
    cuentaId,
    empresaActivaId: empresaId,
    plan: planCodigo,
    planActivo,
    suscripcionActiva,
    suscripcionEstado: suscripcion?.estado ?? null,
    empresasIncluidas: planRes.data?.empresas_incluidas ?? 1,
    personasIncluidas: planRes.data?.personas_incluidas ?? 1,
    telegramComprobantes: planRes.data?.telegram_comprobantes ?? 0,
    equipo: planRes.data?.equipo ?? false,
    multiempresa: planRes.data?.multiempresa ?? false,
    empresasActivas: empresasRes.count ?? 0,
    personasActivas: usuariosRes.count ?? 0,
    trialCortesia: cuenta?.trial_cortesia === true,
  };
}

/**
 * ¿La cuenta está en "elección de empresa operativa pendiente"? = downgrade a
 * un plan SIN multiempresa con más empresas activas que el cupo, y el titular
 * aún no elige (cuentas.empresa_operativa_elegida_at IS NULL). Mientras esté
 * pendiente, las superficies de OPERACIÓN (subir cartolas, mesa) se bloquean
 * para que la ventana no sea un plan Business gratis vía API.
 */
export async function eleccionEmpresaPendiente(sb: Sb, empresaId: string): Promise<boolean> {
  const ctx = await contextoCuentaPorEmpresa(sb, empresaId);
  if (!ctx || !ctx.planActivo) return false;
  if (ctx.multiempresa) return false;
  if (ctx.empresasActivas <= ctx.empresasIncluidas) return false;
  const { data } = await sb
    .from("cuentas")
    .select("empresa_operativa_elegida_at")
    .eq("id", ctx.cuentaId)
    .maybeSingle();
  return !data?.empresa_operativa_elegida_at;
}

/**
 * ¿La cuenta de esta empresa tiene Telegram en su plan? = (cupo base del plan +
 * addons 'telegram' activos) > 0. Mismo criterio que listarResumenCupos
 * (telegram.habilitado). NO importa metering (ciclo): el período se arma con
 * chileDateString, igual que periodoActual().
 */
export async function telegramHabilitadoEmpresa(sb: Sb, empresaId: string): Promise<boolean> {
  const ctx = await contextoCuentaPorEmpresa(sb, empresaId);
  if (!ctx) return false;
  const periodo = chileDateString().slice(0, 7);
  const { data, error } = await sb
    .from("cuenta_addons")
    .select("cantidad")
    .eq("cuenta_id", ctx.cuentaId)
    .eq("tipo", "telegram")
    .eq("estado", "activo")
    .or(`periodo.is.null,periodo.eq.${periodo}`);
  if (error) throw new Error(`No se pudieron leer addons telegram: ${error.message}`);
  const extras = (data ?? []).reduce((s, r) => s + Math.max(0, Number(r.cantidad ?? 0)), 0);
  return ctx.telegramComprobantes + extras > 0;
}
