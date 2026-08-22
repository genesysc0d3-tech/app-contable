import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/database.types";
import { contextoCuentaPorEmpresa } from "@/lib/entitlements";
import { chileMonthUtcRange, estadoCuota, periodoActual, type EstadoCuota } from "@/lib/pagos/metering";
import { getDevOperatorContext } from "@/lib/dev/support-mode";

type Sb = SupabaseClient<Database>;
type Cuenta = Tables<"cuentas">;
type CuentaAddon = Tables<"cuenta_addons">;
type CuentaEmpresa = Tables<"cuenta_empresas">;
type CuentaUsuario = Tables<"cuenta_usuarios">;
type Empresa = Pick<
  Tables<"empresas">,
  | "id"
  | "razon_social"
  | "rut"
  | "plan_activo"
  | "tipo_contribuyente"
  | "boletas_emision_proveedor"
  | "facturas_emision_proveedor"
  | "tiene_certificado_sii"
>;
type Usuario = Pick<Tables<"usuarios">, "id" | "email" | "nombre" | "empresa_id" | "dev_mode" | "vetado">;
type Plan = Pick<
  Tables<"planes_config">,
  | "codigo"
  | "nombre"
  | "cuota_masivas"
  | "empresas_incluidas"
  | "personas_incluidas"
  | "telegram_comprobantes"
  | "equipo"
  | "multiempresa"
  | "uf_mensual"
>;
type Pago = Pick<Tables<"pagos">, "id" | "cuenta_id" | "created_at" | "estado" | "monto_clp" | "proveedor" | "proveedor_ref" | "tipo">;
type Suscripcion = Pick<
  Tables<"suscripciones">,
  "id" | "cuenta_id" | "created_at" | "updated_at" | "estado" | "plan_codigo" | "proveedor" | "proveedor_ref" | "clp_ultimo_cobro" | "periodo_hasta"
>;
type EmisionJob = Pick<
  Tables<"emision_jobs">,
  "job_id" | "cuenta_id" | "empresa_id" | "usuario_id" | "provider" | "origin" | "estado" | "estado_visible" | "status_message" | "created_at" | "heartbeat_at" | "expires_at"
>;
type EmisionLock = Tables<"emision_locks">;
type FolioReserva = Tables<"folio_reservas">;
type CuentaAuditEvent = Pick<
  Tables<"cuenta_audit_events">,
  "id" | "cuenta_id" | "empresa_id" | "usuario_id" | "accion" | "recurso_tipo" | "recurso_id" | "resumen" | "created_at"
>;

export type DevCuentaEmpresa = {
  id: string;
  nombre: string;
  rutMasked: string;
  tipoContribuyente: string;
  planActivo: boolean;
  esPrincipal: boolean;
  proveedorBoletas: string;
  proveedorFacturas: string;
  certificadoLocal: boolean;
};

export type DevCuentaUsuario = {
  id: string;
  nombre: string;
  emailMasked: string;
  esTitular: boolean;
  activo: boolean;
  devMode: boolean;
  vetado: boolean;
};

export type DevCuentaRow = {
  id: string;
  nombre: string;
  planCodigo: string | null;
  planNombre: string;
  planActivo: boolean;
  trialCortesia: boolean;
  suscripcionEstado: string | null;
  ultimoPagoEstado: string | null;
  ultimoPagoMontoClp: number | null;
  empresasActivas: number;
  empresasPermitidas: number;
  personasActivas: number;
  personasPermitidas: number;
  ownerNombre: string;
  ownerEmailMasked: string;
  empresaPrincipalId: string | null;
  empresaPrincipalNombre: string | null;
  updatedAt: string;
  alertas: string[];
};

export type DevCuentaDetalle = {
  cuenta: DevCuentaRow;
  funciones: {
    boletasDesdeCartolas: number;
    telegram: number;
    equipo: boolean;
    multiempresa: boolean;
  };
  uso: {
    periodo: string;
    cuota: EstadoCuota | null;
    boletasMesTotal: number;
    boletasDesdeCartolasMes: number;
    propuestasPendientes: number;
    propuestasListas: number;
  };
  empresas: DevCuentaEmpresa[];
  usuarios: DevCuentaUsuario[];
  addons: Pick<CuentaAddon, "id" | "tipo" | "cantidad" | "estado" | "periodo" | "origen" | "created_at">[];
  suscripciones: Suscripcion[];
  pagos: Pago[];
  emision: {
    lockActivo: (EmisionLock & { usuarioNombre: string; usuarioEmailMasked: string }) | null;
    jobs: (EmisionJob & { empresaNombre: string; usuarioEmailMasked: string })[];
    folios: (FolioReserva & { empresaNombre: string })[];
  };
  auditoria: (CuentaAuditEvent & { empresaNombre: string | null; usuarioEmailMasked: string })[];
  diagnostico: {
    codigo: "ok" | "warning" | "error";
    texto: string;
  }[];
};

export type DevAccountResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: 403 | 404 | 500; error: string; detalle?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function maskEmail(email: string | null | undefined) {
  const clean = (email ?? "").trim().toLowerCase();
  const [user, domain] = clean.split("@");
  if (!user || !domain) return "sin correo";
  const visible = user.length <= 3 ? user[0] ?? "*" : user.slice(0, 3);
  return `${visible}${"*".repeat(Math.max(2, Math.min(6, user.length - visible.length)))}@${domain}`;
}

function maskRut(rut: string | null | undefined) {
  const clean = (rut ?? "").trim();
  if (clean.length <= 5) return clean || "sin RUT";
  return `${clean.slice(0, 2)}.***.***-${clean.slice(-1)}`;
}

function normalizeSearch(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fmtPlan(plan: Plan | undefined, codigo: string | null) {
  return plan?.nombre ?? codigo ?? "Sin plan";
}

function isAddonActive(addon: CuentaAddon, periodo: string) {
  return addon.estado === "activo" && (!addon.periodo || addon.periodo === periodo);
}

function sumAddon(addons: CuentaAddon[], tipo: CuentaAddon["tipo"], periodo: string) {
  return addons
    .filter((addon) => addon.tipo === tipo && isAddonActive(addon, periodo))
    .reduce((sum, addon) => sum + addon.cantidad, 0);
}

function firstByCuenta<T extends { cuenta_id: string | null }>(rows: T[]) {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!row.cuenta_id || map.has(row.cuenta_id)) continue;
    map.set(row.cuenta_id, row);
  }
  return map;
}

function groupByCuenta<T extends { cuenta_id: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = map.get(row.cuenta_id) ?? [];
    bucket.push(row);
    map.set(row.cuenta_id, bucket);
  }
  return map;
}

function activeSubscriptionByCuenta(rows: Suscripcion[]) {
  const map = new Map<string, Suscripcion>();
  for (const row of rows) {
    if (!row.cuenta_id || row.estado !== "activa" || map.has(row.cuenta_id)) continue;
    map.set(row.cuenta_id, row);
  }
  return map;
}

function countByCuenta<T extends { cuenta_id: string; activa?: boolean; activo?: boolean }>(
  rows: T[],
  flag: "activa" | "activo",
) {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row[flag] !== true) continue;
    map.set(row.cuenta_id, (map.get(row.cuenta_id) ?? 0) + 1);
  }
  return map;
}

function principalEmpresaByCuenta(rows: CuentaEmpresa[]) {
  const map = new Map<string, CuentaEmpresa>();
  for (const row of rows) {
    if (!row.activa) continue;
    const current = map.get(row.cuenta_id);
    if (!current || (!current.es_principal && row.es_principal)) map.set(row.cuenta_id, row);
  }
  return map;
}

async function requireDev() {
  const operator = await getDevOperatorContext();
  if (!operator.ok) return { ok: false as const, status: 403 as const, error: operator.error, detalle: operator.detalle };
  return { ok: true as const, sb: operator.sb };
}

function buildCuentaRow(args: {
  cuenta: Cuenta;
  owner?: Usuario;
  plan?: Plan;
  planCodigo: string | null;
  activeSub?: Suscripcion;
  latestSub?: Suscripcion;
  latestPago?: Pago;
  principalEmpresa?: Empresa;
  principalEmpresaId: string | null;
  empresasActivas: number;
  personasActivas: number;
  addons: CuentaAddon[];
  periodo: string;
}): DevCuentaRow {
  const empresasPermitidas = (args.plan?.empresas_incluidas ?? 1) + sumAddon(args.addons, "empresa_adicional", args.periodo);
  const personasPermitidas = (args.plan?.personas_incluidas ?? 1) + sumAddon(args.addons, "persona_adicional", args.periodo);
  const planActivo = args.activeSub?.estado === "activa" || args.cuenta.plan_activo;
  const alertas: string[] = [];

  if (!planActivo) alertas.push("plan inactivo");
  if (!args.activeSub && !args.cuenta.plan_activo) alertas.push("sin suscripción activa");
  if (!args.principalEmpresaId) alertas.push("sin empresa principal");
  if (args.empresasActivas > empresasPermitidas) alertas.push("empresas sobre cupo");
  if (args.personasActivas > personasPermitidas) alertas.push("personas sobre cupo");

  return {
    id: args.cuenta.id,
    nombre: args.cuenta.nombre,
    planCodigo: args.planCodigo,
    planNombre: fmtPlan(args.plan, args.planCodigo),
    planActivo,
    trialCortesia: args.cuenta.trial_cortesia === true,
    suscripcionEstado: args.activeSub?.estado ?? args.latestSub?.estado ?? null,
    ultimoPagoEstado: args.latestPago?.estado ?? null,
    ultimoPagoMontoClp: args.latestPago?.monto_clp ?? null,
    empresasActivas: args.empresasActivas,
    empresasPermitidas,
    personasActivas: args.personasActivas,
    personasPermitidas,
    ownerNombre: args.owner?.nombre || "Sin titular",
    ownerEmailMasked: maskEmail(args.owner?.email),
    empresaPrincipalId: args.principalEmpresaId,
    empresaPrincipalNombre: args.principalEmpresa?.razon_social ?? null,
    updatedAt: args.cuenta.updated_at,
    alertas,
  };
}

async function loadCommon(sb: Sb, cuentaIds: string[], ownerIds: string[]) {
  const [planesRes, ownersRes, cuentaEmpresasRes, cuentaUsuariosRes, suscripcionesRes, pagosRes, addonsRes] = await Promise.all([
    sb
      .from("planes_config")
      .select("codigo, nombre, cuota_masivas, empresas_incluidas, personas_incluidas, telegram_comprobantes, equipo, multiempresa, uf_mensual"),
    ownerIds.length
      ? sb.from("usuarios").select("id, email, nombre, empresa_id, dev_mode, vetado").in("id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    cuentaIds.length
      ? sb.from("cuenta_empresas").select("cuenta_id, empresa_id, activa, es_principal, created_at").in("cuenta_id", cuentaIds)
      : Promise.resolve({ data: [], error: null }),
    cuentaIds.length
      ? sb.from("cuenta_usuarios").select("cuenta_id, usuario_id, activo, es_titular, created_at").in("cuenta_id", cuentaIds)
      : Promise.resolve({ data: [], error: null }),
    cuentaIds.length
      ? sb
          .from("suscripciones")
          .select("id, cuenta_id, created_at, updated_at, estado, plan_codigo, proveedor, proveedor_ref, clp_ultimo_cobro, periodo_hasta")
          .in("cuenta_id", cuentaIds)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    cuentaIds.length
      ? sb
          .from("pagos")
          .select("id, cuenta_id, created_at, estado, monto_clp, proveedor, proveedor_ref, tipo")
          .in("cuenta_id", cuentaIds)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    cuentaIds.length
      ? sb
          .from("cuenta_addons")
          .select("id, cuenta_id, tipo, cantidad, estado, periodo, origen, proveedor_ref, created_at")
          .in("cuenta_id", cuentaIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const errors = [planesRes.error, ownersRes.error, cuentaEmpresasRes.error, cuentaUsuariosRes.error, suscripcionesRes.error, pagosRes.error, addonsRes.error]
    .filter(Boolean)
    .map((error) => error?.message)
    .join(" · ");
  if (errors) throw new Error(errors);

  const cuentaEmpresas = (cuentaEmpresasRes.data ?? []) as CuentaEmpresa[];
  const empresaIds = [...new Set(cuentaEmpresas.map((row) => row.empresa_id))];
  const empresasRes = empresaIds.length
    ? await sb
        .from("empresas")
        .select("id, razon_social, rut, plan_activo, tipo_contribuyente, boletas_emision_proveedor, facturas_emision_proveedor, tiene_certificado_sii")
        .in("id", empresaIds)
    : { data: [], error: null };
  if (empresasRes.error) throw new Error(empresasRes.error.message);

  return {
    planes: new Map(((planesRes.data ?? []) as Plan[]).map((plan) => [plan.codigo, plan] as const)),
    owners: new Map(((ownersRes.data ?? []) as Usuario[]).map((user) => [user.id, user] as const)),
    empresas: new Map(((empresasRes.data ?? []) as Empresa[]).map((empresa) => [empresa.id, empresa] as const)),
    cuentaEmpresas,
    cuentaUsuarios: (cuentaUsuariosRes.data ?? []) as CuentaUsuario[],
    suscripciones: (suscripcionesRes.data ?? []) as Suscripcion[],
    pagos: (pagosRes.data ?? []) as Pago[],
    addons: (addonsRes.data ?? []) as CuentaAddon[],
  };
}

export async function listarDevCuentas(options: { query?: string | null } = {}): Promise<DevAccountResult<DevCuentaRow[]>> {
  const gate = await requireDev();
  if (!gate.ok) return gate;

  try {
    const { data: cuentas, error } = await gate.sb
      .from("cuentas")
      .select("id, nombre, owner_usuario_id, plan_codigo, plan_activo, trial_cortesia, empresa_operativa_elegida_at, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) return { ok: false, status: 500, error: "CUENTAS_QUERY_FAILED", detalle: error.message };

    const rows = (cuentas ?? []) as Cuenta[];
    const cuentaIds = rows.map((cuenta) => cuenta.id);
    const ownerIds = [...new Set(rows.map((cuenta) => cuenta.owner_usuario_id).filter((id): id is string => !!id))];
    const periodo = periodoActual();
    const common = await loadCommon(gate.sb, cuentaIds, ownerIds);

    const latestSub = firstByCuenta(common.suscripciones);
    const activeSub = activeSubscriptionByCuenta(common.suscripciones);
    const latestPago = firstByCuenta(common.pagos);
    const empresasCount = countByCuenta(common.cuentaEmpresas, "activa");
    const usuariosCount = countByCuenta(common.cuentaUsuarios, "activo");
    const principalByCuenta = principalEmpresaByCuenta(common.cuentaEmpresas);
    const addonsByCuenta = groupByCuenta(common.addons);

    const query = normalizeSearch(options.query).slice(0, 80);
    const mapped = rows.map((cuenta) => {
        const sub = activeSub.get(cuenta.id);
        const latest = latestSub.get(cuenta.id);
        const planCodigo = sub?.plan_codigo ?? cuenta.plan_codigo ?? latest?.plan_codigo ?? null;
        const principal = principalByCuenta.get(cuenta.id);
        const principalEmpresa = principal ? common.empresas.get(principal.empresa_id) : undefined;
        const owner = cuenta.owner_usuario_id ? common.owners.get(cuenta.owner_usuario_id) : undefined;
        const row = buildCuentaRow({
          cuenta,
          owner,
          plan: planCodigo ? common.planes.get(planCodigo) : undefined,
          planCodigo,
          activeSub: sub,
          latestSub: latest,
          latestPago: latestPago.get(cuenta.id),
          principalEmpresa,
          principalEmpresaId: principal?.empresa_id ?? null,
          empresasActivas: empresasCount.get(cuenta.id) ?? 0,
          personasActivas: usuariosCount.get(cuenta.id) ?? 0,
          addons: addonsByCuenta.get(cuenta.id) ?? [],
          periodo,
        });
        const searchIndex = normalizeSearch([
          cuenta.nombre,
          planCodigo,
          owner?.nombre,
          owner?.email,
          principalEmpresa?.razon_social,
          principalEmpresa?.rut,
        ].filter(Boolean).join(" "));
        return { row, searchIndex };
      });

    return {
      ok: true,
      data: (query ? mapped.filter((item) => item.searchIndex.includes(query)) : mapped).map((item) => item.row),
    };
  } catch (error) {
    return { ok: false, status: 500, error: "DEV_CUENTAS_FAILED", detalle: error instanceof Error ? error.message : String(error) };
  }
}

export async function obtenerDevCuentaDetalle(cuentaId: string): Promise<DevAccountResult<DevCuentaDetalle>> {
  const gate = await requireDev();
  if (!gate.ok) return gate;
  if (!UUID_RE.test(cuentaId)) return { ok: false, status: 404, error: "CUENTA_INVALIDA" };

  try {
    const { data: cuenta, error } = await gate.sb
      .from("cuentas")
      .select("id, nombre, owner_usuario_id, plan_codigo, plan_activo, trial_cortesia, empresa_operativa_elegida_at, created_at, updated_at")
      .eq("id", cuentaId)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: "CUENTA_QUERY_FAILED", detalle: error.message };
    if (!cuenta) return { ok: false, status: 404, error: "CUENTA_NOT_FOUND" };

    const common = await loadCommon(gate.sb, [cuentaId], cuenta.owner_usuario_id ? [cuenta.owner_usuario_id] : []);
    const periodo = periodoActual();
    const rango = chileMonthUtcRange(periodo);
    const latestSub = firstByCuenta(common.suscripciones).get(cuentaId);
    const activeSub = activeSubscriptionByCuenta(common.suscripciones).get(cuentaId);
    const latestPago = firstByCuenta(common.pagos).get(cuentaId);
    const empresasCount = countByCuenta(common.cuentaEmpresas, "activa").get(cuentaId) ?? 0;
    const usuariosCount = countByCuenta(common.cuentaUsuarios, "activo").get(cuentaId) ?? 0;
    const principal = principalEmpresaByCuenta(common.cuentaEmpresas).get(cuentaId);
    const empresaIds = common.cuentaEmpresas.filter((row) => row.activa).map((row) => row.empresa_id);
    const principalEmpresaId = principal?.empresa_id ?? empresaIds[0] ?? null;
    const planCodigo = activeSub?.plan_codigo ?? cuenta.plan_codigo ?? latestSub?.plan_codigo ?? null;
    const plan = planCodigo ? common.planes.get(planCodigo) : undefined;
    const addons = common.addons.filter((addon) => addon.cuenta_id === cuentaId);
    const row = buildCuentaRow({
      cuenta,
      owner: cuenta.owner_usuario_id ? common.owners.get(cuenta.owner_usuario_id) : undefined,
      plan,
      planCodigo,
      activeSub,
      latestSub,
      latestPago,
      principalEmpresa: principalEmpresaId ? common.empresas.get(principalEmpresaId) : undefined,
      principalEmpresaId,
      empresasActivas: empresasCount,
      personasActivas: usuariosCount,
      addons,
      periodo,
    });

    const usuarioIds = common.cuentaUsuarios.map((membership) => membership.usuario_id);
    const usuariosRes = usuarioIds.length
      ? await gate.sb.from("usuarios").select("id, email, nombre, empresa_id, dev_mode, vetado").in("id", usuarioIds)
      : { data: [], error: null };
    if (usuariosRes.error) throw new Error(usuariosRes.error.message);
    const usuarios = new Map(((usuariosRes.data ?? []) as Usuario[]).map((usuario) => [usuario.id, usuario] as const));

    const [boletasTotalRes, boletasCartolaRes, propuestasPendientesRes, propuestasListasRes, locksRes, jobsRes, foliosRes, auditRes] = await Promise.all([
      empresaIds.length
        ? gate.sb
            .from("boletas_emitidas")
            .select("id", { count: "exact", head: true })
            .in("empresa_id", empresaIds)
            .neq("estado", "anulada")
            .gte("created_at", rango.desde)
            .lt("created_at", rango.hasta)
        : Promise.resolve({ count: 0, error: null }),
      empresaIds.length
        ? gate.sb
            .from("boletas_emitidas")
            .select("id", { count: "exact", head: true })
            .in("empresa_id", empresaIds)
            .not("propuesta_id", "is", null)
            .neq("estado", "anulada")
            .gte("created_at", rango.desde)
            .lt("created_at", rango.hasta)
        : Promise.resolve({ count: 0, error: null }),
      empresaIds.length
        ? gate.sb.from("propuestas_ia").select("id", { count: "exact", head: true }).in("empresa_id", empresaIds).eq("estado", "pendiente")
        : Promise.resolve({ count: 0, error: null }),
      empresaIds.length
        ? gate.sb.from("propuestas_ia").select("id", { count: "exact", head: true }).in("empresa_id", empresaIds).in("estado", ["aprobado", "editado"])
        : Promise.resolve({ count: 0, error: null }),
      gate.sb.from("emision_locks").select("*").eq("cuenta_id", cuentaId).maybeSingle(),
      gate.sb
        .from("emision_jobs")
        .select("job_id, cuenta_id, empresa_id, usuario_id, provider, origin, estado, estado_visible, status_message, created_at, heartbeat_at, expires_at")
        .eq("cuenta_id", cuentaId)
        .order("created_at", { ascending: false })
        .limit(12),
      empresaIds.length
        ? gate.sb
            .from("folio_reservas")
            .select("*")
            .in("empresa_id", empresaIds)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
      gate.sb
        .from("cuenta_audit_events")
        .select("id, cuenta_id, empresa_id, usuario_id, accion, recurso_tipo, recurso_id, resumen, created_at")
        .eq("cuenta_id", cuentaId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const countErrors = [boletasTotalRes.error, boletasCartolaRes.error, propuestasPendientesRes.error, propuestasListasRes.error, locksRes.error, jobsRes.error, foliosRes.error, auditRes.error]
      .filter(Boolean)
      .map((err) => err?.message)
      .join(" · ");
    if (countErrors) throw new Error(countErrors);

    const cuota = principalEmpresaId ? await estadoCuota(gate.sb, principalEmpresaId).catch(() => null) : null;
    const contexto = principalEmpresaId ? await contextoCuentaPorEmpresa(gate.sb, principalEmpresaId).catch(() => null) : null;
    const lock = locksRes.data as EmisionLock | null;
    const lockUser = lock ? usuarios.get(lock.usuario_id) : undefined;

    const diagnostico: DevCuentaDetalle["diagnostico"] = [
      row.planActivo
        ? { codigo: "ok", texto: "Plan liberado para la cuenta" }
        : { codigo: "error", texto: "Plan no esta liberado" },
      activeSub
        ? { codigo: "ok", texto: `Suscripcion activa en ${activeSub.proveedor}` }
        : { codigo: "warning", texto: latestSub ? `Ultima suscripcion: ${latestSub.estado}` : "Sin suscripcion asociada" },
      latestPago
        ? { codigo: latestPago.estado === "approved" || latestPago.estado === "aprobado" ? "ok" : "warning", texto: `Ultimo pago: ${latestPago.estado}` }
        : { codigo: "warning", texto: "Sin pagos asociados a la cuenta" },
      empresasCount <= row.empresasPermitidas
        ? { codigo: "ok", texto: "Empresas dentro del cupo" }
        : { codigo: "error", texto: "Hay mas empresas activas que cupos disponibles" },
      usuariosCount <= row.personasPermitidas
        ? { codigo: "ok", texto: "Personas dentro del cupo" }
        : { codigo: "error", texto: "Hay mas personas activas que cupos disponibles" },
      lock
        ? { codigo: "warning", texto: `Emision real en curso: ${lock.estado_visible}` }
        : { codigo: "ok", texto: "Sin candado de emision activo" },
    ];

    return {
      ok: true,
      data: {
        cuenta: row,
        funciones: {
          boletasDesdeCartolas: plan?.cuota_masivas ?? cuota?.cuota ?? 0,
          telegram: plan?.telegram_comprobantes ?? contexto?.telegramComprobantes ?? 0,
          equipo: plan?.equipo ?? contexto?.equipo ?? false,
          multiempresa: plan?.multiempresa ?? contexto?.multiempresa ?? false,
        },
        uso: {
          periodo,
          cuota,
          boletasMesTotal: boletasTotalRes.count ?? 0,
          boletasDesdeCartolasMes: boletasCartolaRes.count ?? 0,
          propuestasPendientes: propuestasPendientesRes.count ?? 0,
          propuestasListas: propuestasListasRes.count ?? 0,
        },
        empresas: common.cuentaEmpresas
          .filter((membership) => membership.activa)
          .map((membership) => {
            const empresa = common.empresas.get(membership.empresa_id);
            return {
              id: membership.empresa_id,
              nombre: empresa?.razon_social ?? "(empresa no encontrada)",
              rutMasked: maskRut(empresa?.rut),
              tipoContribuyente: empresa?.tipo_contribuyente ?? "sin tipo",
              planActivo: empresa?.plan_activo ?? false,
              esPrincipal: membership.es_principal,
              proveedorBoletas: empresa?.boletas_emision_proveedor ?? "sin proveedor",
              proveedorFacturas: empresa?.facturas_emision_proveedor ?? "sin proveedor",
              certificadoLocal: empresa?.tiene_certificado_sii ?? false,
            };
          }),
        usuarios: common.cuentaUsuarios.map((membership) => {
          const usuario = usuarios.get(membership.usuario_id);
          return {
            id: membership.usuario_id,
            nombre: usuario?.nombre || "Sin nombre",
            emailMasked: maskEmail(usuario?.email),
            esTitular: membership.es_titular,
            activo: membership.activo,
            devMode: usuario?.dev_mode ?? false,
            vetado: usuario?.vetado ?? false,
          };
        }),
        addons: addons.map(({ id, tipo, cantidad, estado, periodo: addonPeriodo, origen, created_at }) => ({
          id,
          tipo,
          cantidad,
          estado,
          periodo: addonPeriodo,
          origen,
          created_at,
        })),
        suscripciones: common.suscripciones,
        pagos: common.pagos,
        emision: {
          lockActivo: lock
            ? {
                ...lock,
                usuarioNombre: lockUser?.nombre || "Persona del equipo",
                usuarioEmailMasked: maskEmail(lockUser?.email),
              }
            : null,
          jobs: ((jobsRes.data ?? []) as EmisionJob[]).map((job) => ({
            ...job,
            empresaNombre: common.empresas.get(job.empresa_id)?.razon_social ?? "Empresa no encontrada",
            usuarioEmailMasked: maskEmail(usuarios.get(job.usuario_id)?.email),
          })),
          folios: ((foliosRes.data ?? []) as FolioReserva[]).map((folio) => ({
            ...folio,
            empresaNombre: common.empresas.get(folio.empresa_id)?.razon_social ?? "Empresa no encontrada",
          })),
        },
        auditoria: ((auditRes.data ?? []) as CuentaAuditEvent[]).map((event) => ({
          ...event,
          empresaNombre: event.empresa_id ? common.empresas.get(event.empresa_id)?.razon_social ?? "Empresa no encontrada" : null,
          usuarioEmailMasked: maskEmail(event.usuario_id ? usuarios.get(event.usuario_id)?.email : null),
        })),
        diagnostico,
      },
    };
  } catch (error) {
    return { ok: false, status: 500, error: "DEV_CUENTA_DETALLE_FAILED", detalle: error instanceof Error ? error.message : String(error) };
  }
}
