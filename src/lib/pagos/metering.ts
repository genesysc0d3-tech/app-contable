/**
 * Metering de boletas masivas — el corazón medible del plan.
 *
 * REGLA DE CONTEO (la única que importa para cobrar):
 * Una boleta cuenta contra la cuota MASIVA cuando nace del pipeline de
 * cartolas, es decir `boletas_emitidas.propuesta_id IS NOT NULL`. Las
 * boletas únicas/directas (propuesta_id NULL) son ilimitadas y no
 * descuentan cupo. El uso del período son las masivas con `created_at`
 * dentro del mes calendario chileno vigente y `estado != 'anulada'`.
 *
 * Sin suscripción activa la empresa corre en modo trial: los parámetros
 * (días y boletas) viven en planes_config (fila 'pro') para poder
 * ajustarlos sin deploy; el reloj parte con la primera emisión masiva
 * (empresas.trial_inicio).
 *
 * NOTA imports: relativos (no alias @/) para que vitest resuelva el módulo
 * sin config extra, igual que los tests de src/lib/sii.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { chileDateString } from "../chile-date";
import { contextoCuentaPorEmpresa, empresasActivasDeCuenta, trialGlobalHabilitado } from "../entitlements";

type Sb = SupabaseClient<Database>;

const DIA_MS = 24 * 60 * 60 * 1000;
const IVA = 1.19;

/** Período mensual vigente en zona Chile, formato 'YYYY-MM'. */
export function periodoActual(ahora: Date = new Date()): string {
  return chileDateString(ahora).slice(0, 7);
}

/**
 * Período (YYYY-MM, calendario Chile) al que se ACREDITA un pago, derivado de la
 * fecha real de aprobación de MP — NO del checkout (auditoría #22): un refill cuyo
 * pago aprueba tras el cambio de mes debe caer en el mes en que se aprobó, que es
 * justo el mes que `estadoCuota` cuenta. Cae a date_created y luego a "ahora".
 */
export function periodoDePago(recurso: Record<string, unknown>): string {
  const aprobado = recurso.date_approved ?? recurso.date_created;
  if (typeof aprobado === "string") {
    const d = new Date(aprobado);
    if (!Number.isNaN(d.getTime())) return periodoActual(d);
  }
  return periodoActual();
}

/** Monto CLP total (con IVA) para un precio en UF al valor UF del día. */
export function clpConIva(ufMensual: number, ufClp: number): number {
  return Math.round(ufMensual * ufClp * IVA);
}

/** Suma días a una fecha 'YYYY-MM-DD' (aritmética de calendario, sin zonas). */
export function addDaysStr(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Suma un mes calendario con clamp de día (31 ene → 28/29 feb). */
export function addOneMonth(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const ty = m === 12 ? y + 1 : y;
  const tm = m === 12 ? 1 : m + 1;
  const ultimoDia = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, ultimoDia)).padStart(2, "0")}`;
}

/**
 * Ventana de trial como función pura (fechas inyectadas, testeable).
 * inicio null = el trial aún no parte (la primera emisión masiva lo activa),
 * así que se considera vigente con todos los días por delante.
 */
export function trialVigente(
  inicio: string | null,
  ahora: Date,
  dias: number,
  usadas: number,
  max: number,
): { activo: boolean; diasRestantes: number } {
  if (!inicio) return { activo: true, diasRestantes: dias };
  const inicioMs = new Date(inicio).getTime();
  if (!Number.isFinite(inicioMs)) return { activo: false, diasRestantes: 0 };
  const restanteMs = inicioMs + dias * DIA_MS - ahora.getTime();
  const diasRestantes = Math.max(0, Math.ceil(restanteMs / DIA_MS));
  return { activo: restanteMs > 0 && usadas < max, diasRestantes };
}

/**
 * Rango UTC [desde, hasta) que cubre exactamente el mes calendario chileno.
 * Chile oscila entre UTC-3 (verano) y UTC-4 (invierno): la medianoche del
 * día 1 cae a las 03:00 o 04:00 UTC. Probamos ambos candidatos y nos
 * quedamos con el que efectivamente es el día 1 a las 00 hrs en Santiago.
 */
export function chileMonthUtcRange(periodo: string): { desde: string; hasta: string } {
  const [y, m] = periodo.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { desde: chileMidnightUtcIso(y, m), hasta: chileMidnightUtcIso(ny, nm) };
}

function chileMidnightUtcIso(year: number, month: number): string {
  const dia1 = `${year}-${String(month).padStart(2, "0")}-01`;
  for (const hora of [3, 4]) {
    const candidato = new Date(Date.UTC(year, month - 1, 1, hora));
    if (chileDateString(candidato) === dia1 && horaChile(candidato) === 0) {
      return candidato.toISOString();
    }
  }
  // Cambio de hora justo en el borde del mes (no ocurre en la práctica).
  return new Date(Date.UTC(year, month - 1, 1, 3)).toISOString();
}

function horaChile(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Santiago",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
}

/** Boletas desde cartolas emitidas desde `desdeIso` (y antes de `hastaIso` si viene). */
async function contarMasivas(sb: Sb, empresaIds: string[], desdeIso: string, hastaIso?: string): Promise<number> {
  if (empresaIds.length === 0) return 0;
  let q = sb
    .from("boletas_emitidas")
    .select("id", { count: "exact", head: true })
    .in("empresa_id", empresaIds)
    .not("propuesta_id", "is", null)
    .neq("estado", "anulada")
    .gte("created_at", desdeIso);
  if (hastaIso) q = q.lt("created_at", hastaIso);
  const { count, error } = await q;
  if (error) throw new Error(`No se pudo contar boletas masivas: ${error.message}`);
  return count ?? 0;
}

export interface EstadoCuota {
  plan: string | null;
  cuota: number;
  refills: number;
  uso: number;
  disponible: number;
  trial: {
    activo: boolean;
    inicio: string | null;
    diasRestantes: number;
    boletasUsadas: number;
    boletasMax: number;
  } | null;
  suscripcionActiva: boolean;
  /** Estado de la última suscripción (distingue morosa/pausada de "nunca contrató"). */
  suscripcionEstado: string | null;
}

export async function estadoCuota(sb: Sb, empresaId: string, ahora: Date = new Date()): Promise<EstadoCuota> {
  const periodo = periodoActual(ahora);
  const rango = chileMonthUtcRange(periodo);
  const cuenta = await contextoCuentaPorEmpresa(sb, empresaId);
  const empresaIds = cuenta ? await empresasActivasDeCuenta(sb, cuenta.cuentaId) : [empresaId];

  const [suscripcionRes, usoMes] = await Promise.all([
    cuenta
      ? sb
          .from("suscripciones")
          .select("plan_codigo, estado")
          .eq("cuenta_id", cuenta.cuentaId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : sb
          .from("suscripciones")
          .select("plan_codigo, estado")
          .eq("empresa_id", empresaId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
    contarMasivas(sb, empresaIds, rango.desde, rango.hasta),
  ]);

  const suscripcion = suscripcionRes.data ?? null;
  const planActivoManual = cuenta?.planActivo && cuenta.plan ? cuenta.plan : null;
  const planActivo = suscripcion?.estado === "activa" ? suscripcion.plan_codigo : planActivoManual;

  if (planActivo) {
    const [planRes, refillsCuentaRes, refillsLegacyRes] = await Promise.all([
      sb.from("planes_config").select("cuota_masivas").eq("codigo", planActivo).maybeSingle(),
      cuenta
        ? sb.from("refills").select("boletas").eq("cuenta_id", cuenta.cuentaId).eq("periodo", periodo)
        : sb.from("refills").select("boletas").eq("empresa_id", empresaId).eq("periodo", periodo),
      cuenta
        ? sb.from("refills").select("boletas").is("cuenta_id", null).in("empresa_id", empresaIds).eq("periodo", periodo)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const cuota = planRes.data?.cuota_masivas ?? 0;
    const refills = [...(refillsCuentaRes.data ?? []), ...(refillsLegacyRes.data ?? [])]
      .reduce((s, r) => s + (r.boletas ?? 0), 0);
    return {
      plan: planActivo,
      cuota,
      refills,
      uso: usoMes,
      disponible: Math.max(0, cuota + refills - usoMes),
      trial: null,
      suscripcionActiva: true,
      suscripcionEstado: suscripcion?.estado ?? "activa_manual",
    };
  }

  // Sin suscripción activa → modo trial, SOLO si está disponible (auditoría #4):
  // global ON (config_global) o cortesía puntual de la cuenta. Si no, trial=null →
  // decidirGate devuelve SIN_PLAN (comportamiento previo: no hay trial).
  const trialDisponible = (cuenta?.trialCortesia === true) || (await trialGlobalHabilitado(sb));
  if (!trialDisponible) {
    return {
      plan: null,
      cuota: 0,
      refills: 0,
      uso: usoMes,
      disponible: 0,
      trial: null,
      suscripcionActiva: false,
      suscripcionEstado: suscripcion?.estado ?? null,
    };
  }

  const [planTrialRes, empresaRes] = await Promise.all([
    sb.from("planes_config").select("trial_dias, trial_boletas").eq("codigo", "pro").maybeSingle(),
    sb.from("empresas").select("trial_inicio").eq("id", empresaId).maybeSingle(),
  ]);

  const trialDias = planTrialRes.data?.trial_dias ?? 3;
  const trialMax = planTrialRes.data?.trial_boletas ?? 100;
  const inicio = empresaRes.data?.trial_inicio ?? null;
  // El cupo del trial se mide desde su inicio (no por mes calendario).
  const boletasUsadas = inicio ? await contarMasivas(sb, [empresaId], inicio) : 0;
  const vigencia = trialVigente(inicio, ahora, trialDias, boletasUsadas, trialMax);

  return {
    plan: null,
    cuota: 0,
    refills: 0,
    uso: usoMes,
    disponible: vigencia.activo ? Math.max(0, trialMax - boletasUsadas) : 0,
    trial: {
      activo: vigencia.activo,
      inicio,
      diasRestantes: vigencia.diasRestantes,
      boletasUsadas,
      boletasMax: trialMax,
    },
    suscripcionActiva: false,
    suscripcionEstado: suscripcion?.estado ?? null,
  };
}

/**
 * ¿La empresa puede USAR la emisión ahora? (gate de acceso de página + boleta única,
 * auditoría #4). = plan activo (o manual), o trial disponible y no terminado. El cupo
 * de las MASIVAS lo decide aparte verificarEmisionMasiva (que además arranca el trial).
 */
export async function puedeEmitir(sb: Sb, empresaId: string, ahora: Date = new Date()): Promise<boolean> {
  const estado = await estadoCuota(sb, empresaId, ahora);
  if (estado.suscripcionActiva) return true;
  if (!estado.trial) return false; // sin plan y sin trial disponible
  // trial sin iniciar (elegible) o vigente → puede entrar; terminado → no.
  return estado.trial.inicio === null || estado.trial.activo;
}

export type GateEmision =
  | { ok: true }
  | { ok: false; codigo: "SIN_PLAN" | "TRIAL_TERMINADO" | "CUOTA_AGOTADA"; detalle: string; disponible: number };

export type GateDecision = GateEmision | { ok: "activar_trial" };

/**
 * Lógica PURA del gate de emisión masiva: dado el estado de cuota y la cantidad,
 * decide permitir, rechazar (con código/detalle) o ACTIVAR el trial (primera emisión
 * masiva sin trial iniciado). El efecto secundario de activar el trial vive en
 * verificarEmisionMasiva; acá NO se toca la DB → es testeable a fondo.
 */
export function decidirGate(estado: EstadoCuota, cantidad: number): GateDecision {
  if (estado.suscripcionActiva) {
    if (cantidad <= estado.disponible) return { ok: true };
    return {
      ok: false,
      codigo: "CUOTA_AGOTADA",
      detalle: `Te quedan ${estado.disponible} boletas masivas este mes — amplía con REFILL o sube de plan.`,
      disponible: estado.disponible,
    };
  }

  // Hubo suscripción pero no está activa (morosa/pausada/cancelada): se
  // regulariza en Planes — no se vuelve al trial por la puerta de atrás.
  if (estado.suscripcionEstado && estado.suscripcionEstado !== "pendiente") {
    return {
      ok: false,
      codigo: "SIN_PLAN",
      detalle: "Tu suscripción no está activa — regularízala en Planes para seguir emitiendo boletas.",
      disponible: 0,
    };
  }

  const trial = estado.trial;
  if (!trial) {
    return {
      ok: false,
      codigo: "SIN_PLAN",
      detalle: "Tu empresa no tiene un plan activo — contrata uno en Planes para emitir boletas masivas.",
      disponible: 0,
    };
  }

  // Trial sin iniciar: la primera emisión masiva activa el reloj (solo si cabe).
  if (!trial.inicio) {
    if (cantidad > trial.boletasMax) {
      return {
        ok: false,
        codigo: "CUOTA_AGOTADA",
        detalle: `El período de prueba incluye ${trial.boletasMax} boletas masivas — selecciona menos boletas o contrata un plan.`,
        disponible: trial.boletasMax,
      };
    }
    return { ok: "activar_trial" };
  }

  if (!trial.activo) {
    return {
      ok: false,
      codigo: "TRIAL_TERMINADO",
      detalle: "Tu período de prueba terminó — contrata un plan para seguir emitiendo boletas masivas.",
      disponible: 0,
    };
  }

  if (cantidad <= estado.disponible) return { ok: true };
  return {
    ok: false,
    codigo: "CUOTA_AGOTADA",
    detalle: `Te quedan ${estado.disponible} boletas del período de prueba — contrata un plan para ampliar tu cupo.`,
    disponible: estado.disponible,
  };
}

/**
 * Gate de la emisión masiva: ¿puede esta empresa emitir `cantidad` boletas
 * masivas ahora? Si el trial no ha partido, la primera emisión lo activa
 * (setea empresas.trial_inicio) y se permite.
 */
export async function verificarEmisionMasiva(
  sb: Sb,
  empresaId: string,
  cantidad: number,
  opts?: { devBypass?: boolean; ahora?: Date },
): Promise<GateEmision> {
  if (opts?.devBypass) return { ok: true };
  const ahora = opts?.ahora ?? new Date();
  const estado = await estadoCuota(sb, empresaId, ahora);
  const decision = decidirGate(estado, cantidad);

  if (decision.ok === "activar_trial") {
    const { error } = await sb
      .from("empresas")
      .update({ trial_inicio: ahora.toISOString() })
      .eq("id", empresaId);
    if (error) {
      return {
        ok: false,
        codigo: "SIN_PLAN",
        detalle: "No se pudo iniciar el período de prueba — intenta de nuevo.",
        disponible: 0,
      };
    }
    return { ok: true };
  }

  return decision;
}
