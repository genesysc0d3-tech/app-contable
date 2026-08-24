/**
 * Integración Mercado Pago por fetch puro — sin SDK, sin dependencias nuevas.
 *
 * - Suscripciones (planes): API /preapproval (cobro recurrente mensual CLP).
 * - REFILL (pago único): API /checkout/preferences.
 * - Confirmación de webhooks: SIEMPRE server-to-server vía obtenerRecurso();
 *   jamás se confía en el payload del webhook.
 *
 * Si MP_ACCESS_TOKEN no está configurado, toda función retorna
 * { ok:false, error:'MP_NO_CONFIGURADO' } — el código queda listo para
 * operar apenas se pegue el token en Vercel.
 */
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { getUfClp } from "../sii/uf";
import { clpConIva, periodoActual } from "./metering";

const MP_BASE = "https://api.mercadopago.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.massdte.cl";
const UF_PERSONA_ADICIONAL = 0.2;

export type MpError = { ok: false; error: string; detalle?: string };
export type MpCheckout = { ok: true; url: string };

interface MpPreapproval {
  id?: string;
  init_point?: string;
  status?: string;
  external_reference?: string;
  auto_recurring?: { transaction_amount?: number; currency_id?: string };
}

interface MpPreference {
  id?: string;
  init_point?: string;
}

function mpToken(): string | null {
  const t = process.env.MP_ACCESS_TOKEN?.trim();
  return t ? t : null;
}

export function mpConfigurado(): boolean {
  return mpToken() !== null;
}

function serviceDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createServiceClient<Database>(url, key);
}

async function mpFetch<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | MpError> {
  const token = mpToken();
  if (!token) return { ok: false, error: "MP_NO_CONFIGURADO" };
  try {
    const res = await fetch(`${MP_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => null)) as T | null;
    if (!res.ok || data === null) {
      const detalle =
        data && typeof data === "object" && "message" in data
          ? String((data as { message?: unknown }).message)
          : `HTTP ${res.status}`;
      return { ok: false, error: "MP_API_ERROR", detalle };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: "MP_API_ERROR", detalle: err instanceof Error ? err.message : "fetch failed" };
  }
}

/**
 * Crea la suscripción mensual en MP (estado pending hasta que el pagador
 * autorice) y deja la fila local en `suscripciones` como 'pendiente'.
 * Monto = UF del plan * UF del día * 1.19 (total con IVA), en CLP.
 */
export async function crearSuscripcion(
  cuentaId: string,
  empresaId: string,
  planCodigo: string,
  emailPagador: string,
): Promise<MpCheckout | MpError> {
  if (!mpConfigurado()) return { ok: false, error: "MP_NO_CONFIGURADO" };

  const db = serviceDb();
  const { data: plan } = await db
    .from("planes_config")
    .select("codigo, nombre, uf_mensual")
    .eq("codigo", planCodigo)
    .eq("activo", true)
    .maybeSingle();
  if (!plan) return { ok: false, error: "PLAN_INVALIDO", detalle: `No existe el plan ${planCodigo}` };

  const uf = await getUfClp();
  const monto = clpConIva(plan.uf_mensual, uf);

  // Reemplazo de plan (auditoría #5): cancela cualquier preapproval vivo de la
  // cuenta ANTES de crear el nuevo, para no acumular cobros recurrentes duplicados.
  // Si MP falla al cancelar, aborta: mejor no crear el 2º que dejar dos vivos.
  const { data: previas } = await db
    .from("suscripciones")
    .select("id, proveedor_ref")
    .eq("cuenta_id", cuentaId)
    .in("estado", ["activa", "pendiente", "pausada", "morosa"]);
  for (const prev of previas ?? []) {
    if (prev.proveedor_ref) {
      const cancel = await cancelarPreapproval(prev.proveedor_ref);
      if (!cancel.ok) {
        return {
          ok: false,
          error: "REEMPLAZO_FALLIDO",
          detalle: `No se pudo cancelar la suscripción anterior: ${cancel.detalle ?? cancel.error}`,
        };
      }
    }
    await db
      .from("suscripciones")
      .update({ estado: "cancelada", updated_at: new Date().toISOString() })
      .eq("id", prev.id);
  }

  const res = await mpFetch<MpPreapproval>("/preapproval", {
    method: "POST",
    body: JSON.stringify({
      reason: `massDTE ${plan.nombre}`,
      external_reference: `${cuentaId}|plan|${plan.codigo}`,
      payer_email: emailPagador,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: monto,
        currency_id: "CLP",
      },
      back_url: `${APP_URL}/massdte?mp=back`,
      status: "pending",
    }),
  });
  if (!res.ok) return res;
  if (!res.data.id || typeof res.data.init_point !== "string") {
    return { ok: false, error: "MP_API_ERROR", detalle: "Mercado Pago no devolvió init_point" };
  }

  const { error: insErr } = await db.from("suscripciones").insert({
    cuenta_id: cuentaId,
    empresa_id: empresaId,
    plan_codigo: plan.codigo,
    proveedor: "mercadopago",
    proveedor_ref: res.data.id,
    estado: "pendiente",
  });
  if (insErr) return { ok: false, error: "DB_ERROR", detalle: insErr.message };

  return { ok: true, url: res.data.init_point };
}

/**
 * Pago único de REFILL para la empresa (requiere suscripción activa: el
 * precio y las boletas del REFILL salen del plan vigente).
 */
export async function crearRefill(empresaId: string): Promise<MpCheckout | MpError> {
  const db = serviceDb();
  const { data: cuentaEmpresa } = await db
    .from("cuenta_empresas")
    .select("cuenta_id")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  return crearRefillCuenta(cuentaEmpresa?.cuenta_id ?? empresaId, empresaId);
}

export async function crearRefillCuenta(cuentaId: string, empresaId: string): Promise<MpCheckout | MpError> {
  if (!mpConfigurado()) return { ok: false, error: "MP_NO_CONFIGURADO" };

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
    return { ok: false, error: "SIN_SUSCRIPCION_ACTIVA", detalle: "El REFILL requiere una suscripción activa" };
  }

  const { data: plan } = await db
    .from("planes_config")
    .select("nombre, refill_boletas, refill_clp_neto")
    .eq("codigo", suscripcion.plan_codigo)
    .maybeSingle();
  if (!plan) return { ok: false, error: "PLAN_INVALIDO", detalle: "El plan de la suscripción no existe" };

  const monto = Math.round(plan.refill_clp_neto * 1.19);
  const periodo = periodoActual();

  const res = await mpFetch<MpPreference>("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [
        {
          title: `massDTE REFILL — +${plan.refill_boletas} boletas (${plan.nombre})`,
          quantity: 1,
          unit_price: monto,
          currency_id: "CLP",
        },
      ],
      external_reference: `${cuentaId}|refill|${periodo}`,
      back_urls: {
        success: `${APP_URL}/massdte?mp=back`,
        pending: `${APP_URL}/massdte?mp=back`,
        failure: `${APP_URL}/massdte?mp=back`,
      },
      metadata: { cuenta_id: cuentaId, empresa_id: empresaId, tipo: "refill", periodo },
    }),
  });
  if (!res.ok) return res;
  if (typeof res.data.init_point !== "string") {
    return { ok: false, error: "MP_API_ERROR", detalle: "Mercado Pago no devolvió init_point" };
  }
  return { ok: true, url: res.data.init_point };
}

export async function crearPersonaAdicionalCuenta(cuentaId: string, empresaId: string): Promise<MpCheckout | MpError> {
  if (!mpConfigurado()) return { ok: false, error: "MP_NO_CONFIGURADO" };

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
  const monto = clpConIva(UF_PERSONA_ADICIONAL, uf);
  const periodo = periodoActual();

  const { data: intent, error: intentError } = await db
    .from("cuenta_addons")
    .insert({
      cuenta_id: cuentaId,
      tipo: "persona_adicional",
      cantidad: 1,
      periodo,
      estado: "pendiente",
      origen: "mercadopago",
    })
    .select("id")
    .single();
  if (intentError) {
    if (intentError.code === "23505") {
      return {
        ok: false,
        error: "ADDON_PENDIENTE",
        detalle: "Ya hay una compra de persona adicional pendiente. Complétala o espera a que falle antes de intentar de nuevo.",
      };
    }
    return { ok: false, error: "DB_ERROR", detalle: intentError.message };
  }

  const res = await mpFetch<MpPreference>("/checkout/preferences", {
    method: "POST",
    body: JSON.stringify({
      items: [
        {
          title: `massDTE persona adicional (${plan.nombre})`,
          quantity: 1,
          unit_price: monto,
          currency_id: "CLP",
        },
      ],
      external_reference: `${cuentaId}|addon|persona_adicional|${intent.id}`,
      back_urls: {
        success: `${APP_URL}/massdte?mp=back`,
        pending: `${APP_URL}/massdte?mp=back`,
        failure: `${APP_URL}/massdte?mp=back`,
      },
      metadata: { cuenta_id: cuentaId, empresa_id: empresaId, tipo: "addon", addon_tipo: "persona_adicional", cantidad: 1, addon_id: intent.id },
    }),
  });
  if (!res.ok) {
    await db.from("cuenta_addons").update({ estado: "cancelado" }).eq("id", intent.id).eq("estado", "pendiente");
    return res;
  }
  if (typeof res.data.init_point !== "string") {
    await db.from("cuenta_addons").update({ estado: "cancelado" }).eq("id", intent.id).eq("estado", "pendiente");
    return { ok: false, error: "MP_API_ERROR", detalle: "Mercado Pago no devolvió init_point" };
  }
  await db
    .from("cuenta_addons")
    .update({ proveedor_ref: res.data.id ?? null })
    .eq("id", intent.id)
    .eq("estado", "pendiente");
  return { ok: true, url: res.data.init_point };
}

/** Cancela un preapproval en MP (idempotente: cancelar uno ya cancelado es OK). */
export async function cancelarPreapproval(
  preapprovalId: string,
): Promise<{ ok: true } | MpError> {
  const res = await mpFetch<MpPreapproval>(`/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: "PUT",
    body: JSON.stringify({ status: "cancelled" }),
  });
  return res.ok ? { ok: true } : res;
}

/** Re-ancla el monto mensual de una suscripción (UF del día, cron día 1). */
export async function actualizarMontoSuscripcion(
  preapprovalId: string,
  nuevoMonto: number,
): Promise<{ ok: true } | MpError> {
  const res = await mpFetch<MpPreapproval>(`/preapproval/${encodeURIComponent(preapprovalId)}`, {
    method: "PUT",
    body: JSON.stringify({
      auto_recurring: { transaction_amount: nuevoMonto, currency_id: "CLP" },
    }),
  });
  return res.ok ? { ok: true } : res;
}

export type MpRecursoTipo = "preapproval" | "payment";

/**
 * Lee el recurso real desde la API de MP (server-to-server). Es la ÚNICA
 * fuente de verdad para procesar webhooks: el payload entrante solo aporta
 * el id. Retorna null si MP no está configurado o el recurso no existe.
 */
export async function obtenerRecurso(tipo: MpRecursoTipo, id: string): Promise<Record<string, unknown> | null> {
  const path =
    tipo === "preapproval"
      ? `/preapproval/${encodeURIComponent(id)}`
      : `/v1/payments/${encodeURIComponent(id)}`;
  const res = await mpFetch<Record<string, unknown>>(path);
  return res.ok ? res.data : null;
}
