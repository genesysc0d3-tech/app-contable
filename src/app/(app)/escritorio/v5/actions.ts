"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getDevSupportMode } from "@/lib/dev/support-mode";
import { empresasActivasDeCuenta, contextoCuentaPorEmpresa, validarAccesoCuenta } from "@/lib/entitlements";
import { chileMonthUtcRange, estadoCuota, periodoActual } from "@/lib/pagos/metering";
import { recordCuentaAudit } from "@/lib/audit/account";
import { createClient } from "@/lib/supabase/server";

type EmpresaSelectorRow = {
  id: string;
  nombre: string;
  rut: string | null;
  activaActual: boolean;
  esPrincipal: boolean;
  logoUrl: string;
};

type EmpresasSelectorResult =
  | { ok: true; empresas: EmpresaSelectorRow[]; multiempresa: boolean }
  | { ok: false; error: string; detalle?: string };

type CambiarEmpresaResult =
  | { ok: true; empresa_id: string }
  | { ok: false; error: string; detalle?: string };

export type EquipoPersona = {
  id: string;
  nombre: string;
  email: string | null;
  iniciales: string;
  empresaActivaId: string | null;
  empresaActivaNombre: string | null;
};

type EquipoBusinessResult =
  | {
      ok: true;
      equipo: boolean;
      cuentaId: string;
      usuarioId: string;
      empresaActivaId: string;
      empresaActivaNombre: string;
      personas: EquipoPersona[];
    }
  | { ok: false; error: string; detalle?: string };

export type ResumenCupos = {
  periodo: string;
  plan: string | null;
  planActivo: boolean;
  boletasCartolas: {
    uso: number;
    base: number;
    extras: number;
    total: number;
    disponible: number;
  };
  telegram: {
    habilitado: boolean;
    uso: number;
    base: number;
    extras: number;
    total: number;
    disponible: number;
  };
  empresas: {
    uso: number;
    incluidas: number;
    extras: number;
    total: number;
  };
  personas: {
    uso: number;
    incluidas: number;
    extras: number;
    total: number;
  };
  extrasActivos: Array<{
    tipo: "empresa_adicional" | "persona_adicional" | "boletas_cartola" | "telegram";
    cantidad: number;
  }>;
};

type ResumenCuposResult =
  | { ok: true; resumen: ResumenCupos }
  | { ok: false; error: string; detalle?: string };

function cleanId(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

function initialsFor(nombre: string, email: string | null) {
  const source = nombre.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts.length >= 2
    ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
    : source.slice(0, 2);
  return initials.toUpperCase();
}

function sumByTipo(
  rows: Array<{ tipo: string; cantidad: number | null }>,
  tipo: ResumenCupos["extrasActivos"][number]["tipo"],
) {
  return rows
    .filter((row) => row.tipo === tipo)
    .reduce((sum, row) => sum + Math.max(0, Number(row.cantidad ?? 0)), 0);
}

async function contarComprobantesTelegramUtiles(
  sb: ReturnType<typeof getServiceClient>,
  empresaIds: string[],
  desdeIso: string,
  hastaIso: string,
) {
  if (empresaIds.length === 0) return 0;
  const { count, error } = await sb
    .from("propuestas_ia")
    .select("id, movimientos_raw!inner(origen)", { count: "exact", head: true })
    .in("empresa_id", empresaIds)
    .in("estado", ["pendiente", "aprobado", "editado"])
    .in("tipo_propuesto", ["boleta", "factura"])
    .eq("movimientos_raw.origen", "telegram")
    .gte("created_at", desdeIso)
    .lt("created_at", hastaIso);
  if (error) throw new Error(`TELEGRAM_USAGE_QUERY_FAILED:${error.message}`);
  return count ?? 0;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("BACKEND_CONFIG_MISSING");
  return createServiceClient<Database>(url, key);
}

async function getUsuarioActivo() {
  const support = await getDevSupportMode();
  if (support?.ok) {
    return {
      ok: true as const,
      sb: support.sb,
      userId: support.operatorUserId,
      empresaId: support.empresaId,
      supportMode: true,
    };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "NO_AUTH" };

  const sb = getServiceClient();
  const { data: usuario, error } = await sb
    .from("usuarios")
    .select("id, empresa_id, vetado")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return { ok: false as const, error: "USUARIO_QUERY_FAILED", detalle: error.message };
  if (!usuario?.empresa_id) return { ok: false as const, error: "USUARIO_SIN_EMPRESA" };
  if (usuario.vetado) return { ok: false as const, error: "USUARIO_BLOQUEADO" };

  return { ok: true as const, sb, userId: user.id, empresaId: usuario.empresa_id, supportMode: false };
}

async function resolverAccesoCuenta(ctx: Awaited<ReturnType<typeof getUsuarioActivo>>) {
  if (!ctx.ok) return { ok: false as const, codigo: ctx.error };
  if (!ctx.supportMode) return validarAccesoCuenta(ctx.sb, ctx.userId, ctx.empresaId);

  const cuenta = await contextoCuentaPorEmpresa(ctx.sb, ctx.empresaId);
  if (!cuenta) return { ok: false as const, codigo: "EMPRESA_SIN_CUENTA" as const };
  return {
    ok: true as const,
    cuentaId: cuenta.cuentaId,
    planActivo: cuenta.planActivo,
    plan: cuenta.plan,
  };
}

async function planPermiteMultiempresa(sb: ReturnType<typeof getServiceClient>, plan: string | null) {
  if (!plan) return false;
  const { data, error } = await sb
    .from("planes_config")
    .select("multiempresa")
    .eq("codigo", plan)
    .maybeSingle();
  if (error) throw new Error(`PLAN_QUERY_FAILED:${error.message}`);
  return data?.multiempresa === true;
}

export async function listarEmpresasSelector(): Promise<EmpresasSelectorResult> {
  try {
    const ctx = await getUsuarioActivo();
    if (!ctx.ok) return ctx;

    const acceso = await resolverAccesoCuenta(ctx);
    if (!acceso.ok) return { ok: false, error: acceso.codigo };
    if (!acceso.planActivo) return { ok: false, error: "PLAN_INACTIVO" };

    const { data: membresias, error: membresiasError } = await ctx.sb
      .from("cuenta_empresas")
      .select("empresa_id, es_principal")
      .eq("cuenta_id", acceso.cuentaId)
      .eq("activa", true)
      .order("es_principal", { ascending: false })
      .order("created_at", { ascending: true });

    if (membresiasError) return { ok: false, error: "EMPRESAS_QUERY_FAILED", detalle: membresiasError.message };

    const ids = (membresias ?? []).map((row) => row.empresa_id);
    if (ids.length === 0) return { ok: true, empresas: [], multiempresa: false };

    const { data: empresas, error: empresasError } = await ctx.sb
      .from("empresas")
      .select("id, razon_social, rut")
      .in("id", ids);
    if (empresasError) return { ok: false, error: "EMPRESAS_DATA_FAILED", detalle: empresasError.message };

    const byId = new Map((empresas ?? []).map((empresa) => [empresa.id, empresa]));
    const items: EmpresaSelectorRow[] = [];
    for (const id of ids) {
      const empresa = byId.get(id);
      if (!empresa) continue;
      const membresia = membresias?.find((row) => row.empresa_id === id);
      items.push({
        id,
        nombre: empresa.razon_social,
        rut: empresa.rut ?? null,
        activaActual: id === ctx.empresaId,
        esPrincipal: membresia?.es_principal === true,
        logoUrl: `/api/empresa/logo/${id}`,
      });
    }

    return {
      ok: true,
      empresas: items,
      multiempresa: await planPermiteMultiempresa(ctx.sb, acceso.plan),
    };
  } catch (error) {
    return { ok: false, error: "EMPRESAS_SELECTOR_FAILED", detalle: error instanceof Error ? error.message : undefined };
  }
}

export async function cambiarEmpresaActiva(empresaId: string): Promise<CambiarEmpresaResult> {
  try {
    const targetEmpresaId = cleanId(empresaId);
    if (!targetEmpresaId) return { ok: false, error: "EMPRESA_INVALIDA" };

    const ctx = await getUsuarioActivo();
    if (!ctx.ok) return ctx;
    if (targetEmpresaId === ctx.empresaId) return { ok: true, empresa_id: targetEmpresaId };

    const acceso = await resolverAccesoCuenta(ctx);
    if (!acceso.ok) return { ok: false, error: acceso.codigo };
    if (!acceso.planActivo) return { ok: false, error: "PLAN_INACTIVO" };

    const multiempresa = await planPermiteMultiempresa(ctx.sb, acceso.plan);
    if (!multiempresa) return { ok: false, error: "PLAN_SIN_MULTIEMPRESA" };

    const { data: target, error: targetError } = await ctx.sb
      .from("cuenta_empresas")
      .select("empresa_id, activa")
      .eq("cuenta_id", acceso.cuentaId)
      .eq("empresa_id", targetEmpresaId)
      .maybeSingle();

    if (targetError) return { ok: false, error: "EMPRESA_TARGET_QUERY_FAILED", detalle: targetError.message };
    if (!target?.activa) return { ok: false, error: "EMPRESA_NO_DISPONIBLE" };

    if (ctx.supportMode) {
      return { ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: "Modo soporte: solo lectura" };
    }

    const { error: updateError } = await ctx.sb
      .from("usuarios")
      .update({ empresa_id: targetEmpresaId })
      .eq("id", ctx.userId);

    if (updateError) return { ok: false, error: "CAMBIO_EMPRESA_FAILED", detalle: updateError.message };

    await recordCuentaAudit({
      sb: ctx.sb,
      cuentaId: acceso.cuentaId,
      empresaId: targetEmpresaId,
      usuarioId: ctx.userId,
      accion: "empresa_activa_cambiada",
      recursoTipo: "empresa",
      recursoId: targetEmpresaId,
      resumen: "Cambio de empresa activa",
      metadata: { desde_empresa_id: ctx.empresaId, hacia_empresa_id: targetEmpresaId },
    });

    revalidatePath("/massdte");
    revalidatePath("/escritorio/v5");
    return { ok: true, empresa_id: targetEmpresaId };
  } catch (error) {
    return { ok: false, error: "CAMBIO_EMPRESA_FAILED", detalle: error instanceof Error ? error.message : undefined };
  }
}

export async function listarEquipoBusiness(): Promise<EquipoBusinessResult> {
  try {
    const ctx = await getUsuarioActivo();
    if (!ctx.ok) return ctx;

    const acceso = await resolverAccesoCuenta(ctx);
    if (!acceso.ok) return { ok: false, error: acceso.codigo };
    if (!acceso.planActivo) return { ok: false, error: "PLAN_INACTIVO" };

    const { data: plan, error: planError } = acceso.plan
      ? await ctx.sb.from("planes_config").select("equipo").eq("codigo", acceso.plan).maybeSingle()
      : { data: null, error: null };
    if (planError) return { ok: false, error: "PLAN_QUERY_FAILED", detalle: planError.message };
    if (plan?.equipo !== true) {
      return {
        ok: true,
        equipo: false,
        cuentaId: acceso.cuentaId,
        usuarioId: ctx.userId,
        empresaActivaId: ctx.empresaId,
        empresaActivaNombre: "",
        personas: [],
      };
    }

    const { data: membresias, error: membresiasError } = await ctx.sb
      .from("cuenta_usuarios")
      .select("usuario_id")
      .eq("cuenta_id", acceso.cuentaId)
      .eq("activo", true)
      .order("created_at", { ascending: true });
    if (membresiasError) return { ok: false, error: "EQUIPO_QUERY_FAILED", detalle: membresiasError.message };

    const userIds = (membresias ?? []).map((row) => row.usuario_id);
    const { data: usuarios, error: usuariosError } = userIds.length > 0
      ? await ctx.sb.from("usuarios").select("id, nombre, email, empresa_id").in("id", userIds)
      : { data: [], error: null };
    if (usuariosError) return { ok: false, error: "EQUIPO_USUARIOS_FAILED", detalle: usuariosError.message };

    const empresaIds = Array.from(new Set((usuarios ?? []).map((usuario) => usuario.empresa_id).filter(Boolean)));
    const { data: empresas, error: empresasError } = empresaIds.length > 0
      ? await ctx.sb.from("empresas").select("id, razon_social").in("id", empresaIds)
      : { data: [], error: null };
    if (empresasError) return { ok: false, error: "EQUIPO_EMPRESAS_FAILED", detalle: empresasError.message };

    const empresaById = new Map((empresas ?? []).map((empresa) => [empresa.id, empresa.razon_social]));
    const usuarioById = new Map((usuarios ?? []).map((usuario) => [usuario.id, usuario]));
    const personas = userIds
      .map((id) => usuarioById.get(id))
      .filter((usuario): usuario is NonNullable<typeof usuario> => Boolean(usuario))
      .map((usuario) => ({
        id: usuario.id,
        nombre: usuario.nombre || usuario.email,
        email: usuario.email,
        iniciales: initialsFor(usuario.nombre, usuario.email),
        empresaActivaId: usuario.empresa_id,
        empresaActivaNombre: empresaById.get(usuario.empresa_id) ?? null,
      }));

    return {
      ok: true,
      equipo: true,
      cuentaId: acceso.cuentaId,
      usuarioId: ctx.userId,
      empresaActivaId: ctx.empresaId,
      empresaActivaNombre: empresaById.get(ctx.empresaId) ?? "",
      personas,
    };
  } catch (error) {
    return { ok: false, error: "EQUIPO_BUSINESS_FAILED", detalle: error instanceof Error ? error.message : undefined };
  }
}

export async function listarResumenCupos(): Promise<ResumenCuposResult> {
  try {
    const ctx = await getUsuarioActivo();
    if (!ctx.ok) return ctx;

    const acceso = await resolverAccesoCuenta(ctx);
    if (!acceso.ok) return { ok: false, error: acceso.codigo };

    const cuenta = await contextoCuentaPorEmpresa(ctx.sb, ctx.empresaId);
    if (!cuenta) return { ok: false, error: "CUENTA_NO_ENCONTRADA" };

    const periodo = periodoActual();
    const rango = chileMonthUtcRange(periodo);
    const empresaIds = await empresasActivasDeCuenta(ctx.sb, acceso.cuentaId);

    const [cuota, telegramUso, addonsRes] = await Promise.all([
      estadoCuota(ctx.sb, ctx.empresaId),
      contarComprobantesTelegramUtiles(ctx.sb, empresaIds, rango.desde, rango.hasta),
      ctx.sb
        .from("cuenta_addons")
        .select("tipo, cantidad")
        .eq("cuenta_id", acceso.cuentaId)
        .eq("estado", "activo")
        .or(`periodo.is.null,periodo.eq.${periodo}`),
    ]);
    if (addonsRes.error) return { ok: false, error: "ADDONS_QUERY_FAILED", detalle: addonsRes.error.message };

    const addonRows = (addonsRes.data ?? []).filter((row): row is { tipo: ResumenCupos["extrasActivos"][number]["tipo"]; cantidad: number } =>
      row.tipo === "empresa_adicional" || row.tipo === "persona_adicional" || row.tipo === "boletas_cartola" || row.tipo === "telegram",
    );
    const empresaExtras = sumByTipo(addonRows, "empresa_adicional");
    const personaExtras = sumByTipo(addonRows, "persona_adicional");
    const telegramExtras = sumByTipo(addonRows, "telegram");
    const boletasAddonExtras = sumByTipo(addonRows, "boletas_cartola");
    const telegramTotal = cuenta.telegramComprobantes + telegramExtras;

    const boletasBase = cuota.trial ? cuota.trial.boletasMax : cuota.cuota;
    const boletasUso = cuota.trial ? cuota.trial.boletasUsadas : cuota.uso;
    const boletasExtras = cuota.trial ? 0 : cuota.refills + boletasAddonExtras;
    const boletasTotal = boletasBase + boletasExtras;

    return {
      ok: true,
      resumen: {
        periodo,
        plan: cuenta.plan ?? cuota.plan,
        planActivo: cuenta.planActivo,
        boletasCartolas: {
          uso: boletasUso,
          base: boletasBase,
          extras: boletasExtras,
          total: boletasTotal,
          disponible: Math.max(0, cuota.disponible + (cuota.trial ? 0 : boletasAddonExtras)),
        },
        telegram: {
          habilitado: telegramTotal > 0,
          uso: telegramUso,
          base: cuenta.telegramComprobantes,
          extras: telegramExtras,
          total: telegramTotal,
          disponible: Math.max(0, telegramTotal - telegramUso),
        },
        empresas: {
          uso: cuenta.empresasActivas,
          incluidas: cuenta.empresasIncluidas,
          extras: empresaExtras,
          total: cuenta.empresasIncluidas + empresaExtras,
        },
        personas: {
          uso: cuenta.personasActivas,
          incluidas: cuenta.personasIncluidas,
          extras: personaExtras,
          total: cuenta.personasIncluidas + personaExtras,
        },
        extrasActivos: addonRows.map((row) => ({ tipo: row.tipo, cantidad: row.cantidad })),
      },
    };
  } catch (error) {
    return { ok: false, error: "RESUMEN_CUPOS_FAILED", detalle: error instanceof Error ? error.message : undefined };
  }
}
