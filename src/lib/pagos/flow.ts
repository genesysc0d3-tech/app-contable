/**
 * Integración Flow por fetch puro — sin SDK, sin dependencias nuevas.
 *
 * Flow separa INSCRIBIR la tarjeta de COBRARLA:
 *   1. customer/create        → cliente en Flow
 *   2. customer/register      → url donde el pagador ingresa su tarjeta
 *   3. customer/getRegisterStatus → resultado (marca + últimos 4)
 *   4. customer/charge        → cargo, con el monto que decidamos cada vez
 *
 * POR QUÉ NO usamos las suscripciones de Flow (`plans` + `subscription`):
 * su propia doc dice que "si el plan tiene clientes suscritos sólo se puede
 * modificar el campo trial_period_days" — o sea el precio del plan queda
 * CONGELADO. Nuestro precio está en UF, así que cambia todos los meses. Con
 * `customer/charge` el monto va en cada llamada y lo calculamos con la UF
 * oficial del SII, la misma que va en la factura que le emitimos al cliente.
 * A cambio, la cobranza (reintentos, mora) es nuestra — ya existe del cobro
 * anterior.
 *
 * Firma: TODOS los parámetros salvo `s`, ordenados alfabéticamente por nombre,
 * concatenados nombre+valor sin separadores, HMAC-SHA256 con la secretKey en
 * hexadecimal. La secretKey NUNCA viaja; la apiKey sí, como un parámetro más.
 *
 * Si las llaves no están configuradas toda función retorna
 * { ok:false, error:'FLOW_NO_CONFIGURADO' }.
 */
import { createHmac } from "node:crypto";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import { chileDateString } from "../chile-date";
import { getUfClp } from "../sii/uf";
import { addOneMonth, clpConIva, periodoActual } from "./metering";
import { syncPlanActivo } from "./activacion";
import { cancelarPreapproval } from "./mercadopago";

const BASES = {
  sandbox: "https://sandbox.flow.cl/api",
  production: "https://www.flow.cl/api",
} as const;

export type FlowAmbiente = keyof typeof BASES;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.massdte.cl";
const UF_PERSONA_ADICIONAL = 0.2;

export type FlowError = { ok: false; error: string; detalle?: string; codigo?: number };

/** Flow: "This commerceOrder has been previously paid". La plata YA entró. */
const CODIGO_ORDEN_YA_PAGADA = 1605;

/** Estado de una orden en Flow (customer/charge y payment/getStatus). */
export const FLOW_PAGO = { PENDIENTE: 1, PAGADA: 2, RECHAZADA: 3, ANULADA: 4 } as const;

interface FlowCustomer {
  customerId?: string;
  email?: string;
  externalId?: string;
  creditCardType?: string | null;
  last4CardDigits?: string | null;
}

interface FlowRegisterResult {
  status?: string | number; // '1' registrado, '0' no registrado
  customerId?: string;
  creditCardType?: string | null;
  last4CardDigits?: string | null;
}

export interface FlowPagoStatus {
  flowOrder?: number;
  commerceOrder?: string;
  status?: number;
  amount?: number;
  currency?: string;
  subject?: string;
}

/**
 * `production` solo si está escrito tal cual. Cualquier otra cosa —vacío, un
 * typo, "prod"— cae a sandbox: equivocarse de ambiente con una pasarela cuesta
 * plata de verdad, así que el error por omisión es el inofensivo.
 */
export function flowAmbiente(): FlowAmbiente {
  return process.env.FLOW_ENV?.trim() === "production" ? "production" : "sandbox";
}

function llaves(): { apiKey: string; secretKey: string } | null {
  const apiKey = process.env.FLOW_API_KEY?.trim();
  const secretKey = process.env.FLOW_SECRET_KEY?.trim();
  return apiKey && secretKey ? { apiKey, secretKey } : null;
}

export function flowConfigurado(): boolean {
  return llaves() !== null;
}

function serviceDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServiceClient<Database>(url, key);
}

/**
 * Firma de Flow. Exportada porque es la pieza que hay que poder probar sola:
 * si la firma está mal, TODA llamada falla con el mismo error genérico y no se
 * distingue de una llave equivocada.
 */
export function firmarFlow(params: Record<string, string>, secretKey: string): string {
  const cadena = Object.keys(params)
    .filter((k) => k !== "s")
    .sort()
    .map((k) => k + params[k])
    .join("");
  return createHmac("sha256", secretKey).update(cadena, "utf8").digest("hex");
}

/** Deja todo como string (Flow firma sobre el texto que viaja) y saca los vacíos. */
function normalizar(params: Record<string, string | number | undefined | null>): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    salida[k] = String(v);
  }
  return salida;
}

async function flowFetch<T>(
  path: string,
  metodo: "GET" | "POST",
  params: Record<string, string | number | undefined | null>,
): Promise<{ ok: true; data: T } | FlowError> {
  const k = llaves();
  if (!k) return { ok: false, error: "FLOW_NO_CONFIGURADO" };

  const cuerpo = normalizar({ ...params, apiKey: k.apiKey });
  cuerpo.s = firmarFlow(cuerpo, k.secretKey);
  const query = new URLSearchParams(cuerpo).toString();
  const base = BASES[flowAmbiente()];

  try {
    const res = await fetch(metodo === "GET" ? `${base}${path}?${query}` : `${base}${path}`, {
      method: metodo,
      headers: metodo === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {},
      body: metodo === "POST" ? query : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => null)) as (T & { message?: unknown; code?: unknown }) | null;
    if (!res.ok || data === null) {
      const detalle =
        data && typeof data === "object" && "message" in data
          ? `${String(data.message)} (code ${String(data.code ?? "?")})`
          : `HTTP ${res.status}`;
      const codigo = data && typeof data === "object" && typeof data.code === "number" ? data.code : undefined;
      return { ok: false, error: "FLOW_API_ERROR", detalle, codigo };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: "FLOW_API_ERROR", detalle: err instanceof Error ? err.message : "fetch failed" };
  }
}

// ─────────────────────────── Inscripción de la tarjeta ───────────────────────

/**
 * Paso 1-2: asegura el cliente en Flow y devuelve la URL donde el pagador
 * inscribe su tarjeta. Deja la fila en `medios_pago` como 'pendiente'; recién
 * se marca 'inscrito' cuando Flow confirma en el callback.
 *
 * Reusa el customer de Flow si la cuenta ya tenía uno (mismo ambiente): crear
 * uno nuevo por cada intento dejaría clientes huérfanos con tarjetas vivas.
 */
export async function iniciarInscripcionTarjeta(
  cuentaId: string,
  email: string,
  nombre: string,
): Promise<{ ok: true; url: string } | FlowError> {
  if (!flowConfigurado()) return { ok: false, error: "FLOW_NO_CONFIGURADO" };

  const db = serviceDb();
  const ambiente = flowAmbiente();

  const { data: previo } = await db
    .from("medios_pago")
    .select("id, proveedor_ref")
    .eq("cuenta_id", cuentaId)
    .eq("proveedor", "flow")
    .eq("ambiente", ambiente)
    .in("estado", ["pendiente", "inscrito"])
    .maybeSingle();

  let customerId = previo?.proveedor_ref ?? null;

  if (!customerId) {
    const creado = await flowFetch<FlowCustomer>("/customer/create", "POST", {
      name: nombre,
      email,
      externalId: cuentaId,
    });
    if (!creado.ok) return creado;
    if (!creado.data.customerId) {
      return { ok: false, error: "FLOW_API_ERROR", detalle: "Flow no devolvió customerId" };
    }
    customerId = creado.data.customerId;

    const { error: insErr } = await db.from("medios_pago").insert({
      cuenta_id: cuentaId,
      proveedor: "flow",
      proveedor_ref: customerId,
      ambiente,
      estado: "pendiente",
    });
    if (insErr) return { ok: false, error: "DB_ERROR", detalle: insErr.message };
  }

  const registro = await flowFetch<{ url?: string; token?: string }>("/customer/register", "POST", {
    customerId,
    url_return: `${APP_URL}/api/pagos/flow/inscripcion`,
  });
  if (!registro.ok) return registro;
  if (!registro.data.url || !registro.data.token) {
    return { ok: false, error: "FLOW_API_ERROR", detalle: "Flow no devolvió url y token de inscripción" };
  }

  return { ok: true, url: `${registro.data.url}?token=${registro.data.token}` };
}

/**
 * Paso 3: Flow devuelve al pagador a nuestra página con un `token`. El token
 * por sí solo no dice nada — hay que preguntarle a Flow server-to-server cuál
 * fue el resultado. Igual que con el webhook anterior: el payload que llega
 * solo aporta el identificador, jamás el veredicto.
 */
export async function confirmarInscripcion(
  token: string,
): Promise<{ ok: true; cuentaId: string | null; marca: string | null; ultimos4: string | null } | FlowError> {
  if (!flowConfigurado()) return { ok: false, error: "FLOW_NO_CONFIGURADO" };

  const res = await flowFetch<FlowRegisterResult>("/customer/getRegisterStatus", "GET", { token });
  if (!res.ok) return res;

  const inscrito = String(res.data.status) === "1";
  const customerId = res.data.customerId;
  if (!customerId) return { ok: false, error: "FLOW_API_ERROR", detalle: "Flow no devolvió customerId" };

  const db = serviceDb();
  const ambiente = flowAmbiente();
  const { data: medio } = await db
    .from("medios_pago")
    .select("id, cuenta_id")
    .eq("proveedor", "flow")
    .eq("proveedor_ref", customerId)
    .eq("ambiente", ambiente)
    .in("estado", ["pendiente", "inscrito"])
    .maybeSingle();

  if (medio) {
    await db
      .from("medios_pago")
      .update({
        estado: inscrito ? "inscrito" : "fallido",
        marca: res.data.creditCardType ?? null,
        ultimos4: res.data.last4CardDigits ?? null,
        inscrito_at: inscrito ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", medio.id);
  }

  if (!inscrito) return { ok: false, error: "INSCRIPCION_RECHAZADA", detalle: "El pagador no completó la inscripción" };

  return {
    ok: true,
    cuentaId: medio?.cuenta_id ?? null,
    marca: res.data.creditCardType ?? null,
    ultimos4: res.data.last4CardDigits ?? null,
  };
}

/** La tarjeta viva de la cuenta en el ambiente actual, o null. */
export async function tarjetaDeCuenta(
  cuentaId: string,
): Promise<{ customerId: string; marca: string | null; ultimos4: string | null } | null> {
  const db = serviceDb();
  const { data } = await db
    .from("medios_pago")
    .select("proveedor_ref, marca, ultimos4")
    .eq("cuenta_id", cuentaId)
    .eq("proveedor", "flow")
    .eq("ambiente", flowAmbiente())
    .eq("estado", "inscrito")
    .maybeSingle();
  return data ? { customerId: data.proveedor_ref, marca: data.marca, ultimos4: data.ultimos4 } : null;
}

// ──────────────────────────────── Cobro ──────────────────────────────────────

/**
 * Paso 4: cobra a la tarjeta inscrita.
 *
 * `orden` es el seguro contra el doble cobro: Flow rechaza un commerceOrder
 * repetido, así que si el cron corre dos veces el mismo mes el segundo intento
 * REBOTA en Flow en vez de cobrarle dos veces al cliente. Por eso la orden se
 * arma con el período (ej. `cuenta-2026-09`) y no con un azar.
 */
export async function cobrarCuenta(
  cuentaId: string,
  args: { montoClp: number; concepto: string; orden: string },
): Promise<{ ok: true; pago: FlowPagoStatus } | FlowError> {
  if (!flowConfigurado()) return { ok: false, error: "FLOW_NO_CONFIGURADO" };
  if (!Number.isInteger(args.montoClp) || args.montoClp <= 0) {
    return { ok: false, error: "MONTO_INVALIDO", detalle: `Monto no cobrable: ${args.montoClp}` };
  }

  const tarjeta = await tarjetaDeCuenta(cuentaId);
  if (!tarjeta) return { ok: false, error: "SIN_TARJETA", detalle: "La cuenta no tiene una tarjeta inscrita" };

  const res = await flowFetch<FlowPagoStatus>("/customer/charge", "POST", {
    customerId: tarjeta.customerId,
    amount: args.montoClp,
    subject: args.concepto,
    commerceOrder: args.orden,
    currency: "CLP",
  });
  if (!res.ok) {
    // El rebote por orden repetida NO es una falla: significa que este período
    // ya se cobró. Pasa cuando el cobro pasó pero la escritura en la base no
    // (deploy a media llamada, timeout). Si se tratara como error, el cliente
    // quedaría trabado para siempre: cada reintento volvería a rebotar y el
    // plan nunca se encendería, con la plata ya cobrada.
    if (res.codigo === CODIGO_ORDEN_YA_PAGADA) {
      return { ok: false, error: "COBRO_YA_PAGADO", detalle: args.orden };
    }
    return res;
  }

  const db = serviceDb();
  await db.from("pagos").insert({
    cuenta_id: cuentaId,
    proveedor: "flow",
    proveedor_ref: String(res.data.flowOrder ?? args.orden),
    tipo: "suscripcion",
    monto_clp: args.montoClp,
    estado: res.data.status === FLOW_PAGO.PAGADA ? "aprobado" : res.data.status === FLOW_PAGO.RECHAZADA ? "rechazado" : "pendiente",
    raw: res.data as unknown as Json,
  });

  if (res.data.status !== FLOW_PAGO.PAGADA) {
    return { ok: false, error: "COBRO_NO_APROBADO", detalle: `Flow devolvió status ${String(res.data.status)}` };
  }
  return { ok: true, pago: res.data };
}

/** Da de baja la tarjeta en Flow y en nuestra tabla (idempotente). */
export async function eliminarTarjeta(cuentaId: string): Promise<{ ok: true } | FlowError> {
  const tarjeta = await tarjetaDeCuenta(cuentaId);
  if (!tarjeta) return { ok: true };

  const res = await flowFetch<FlowCustomer>("/customer/unRegister", "POST", { customerId: tarjeta.customerId });
  if (!res.ok) return res;

  const db = serviceDb();
  await db
    .from("medios_pago")
    .update({ estado: "eliminado", updated_at: new Date().toISOString() })
    .eq("cuenta_id", cuentaId)
    .eq("proveedor", "flow")
    .eq("ambiente", flowAmbiente())
    .in("estado", ["pendiente", "inscrito"]);
  return { ok: true };
}

/** Lee una orden desde Flow (fuente de verdad para confirmar un cobro). */
export async function estadoPago(flowOrder: string | number): Promise<FlowPagoStatus | null> {
  const res = await flowFetch<FlowPagoStatus>("/payment/getStatusByFlowOrder", "GET", { flowOrder });
  return res.ok ? res.data : null;
}

// ─────────────────────── Ciclo de suscripción ────────────────────────────────

/**
 * Prorrateo de un upgrade (modelo Anthropic/Stripe): se cobra HOY solo la
 * diferencia de precio por los días que faltan del período ya pagado; la
 * fecha de renovación no se mueve. Función pura para poder probarla sola.
 */
export function prorratearUpgrade(args: {
  ufViejo: number;
  ufNuevo: number;
  ufClp: number;
  hoy: string;          // YYYY-MM-DD
  periodoHasta: string; // YYYY-MM-DD (fin del período ya pagado)
}): number {
  const dia = 86_400_000;
  const restantes = Math.max(0, Math.round((Date.parse(args.periodoHasta) - Date.parse(args.hoy)) / dia));
  // El período pagado partió un mes antes de su vencimiento; su largo real
  // (28-31 días) sale de esa resta y no de un "30" supuesto.
  const inicio = new Date(args.periodoHasta + "T00:00:00Z");
  inicio.setUTCMonth(inicio.getUTCMonth() - 1);
  const total = Math.max(1, Math.round((Date.parse(args.periodoHasta) - inicio.getTime()) / dia));
  const difNeto = (args.ufNuevo - args.ufViejo) * args.ufClp;
  return Math.max(0, Math.round(difNeto * 1.19 * Math.min(1, restantes / total)));
}

/**
 * Contratar un plan con Flow. A diferencia de la pasarela anterior, acá NO se
 * paga en la vuelta: el pagador va a INSCRIBIR su tarjeta y el primer cobro lo
 * hacemos nosotros al volver (`activarSuscripcionFlow`).
 *
 * La fila en `suscripciones` queda 'pendiente' ANTES de mandarlo a Flow, y es
 * la que recuerda qué plan eligió: el callback de Flow trae el token y nada
 * más, así que si el plan no quedara guardado antes de salir, al volver no
 * habría cómo saber qué contrató.
 */
export async function crearSuscripcionFlow(
  cuentaId: string,
  empresaId: string,
  planCodigo: string,
  email: string,
  nombre: string,
): Promise<
  | { ok: true; url: string }
  | { ok: true; cobrado: true; montoClp: number }
  | { ok: true; programado: true; desde: string }
  | FlowError
> {
  if (!flowConfigurado()) return { ok: false, error: "FLOW_NO_CONFIGURADO" };

  const db = serviceDb();
  const { data: plan } = await db
    .from("planes_config")
    .select("codigo, nombre, uf_mensual")
    .eq("codigo", planCodigo)
    .eq("activo", true)
    .maybeSingle();
  if (!plan) return { ok: false, error: "PLAN_INVALIDO", detalle: `No existe el plan ${planCodigo}` };

  // ── Cambio de plan sobre una suscripción Flow VIVA (modelo Anthropic) ──
  // Subir: inmediato, cobrando SOLO la diferencia prorrateada por los días
  // que faltan; la fecha de renovación no se mueve, y como la tarjeta ya está
  // inscrita no se pasa por Transbank — un click.
  // Bajar: no cambia nada hoy (el plan caro ya está pagado); queda programado
  // para la próxima renovación vía `plan_siguiente`.
  const { data: vivaFlow } = await db
    .from("suscripciones")
    .select("id, plan_codigo, empresa_id, periodo_hasta")
    .eq("cuenta_id", cuentaId)
    .eq("proveedor", "flow")
    .eq("estado", "activa")
    .maybeSingle();
  const tarjeta = vivaFlow ? await tarjetaDeCuenta(cuentaId) : null;

  if (vivaFlow && tarjeta && vivaFlow.periodo_hasta) {
    if (vivaFlow.plan_codigo === plan.codigo) {
      return { ok: false, error: "MISMO_PLAN", detalle: "Ya tienes ese plan activo" };
    }
    const { data: planViejo } = await db
      .from("planes_config")
      .select("uf_mensual")
      .eq("codigo", vivaFlow.plan_codigo)
      .maybeSingle();
    if (!planViejo) return { ok: false, error: "PLAN_INVALIDO", detalle: "El plan actual no existe" };

    if (plan.uf_mensual > planViejo.uf_mensual) {
      const uf = await getUfClp();
      const monto = prorratearUpgrade({
        ufViejo: planViejo.uf_mensual,
        ufNuevo: plan.uf_mensual,
        ufClp: uf,
        hoy: chileDateString(),
        periodoHasta: vivaFlow.periodo_hasta,
      });
      if (monto > 0) {
        const cobro = await cobrarCuenta(cuentaId, {
          montoClp: monto,
          concepto: `massDTE upgrade a ${plan.nombre} (prorrateado)`,
          // El plan nuevo en la orden la hace distinta de la del mes ya pagado;
          // repetir el MISMO upgrade en el período rebota en Flow (1605).
          orden: `md-up-${cuentaId.slice(0, 8)}-${plan.codigo}-${vivaFlow.periodo_hasta}`,
        });
        if (!cobro.ok && cobro.error !== "COBRO_YA_PAGADO") return cobro;
      }
      const { error: upErr } = await db
        .from("suscripciones")
        .update({ plan_codigo: plan.codigo, plan_siguiente: null, clp_ultimo_cobro: monto, updated_at: new Date().toISOString() })
        .eq("id", vivaFlow.id);
      if (upErr) return { ok: false, error: "DB_ERROR", detalle: upErr.message };
      await syncPlanActivo(db, { cuentaId, empresaId: vivaFlow.empresa_id }, plan.codigo, true);
      return { ok: true, cobrado: true, montoClp: monto };
    }

    // Downgrade: programado para la renovación. Sin cobro, sin tocar el plan vigente.
    const { error: downErr } = await db
      .from("suscripciones")
      .update({ plan_siguiente: plan.codigo, updated_at: new Date().toISOString() })
      .eq("id", vivaFlow.id);
    if (downErr) return { ok: false, error: "DB_ERROR", detalle: downErr.message };
    return { ok: true, programado: true, desde: vivaFlow.periodo_hasta };
  }

  // La base permite UNA sola suscripción viva por cuenta, de CUALQUIER
  // proveedor (ux_suscripciones_cuenta_viva, anti doble-cobro). Así que antes
  // de crear hay que retirar todo lo vivo — incluidas las de Mercado Pago que
  // quedaron de la etapa anterior. La primera versión solo limpiaba pendientes
  // de Flow y el insert chocaba con el candado en cuanto la cuenta traía una
  // de MP colgando (pasó en producción con la cuenta de prueba).
  //
  // Si la previa es un preapproval de MP, se cancela ALLÁ primero; si MP no
  // deja cancelarlo, se aborta igual que hacía el molde de MP: mejor no crear
  // la nueva que dejar dos cobros recurrentes vivos.
  const { data: previas } = await db
    .from("suscripciones")
    .select("id, proveedor, proveedor_ref")
    .eq("cuenta_id", cuentaId)
    .in("estado", ["activa", "pendiente", "pausada", "morosa"]);
  for (const prev of previas ?? []) {
    if (prev.proveedor === "mercadopago" && prev.proveedor_ref) {
      const cancel = await cancelarPreapproval(prev.proveedor_ref);
      if (!cancel.ok) {
        return {
          ok: false,
          error: "REEMPLAZO_FALLIDO",
          detalle: `No se pudo cancelar la suscripción anterior en Mercado Pago: ${cancel.detalle ?? cancel.error}`,
        };
      }
    }
    await db
      .from("suscripciones")
      .update({ estado: "cancelada", updated_at: new Date().toISOString() })
      .eq("id", prev.id);
  }

  const { error: insErr } = await db.from("suscripciones").insert({
    cuenta_id: cuentaId,
    empresa_id: empresaId,
    plan_codigo: plan.codigo,
    proveedor: "flow",
    estado: "pendiente",
  });
  if (insErr) {
    // 23505 contra ux_suscripciones_cuenta_viva = otra viva se coló entre la
    // limpieza y el insert (doble click, dos pestañas). Mensaje humano en vez
    // del error crudo de Postgres que llegó a pintarse en la página de planes.
    if (insErr.code === "23505") {
      return { ok: false, error: "SUSCRIPCION_EN_CURSO", detalle: "Ya hay una contratación en curso para esta cuenta — recarga la página" };
    }
    return { ok: false, error: "DB_ERROR", detalle: insErr.message };
  }

  return iniciarInscripcionTarjeta(cuentaId, email, nombre);
}

/**
 * Primer cobro después de que el pagador inscribió su tarjeta.
 *
 * El plan se enciende SOLO si Flow confirma el cobro. Si la tarjeta rebota, la
 * suscripción queda 'pendiente' y el cliente sigue sin plan: nunca se activa
 * contra una promesa de pago.
 */
export async function activarSuscripcionFlow(
  cuentaId: string,
): Promise<{ ok: true; planCodigo: string; montoClp: number } | FlowError> {
  const db = serviceDb();
  const { data: suscripcion } = await db
    .from("suscripciones")
    .select("id, plan_codigo, empresa_id")
    .eq("cuenta_id", cuentaId)
    .eq("proveedor", "flow")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!suscripcion) {
    return { ok: false, error: "SIN_SUSCRIPCION_PENDIENTE", detalle: "No hay un plan esperando activación" };
  }

  const { data: plan } = await db
    .from("planes_config")
    .select("codigo, nombre, uf_mensual")
    .eq("codigo", suscripcion.plan_codigo)
    .maybeSingle();
  if (!plan) return { ok: false, error: "PLAN_INVALIDO", detalle: "El plan de la suscripción ya no existe" };

  const uf = await getUfClp();
  const montoClp = clpConIva(plan.uf_mensual, uf);
  const periodo = periodoActual();

  const cobro = await cobrarCuenta(cuentaId, {
    montoClp,
    concepto: `massDTE ${plan.nombre}`,
    orden: ordenDeCobro(cuentaId, plan.codigo, periodo),
  });
  // COBRO_YA_PAGADO = este período ya se cobró (la plata entró en un intento
  // anterior cuya escritura no llegó). Se sigue adelante: cobrar de nuevo sería
  // el error, no activar sería robarle el mes al cliente.
  if (!cobro.ok && cobro.error !== "COBRO_YA_PAGADO") return cobro;

  const hoy = chileDateString();
  const { error: updErr } = await db
    .from("suscripciones")
    .update({
      estado: "activa",
      clp_ultimo_cobro: montoClp,
      periodo_hasta: addOneMonth(hoy),
      updated_at: new Date().toISOString(),
    })
    .eq("id", suscripcion.id);
  if (updErr) return { ok: false, error: "DB_ERROR", detalle: updErr.message };

  await syncPlanActivo(db, { cuentaId, empresaId: suscripcion.empresa_id }, plan.codigo, true);
  return { ok: true, planCodigo: plan.codigo, montoClp };
}

/**
 * La orden que va a Flow. Flow rechaza un `commerceOrder` repetido, así que
 * esta cadena convierte el "no cobrar dos veces lo mismo" en algo que hace
 * cumplir la PASARELA y no nuestro código: un cron que corra dos veces choca
 * allá, no acá.
 *
 * Lleva el PLAN además del período porque sin él un cambio de plan a mitad de
 * mes rebotaba como "ya pagado" y el cliente se llevaba el plan caro gratis
 * hasta el mes siguiente. Con el plan adentro, subir de plan es una orden
 * distinta y sí se cobra; repetir el MISMO plan en el mismo mes sigue
 * protegido, que es lo que se quería. (Lo cazó el e2e sintético, no la lectura.)
 *
 * ⚠️ ESTE FORMATO ES CONTRATO. Cambiarlo con clientes vivos le cobra DOS VECES
 * el mes en curso a cada uno: Flow ve una orden que nunca pagó y la aprueba.
 * Pasó en el e2e al cambiarlo a mitad de prueba — dos cargos, misma tarjeta,
 * mismo mes. Si alguna vez hay que cambiarlo, hacerlo el día 1 y solo para
 * suscripciones cuyo período ya se cobró.
 */
export function ordenDeCobro(cuentaId: string, planCodigo: string, periodo: string): string {
  return `md-${cuentaId.slice(0, 8)}-${planCodigo}-${periodo}`;
}

// ──────────────────────── Extras: REFILL y persona adicional ─────────────────

/**
 * La orden de un REFILL. A diferencia de la suscripción (una por mes), acá se
 * permiten VARIOS por período — lo que hay que impedir es el doble click. El
 * correlativo lo resuelve: dos clicks simultáneos calculan el mismo número, la
 * segunda orden choca en Flow (1605) y el cliente compra UNO. El refill
 * siguiente, ya con la fila del primero en la base, calcula el correlativo que
 * viene y pasa limpio.
 */
export function ordenDeRefill(cuentaId: string, periodo: string, correlativo: number): string {
  return `md-rf-${cuentaId.slice(0, 8)}-${periodo}-${correlativo}`;
}

/**
 * REFILL cobrado directo a la tarjeta inscrita — sin redirección: el precio ya
 * está impreso en el botón que el usuario apretó, y la gracia de tener la
 * tarjeta en archivo es exactamente esta.
 *
 * Regla heredada del carril MP: exige suscripción activa (las boletas y el
 * precio del REFILL salen del plan vigente).
 */
export async function comprarRefillFlow(
  cuentaId: string,
  empresaId: string,
): Promise<{ ok: true; boletas: number; montoClp: number } | FlowError> {
  if (!flowConfigurado()) return { ok: false, error: "FLOW_NO_CONFIGURADO" };

  const db = serviceDb();
  const { data: suscripcion } = await db
    .from("suscripciones")
    .select("plan_codigo")
    .eq("cuenta_id", cuentaId)
    .eq("estado", "activa")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!suscripcion) {
    return { ok: false, error: "SIN_SUSCRIPCION_ACTIVA", detalle: "El extra requiere una suscripción activa" };
  }

  const { data: plan } = await db
    .from("planes_config")
    .select("nombre, refill_boletas, refill_clp_neto")
    .eq("codigo", suscripcion.plan_codigo)
    .maybeSingle();
  if (!plan) return { ok: false, error: "PLAN_INVALIDO", detalle: "El plan de la suscripción no existe" };

  const montoClp = Math.round(plan.refill_clp_neto * 1.19);
  const periodo = periodoActual();

  const { count } = await db
    .from("refills")
    .select("id", { count: "exact", head: true })
    .eq("cuenta_id", cuentaId)
    .eq("periodo", periodo);
  const correlativo = (count ?? 0) + 1;
  const orden = ordenDeRefill(cuentaId, periodo, correlativo);

  const cobro = await cobrarCuenta(cuentaId, {
    montoClp,
    concepto: `massDTE extra +${plan.refill_boletas} boletas`,
    orden,
  });
  // YA_PAGADO acá = el cobro de ESTE correlativo pasó pero su fila no se
  // escribió (doble click, o caída entre cobro e insert). Se sigue al insert:
  // registrar lo cobrado es lo correcto; cobrar de nuevo sería el error.
  if (!cobro.ok && cobro.error !== "COBRO_YA_PAGADO") return cobro;

  const { error: refillError } = await db.from("refills").insert({
    cuenta_id: cuentaId,
    empresa_id: empresaId,
    periodo,
    boletas: plan.refill_boletas,
    origen: "flow",
    proveedor_ref: orden,
  });
  if (refillError) return { ok: false, error: "DB_ERROR", detalle: refillError.message };

  return { ok: true, boletas: plan.refill_boletas, montoClp };
}

/** Persona adicional (solo Business), cobrada directo a la tarjeta inscrita. */
export async function comprarPersonaAdicionalFlow(
  cuentaId: string,
): Promise<{ ok: true; montoClp: number } | FlowError> {
  if (!flowConfigurado()) return { ok: false, error: "FLOW_NO_CONFIGURADO" };

  const db = serviceDb();
  const { data: cuenta } = await db
    .from("cuentas")
    .select("plan_codigo, plan_activo")
    .eq("id", cuentaId)
    .maybeSingle();
  const { data: plan } = cuenta?.plan_codigo
    ? await db.from("planes_config").select("nombre, equipo").eq("codigo", cuenta.plan_codigo).maybeSingle()
    : { data: null };
  if (!cuenta?.plan_activo || plan?.equipo !== true) {
    return { ok: false, error: "EQUIPO_NO_DISPONIBLE", detalle: "Personas adicionales están disponibles en Business" };
  }

  const uf = await getUfClp();
  const montoClp = clpConIva(UF_PERSONA_ADICIONAL, uf);
  const periodo = periodoActual();

  // El intent en cuenta_addons va ANTES del cobro (mismo diseño que MP): su
  // índice único por período es el freno al doble click, y si el cobro falla
  // el intent se cancela para no dejar la compra trabada.
  const { data: intent, error: intentError } = await db
    .from("cuenta_addons")
    .insert({ cuenta_id: cuentaId, tipo: "persona_adicional", cantidad: 1, periodo, estado: "pendiente", origen: "flow" })
    .select("id")
    .single();
  if (intentError) {
    if (intentError.code === "23505") {
      return { ok: false, error: "ADDON_PENDIENTE", detalle: "Ya hay una compra de persona adicional pendiente" };
    }
    return { ok: false, error: "DB_ERROR", detalle: intentError.message };
  }

  const cobro = await cobrarCuenta(cuentaId, {
    montoClp,
    concepto: `massDTE persona adicional (${plan.nombre})`,
    orden: `md-pa-${cuentaId.slice(0, 8)}-${intent.id.slice(0, 8)}`,
  });
  if (!cobro.ok && cobro.error !== "COBRO_YA_PAGADO") {
    await db.from("cuenta_addons").update({ estado: "cancelado" }).eq("id", intent.id).eq("estado", "pendiente");
    return cobro;
  }

  await db
    .from("cuenta_addons")
    .update({ estado: "activo", proveedor_ref: `flow-${cuentaId.slice(0, 8)}-${intent.id.slice(0, 8)}` })
    .eq("id", intent.id);
  return { ok: true, montoClp };
}
