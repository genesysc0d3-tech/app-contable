"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getDevSupportMode } from "@/lib/dev/support-mode";
import { empresasActivasDeCuenta, contextoCuentaPorEmpresa, validarAccesoCuenta } from "@/lib/entitlements";
import { chileMonthUtcRange, clpConIva, estadoCuota, periodoActual } from "@/lib/pagos/metering";
import { recordCuentaAudit } from "@/lib/audit/account";
import { formatRut, validarRut } from "@/lib/rut";
import { createClient } from "@/lib/supabase/server";
import { getUfClp, getUmbralIdentificacionClp } from "@/lib/sii/uf";
import { mpConfigurado } from "@/lib/pagos/mercadopago";
import { fetchMesaDateDependent, type MesaParams, type MesaDateDependent } from "./mesa-data";

type EmpresaSelectorRow = {
  id: string;
  nombre: string;
  rut: string | null;
  activaActual: boolean;
  esPrincipal: boolean;
  logoUrl: string;
};

type EmpresasSelectorResult =
  | { ok: true; empresas: EmpresaSelectorRow[]; multiempresa: boolean; puedeAgregar: boolean }
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

/**
 * Umbral de identificación del receptor (135 UF) en CLP con la UF VIVA (auditoría
 * #10). El editor inline lo consulta para que su gate de "receptor obligatorio"
 * coincida con la validación del server al emitir (lo que ves = lo que se emite),
 * en vez de usar la constante referencial congelada.
 */
export async function obtenerUmbralReceptorClp(): Promise<number> {
  return getUmbralIdentificacionClp();
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
    if (ids.length === 0) return { ok: true, empresas: [], multiempresa: false, puedeAgregar: false };

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

    const multiempresa = await planPermiteMultiempresa(ctx.sb, acceso.plan);

    // "+ Agregar empresa": titular de la cuenta pagadora + plan multiempresa +
    // cupo libre. El server re-valida todo en crearEmpresaAdicional — esto es
    // solo visibilidad del botón.
    let puedeAgregar = false;
    if (multiempresa && !ctx.supportMode) {
      const [{ data: cuentaRow }, { data: membresiaTitular }, cuenta] = await Promise.all([
        ctx.sb.from("cuentas").select("owner_usuario_id").eq("id", acceso.cuentaId).maybeSingle(),
        ctx.sb.from("cuenta_usuarios").select("es_titular").eq("cuenta_id", acceso.cuentaId).eq("usuario_id", ctx.userId).maybeSingle(),
        contextoCuentaPorEmpresa(ctx.sb, ctx.empresaId),
      ]);
      const esTitular = cuentaRow?.owner_usuario_id === ctx.userId || membresiaTitular?.es_titular === true;
      puedeAgregar = esTitular && !!cuenta && cuenta.empresasActivas < cuenta.empresasIncluidas;
    }

    return {
      ok: true,
      empresas: items,
      multiempresa,
      puedeAgregar,
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

type CrearEmpresaAdicionalResult =
  | { ok: true; empresa_id: string }
  | { ok: false; error: string; detalle?: string };

/**
 * Alta de una empresa ADICIONAL bajo la misma cuenta (plan Business/multiempresa).
 * Solo el titular de la cuenta pagadora; gate por cupo (`empresas_incluidas`).
 * El RUT queda escrito en piedra al primer documento emitido (trigger
 * empresas_rut_inmutable) — por eso el caller pasa por el verificador de la
 * nómina SII antes de llamar acá.
 */
export async function crearEmpresaAdicional(input: {
  rut: string;
  razon_social: string;
  giro: string;
}): Promise<CrearEmpresaAdicionalResult> {
  try {
    const ctx = await getUsuarioActivo();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    if (ctx.supportMode) return { ok: false, error: "DEV_SUPPORT_READ_ONLY" };

    const acceso = await resolverAccesoCuenta(ctx);
    if (!acceso.ok) return { ok: false, error: acceso.codigo };
    if (!acceso.planActivo) return { ok: false, error: "PLAN_INACTIVO" };

    if (!(await planPermiteMultiempresa(ctx.sb, acceso.plan))) {
      return { ok: false, error: "PLAN_SIN_MULTIEMPRESA", detalle: "Tu plan incluye una empresa. El plan Business permite hasta 3." };
    }

    // Solo la cuenta pagadora agrega RUTs (mismo criterio que persona adicional).
    const [{ data: cuentaRow }, { data: membresia }] = await Promise.all([
      ctx.sb.from("cuentas").select("owner_usuario_id").eq("id", acceso.cuentaId).maybeSingle(),
      ctx.sb.from("cuenta_usuarios").select("es_titular").eq("cuenta_id", acceso.cuentaId).eq("usuario_id", ctx.userId).maybeSingle(),
    ]);
    if (cuentaRow?.owner_usuario_id !== ctx.userId && membresia?.es_titular !== true) {
      return { ok: false, error: "SOLO_TITULAR_CUENTA", detalle: "Solo la cuenta pagadora puede agregar empresas" };
    }

    const cuenta = await contextoCuentaPorEmpresa(ctx.sb, ctx.empresaId);
    if (!cuenta) return { ok: false, error: "CUENTA_NO_CONFIGURADA" };
    if (cuenta.empresasActivas >= cuenta.empresasIncluidas) {
      return {
        ok: false,
        error: "CUPO_EMPRESAS",
        detalle: `Tu plan incluye ${cuenta.empresasIncluidas} empresa${cuenta.empresasIncluidas !== 1 ? "s" : ""}. Para agregar otra, escríbenos a soporte.`,
      };
    }

    const rutLimpio = (input.rut ?? "").trim();
    const razon = (input.razon_social ?? "").trim().slice(0, 200);
    const giro = (input.giro ?? "").trim().slice(0, 200);
    if (!validarRut(rutLimpio)) return { ok: false, error: "RUT_INVALIDO", detalle: "El RUT no es válido — revisa el dígito verificador" };
    if (!razon) return { ok: false, error: "RAZON_SOCIAL_REQUERIDA" };
    if (!giro) return { ok: false, error: "GIRO_REQUERIDO" };

    const { data: empresa, error: empresaError } = await ctx.sb
      .from("empresas")
      .insert({ rut: formatRut(rutLimpio), razon_social: razon, giro })
      .select("id")
      .single();
    if (empresaError) {
      // 23505 = índice único empresas_rut_unico: ese RUT ya opera en massDTE.
      if (empresaError.code === "23505") {
        return { ok: false, error: "RUT_YA_REGISTRADO", detalle: "Ese RUT ya tiene una cuenta en massDTE. Si es tuyo, escríbenos a soporte." };
      }
      return { ok: false, error: "EMPRESA_INSERT_FAILED", detalle: empresaError.message };
    }

    const { error: linkError } = await ctx.sb
      .from("cuenta_empresas")
      .insert({ cuenta_id: acceso.cuentaId, empresa_id: empresa.id, es_principal: false, activa: true });
    if (linkError) {
      // No dejar una empresa huérfana sin vínculo a la cuenta.
      await ctx.sb.from("empresas").delete().eq("id", empresa.id);
      return { ok: false, error: "CUENTA_EMPRESA_LINK_FAILED", detalle: linkError.message };
    }

    await recordCuentaAudit({
      sb: ctx.sb,
      cuentaId: acceso.cuentaId,
      empresaId: empresa.id,
      usuarioId: ctx.userId,
      accion: "empresa_adicional_creada",
      recursoTipo: "empresa",
      recursoId: empresa.id,
      resumen: `Empresa adicional creada (${formatRut(rutLimpio)})`,
      metadata: { rut: formatRut(rutLimpio), razon_social: razon },
    });

    revalidatePath("/massdte");
    revalidatePath("/escritorio/v5");
    return { ok: true, empresa_id: empresa.id };
  } catch (error) {
    return { ok: false, error: "EMPRESA_ADICIONAL_FAILED", detalle: error instanceof Error ? error.message : undefined };
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

export type PagoHistorial = {
  id: string;
  fecha: string;
  tipo: string;
  estado: string;
  montoClp: number | null;
  proveedor: string;
};

export type FacturacionData = {
  uf: number;
  plan: { codigo: string; nombre: string; ufMensual: number; clpMensualConIva: number } | null;
  suscripcion: { estado: string; proximoCobro: string | null; ultimoCobroClp: number | null } | null;
  trial: { activo: boolean; inicio: boolean; diasRestantes: number; boletasUsadas: number; boletasMax: number } | null;
  mpConfigurado: boolean;
  pagos: PagoHistorial[];
};

type FacturacionResult =
  | { ok: true; data: FacturacionData }
  | { ok: false; error: string; detalle?: string };

/**
 * Datos de la sección "Facturación y uso" del popup de Empresa: plan vigente,
 * estado de la suscripción, período de prueba e historial de pagos de la cuenta.
 * Solo lectura — el cobro/checkout vive en /planes. Reutiliza estadoCuota.
 */
export async function obtenerFacturacion(): Promise<FacturacionResult> {
  try {
    const ctx = await getUsuarioActivo();
    if (!ctx.ok) return ctx;

    const acceso = await resolverAccesoCuenta(ctx);
    if (!acceso.ok) return { ok: false, error: acceso.codigo };

    const [uf, cuota] = await Promise.all([
      getUfClp(),
      estadoCuota(ctx.sb, ctx.empresaId),
    ]);

    const cuentaCtx = await contextoCuentaPorEmpresa(ctx.sb, ctx.empresaId);
    const planCodigo = cuentaCtx?.plan ?? cuota.plan;
    let plan: FacturacionData["plan"] = null;
    if (planCodigo) {
      const { data: planRow } = await ctx.sb
        .from("planes_config")
        .select("codigo, nombre, uf_mensual")
        .eq("codigo", planCodigo)
        .maybeSingle();
      if (planRow) {
        plan = {
          codigo: planRow.codigo,
          nombre: planRow.nombre,
          ufMensual: planRow.uf_mensual,
          clpMensualConIva: clpConIva(planRow.uf_mensual, uf),
        };
      }
    }

    const { data: subRow } = await ctx.sb
      .from("suscripciones")
      .select("estado, periodo_hasta, clp_ultimo_cobro")
      .eq("cuenta_id", acceso.cuentaId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: pagosRows } = await ctx.sb
      .from("pagos")
      .select("id, created_at, tipo, estado, monto_clp, proveedor")
      .eq("cuenta_id", acceso.cuentaId)
      .order("created_at", { ascending: false })
      .limit(12);

    return {
      ok: true,
      data: {
        uf,
        plan,
        suscripcion: subRow
          ? { estado: subRow.estado, proximoCobro: subRow.periodo_hasta, ultimoCobroClp: subRow.clp_ultimo_cobro }
          : null,
        trial: cuota.trial
          ? {
              activo: cuota.trial.activo,
              inicio: Boolean(cuota.trial.inicio),
              diasRestantes: cuota.trial.diasRestantes,
              boletasUsadas: cuota.trial.boletasUsadas,
              boletasMax: cuota.trial.boletasMax,
            }
          : null,
        mpConfigurado: mpConfigurado(),
        pagos: (pagosRows ?? []).map((p) => ({
          id: p.id,
          fecha: p.created_at,
          tipo: p.tipo,
          estado: p.estado,
          montoClp: p.monto_clp,
          proveedor: p.proveedor,
        })),
      },
    };
  } catch (error) {
    return { ok: false, error: "FACTURACION_FAILED", detalle: error instanceof Error ? error.message : undefined };
  }
}

export type CargarMesaResult =
  | { ok: true; mesa: MesaDateDependent }
  | { ok: false; error: string };

/**
 * Datos date-dependientes de la mesa para un rango (día/semana/mes) — lo que
 * pide el calendario client-side al togglear, SIN navegar ni re-renderizar la
 * página completa. La empresa sale del registro del usuario (no del cliente),
 * así que `params` solo trae date/month/view (no se puede pedir otra empresa).
 */
export async function cargarMesa(params: MesaParams): Promise<CargarMesaResult> {
  try {
    const ctx = await getUsuarioActivo();
    if (!ctx.ok) return { ok: false, error: ctx.error };
    const { data: empresa } = await ctx.sb
      .from("empresas")
      .select("giro, razon_social, tipo_contribuyente")
      .eq("id", ctx.empresaId)
      .maybeSingle();
    if (!empresa) return { ok: false, error: "EMPRESA_NO_ENCONTRADA" };
    const mesa = await fetchMesaDateDependent(ctx.sb, ctx.empresaId, {
      giro: empresa.giro,
      razon_social: empresa.razon_social ?? "",
      tipo_contribuyente: empresa.tipo_contribuyente,
    }, params);
    return { ok: true, mesa };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "CARGAR_MESA_FAILED" };
  }
}
