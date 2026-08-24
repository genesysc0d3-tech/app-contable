import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { obtenerRecurso } from "@/lib/pagos/mercadopago";
import { addOneMonth, periodoDePago } from "@/lib/pagos/metering";
import { chileDateString } from "@/lib/chile-date";
import { resolverTargetPago, syncPlanActivo } from "@/lib/pagos/activacion";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";

/**
 * Webhook de Mercado Pago.
 *
 * Seguridad:
 * - Si MP_WEBHOOK_SECRET está seteado se valida el header x-signature
 *   (HMAC-SHA256 del manifest oficial de MP). Sin firma válida → 401.
 * - El payload NUNCA se usa como fuente de verdad: solo aporta el id y el
 *   tipo; el recurso se confirma server-to-server contra la API de MP.
 *
 * Auditoría: todo evento procesado deja una fila en `pagos` con el recurso
 * crudo. Idempotencia: mismo proveedor_ref + mismo estado → 200 sin duplicar.
 */

type Sb = SupabaseClient<Database>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** external_reference nuevo: `${cuentaId}|...`; legacy: `${empresaId}|...`. */
function parseRef(ref: unknown): { sujetoId: string; tipo: "plan" | "refill" | "addon"; valor: string; intentId?: string } | null {
  if (typeof ref !== "string") return null;
  const parts = ref.split("|");
  const [sujetoId, tipo, valor] = parts;
  if (!UUID_RE.test(sujetoId)) return null;
  if (tipo === "addon") {
    const intentId = parts[3];
    if (parts.length !== 4 || valor !== "persona_adicional" || !UUID_RE.test(intentId)) return null;
    return { sujetoId, tipo, valor, intentId };
  }
  if (parts.length !== 3) return null;
  if (tipo !== "plan" && tipo !== "refill") return null;
  if (!valor) return null;
  return { sujetoId, tipo, valor };
}

/**
 * Valida x-signature según el esquema de MP: manifest
 * `id:{data.id};request-id:{x-request-id};ts:{ts};` (las secciones sin valor
 * se omiten; data.id alfanumérico va en minúsculas) firmado HMAC-SHA256.
 */
function firmaValida(request: Request, dataId: string | null, secret: string): boolean {
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");
  if (!xSignature) return false;

  const parts: Record<string, string> = {};
  for (const seg of xSignature.split(",")) {
    const i = seg.indexOf("=");
    if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  let manifest = "";
  if (dataId) manifest += `id:${dataId.toLowerCase()};`;
  if (xRequestId) manifest += `request-id:${xRequestId};`;
  manifest += `ts:${ts};`;

  const esperado = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
  const recibido = Buffer.from(v1);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}

/** Idempotencia: ¿ya registramos este recurso con este mismo estado? */
async function yaProcesado(sb: Sb, proveedorRef: string, estado: string): Promise<boolean> {
  const { data } = await sb
    .from("pagos")
    .select("id")
    .eq("proveedor", "mercadopago")
    .eq("proveedor_ref", proveedorRef)
    .eq("estado", estado)
    .limit(1)
    .maybeSingle();
  return data !== null;
}

async function registrarPago(
  sb: Sb,
  args: { cuentaId: string | null; empresaId: string | null; proveedorRef: string; tipo: "suscripcion" | "refill" | "addon"; montoClp: number | null; estado: string; raw: Record<string, unknown> },
) {
  const { error } = await sb.from("pagos").insert({
    cuenta_id: args.cuentaId,
    empresa_id: args.empresaId,
    proveedor: "mercadopago",
    proveedor_ref: args.proveedorRef,
    tipo: args.tipo,
    monto_clp: args.montoClp,
    estado: args.estado,
    raw: args.raw as unknown as Json,
  });
  if (error && error.code !== "23505") console.error("[pagos/webhook] no se pudo registrar pago", error.message);
}

async function procesarPreapproval(sb: Sb, preapprovalId: string) {
  const recurso = await obtenerRecurso("preapproval", preapprovalId);
  if (!recurso) return NextResponse.json({ ok: true, ignorado: "recurso no disponible" });

  const status = typeof recurso.status === "string" ? recurso.status : "desconocido";
  if (await yaProcesado(sb, preapprovalId, status)) {
    return NextResponse.json({ ok: true, idempotente: true });
  }

  const ref = parseRef(recurso.external_reference);
  const autoRec = (recurso.auto_recurring ?? {}) as { transaction_amount?: unknown };
  const monto = typeof autoRec.transaction_amount === "number" ? Math.round(autoRec.transaction_amount) : null;

  const target = ref ? await resolverTargetPago(sb, ref.sujetoId) : { cuentaId: null, empresaId: null };

  if (ref?.tipo === "plan") {
    const ahoraIso = new Date().toISOString();
    if (status === "authorized") {
      // Suscripción autorizada: activa la fila local y enciende el plan.
      const { error: subError } = await sb
        .from("suscripciones")
        .update({
          estado: "activa",
          periodo_hasta: addOneMonth(chileDateString()),
          clp_ultimo_cobro: monto,
          updated_at: ahoraIso,
          cuenta_id: target.cuentaId,
        })
        .eq("proveedor_ref", preapprovalId);
      if (subError) throw new Error(`No se pudo activar la suscripción: ${subError.message}`);
      await syncPlanActivo(sb, target, ref.valor, true);
    } else if (status === "cancelled") {
      const { error: subError } = await sb
        .from("suscripciones")
        .update({ estado: "cancelada", updated_at: ahoraIso })
        .eq("proveedor_ref", preapprovalId);
      if (subError) throw new Error(`No se pudo cancelar la suscripción: ${subError.message}`);
    } else if (status === "paused") {
      const { error: subError } = await sb
        .from("suscripciones")
        .update({ estado: "pausada", updated_at: ahoraIso })
        .eq("proveedor_ref", preapprovalId);
      if (subError) throw new Error(`No se pudo pausar la suscripción: ${subError.message}`);
    }
  }

  await registrarPago(sb, {
    cuentaId: target.cuentaId,
    empresaId: target.empresaId,
    proveedorRef: preapprovalId,
    tipo: "suscripcion",
    montoClp: monto,
    estado: status,
    raw: recurso,
  });
  return NextResponse.json({ ok: true });
}

async function procesarPayment(sb: Sb, paymentId: string) {
  const recurso = await obtenerRecurso("payment", paymentId);
  if (!recurso) return NextResponse.json({ ok: true, ignorado: "recurso no disponible" });

  const status = typeof recurso.status === "string" ? recurso.status : "desconocido";
  if (await yaProcesado(sb, paymentId, status)) {
    return NextResponse.json({ ok: true, idempotente: true });
  }

  const ref = parseRef(recurso.external_reference);
  const monto = typeof recurso.transaction_amount === "number" ? Math.round(recurso.transaction_amount) : null;

  const target = ref ? await resolverTargetPago(sb, ref.sujetoId) : { cuentaId: null, empresaId: null };

  if (ref?.tipo === "addon" && ref.valor === "persona_adicional" && ref.intentId && target.cuentaId) {
    if (status === "approved") {
      const { data: addon, error: addonError } = await sb
        .from("cuenta_addons")
        .update({
          estado: "activo",
          proveedor_ref: paymentId,
          origen: "mercadopago",
        })
        .eq("id", ref.intentId)
        .eq("cuenta_id", target.cuentaId)
        .eq("tipo", "persona_adicional")
        .eq("estado", "pendiente")
        .select("id")
        .maybeSingle();
      if (addonError) throw new Error(`No se pudo activar la persona adicional: ${addonError.message}`);
      if (!addon) {
        const { data: existingAddon } = await sb
          .from("cuenta_addons")
          .select("id, estado, proveedor_ref")
          .eq("id", ref.intentId)
          .eq("cuenta_id", target.cuentaId)
          .eq("tipo", "persona_adicional")
          .maybeSingle();
        if (existingAddon?.estado !== "activo" || existingAddon.proveedor_ref !== paymentId) {
          throw new Error("Pago de persona adicional sin intención pendiente válida");
        }
      }
    } else if (["cancelled", "rejected", "refunded", "charged_back"].includes(status)) {
      const { error: cancelError } = await sb
        .from("cuenta_addons")
        .update({ estado: "cancelado", proveedor_ref: paymentId })
        .eq("id", ref.intentId)
        .eq("cuenta_id", target.cuentaId)
        .eq("tipo", "persona_adicional")
        .eq("estado", "pendiente");
      if (cancelError) throw new Error(`No se pudo liberar compra pendiente de persona adicional: ${cancelError.message}`);
    }
  }

  if (status === "approved" && ref?.tipo === "refill") {
    // Las boletas del REFILL salen del plan vigente de la empresa.
    let suscripcionQuery = sb
      .from("suscripciones")
      .select("plan_codigo")
      .eq("estado", "activa")
      .order("created_at", { ascending: false })
      .limit(1);
    suscripcionQuery = target.cuentaId ? suscripcionQuery.eq("cuenta_id", target.cuentaId) : suscripcionQuery.eq("empresa_id", target.empresaId ?? ref.sujetoId);
    const { data: suscripcion } = await suscripcionQuery.maybeSingle();
    const { data: plan } = suscripcion
      ? await sb.from("planes_config").select("refill_boletas").eq("codigo", suscripcion.plan_codigo).maybeSingle()
      : { data: null };
    const boletas = plan?.refill_boletas ?? 0;
    if (boletas > 0) {
      // El período se deriva de la fecha real de aprobación de MP (recurso), no del
      // external_reference congelado en el checkout, que puede cruzar de mes (#22).
      const periodo = periodoDePago(recurso);
      const { error: refillError } = await sb.from("refills").insert({
        cuenta_id: target.cuentaId,
        empresa_id: target.empresaId ?? ref.sujetoId,
        periodo,
        boletas,
        origen: "mercadopago",
        proveedor_ref: paymentId,
      });
      if (refillError && refillError.code !== "23505") {
        throw new Error(`No se pudo registrar el extra de boletas: ${refillError.message}`);
      }
    } else {
      // Pago recibido sin plan vigente: queda en `pagos` para conciliar a mano.
      console.warn("[pagos/webhook] refill aprobado sin suscripción activa", { paymentId, target });
    }
  }

  if (status === "approved" && ref?.tipo === "plan") {
    // Cobro recurrente del mes: renueva el período y reactiva si estaba morosa.
    let updateQuery = sb
      .from("suscripciones")
      .update({
        estado: "activa",
        periodo_hasta: addOneMonth(chileDateString()),
        clp_ultimo_cobro: monto,
        updated_at: new Date().toISOString(),
        cuenta_id: target.cuentaId,
      })
      .eq("plan_codigo", ref.valor)
      .in("estado", ["activa", "pendiente", "morosa"]);
    updateQuery = target.cuentaId ? updateQuery.eq("cuenta_id", target.cuentaId) : updateQuery.eq("empresa_id", target.empresaId ?? ref.sujetoId);
    const { error: subError } = await updateQuery;
    if (subError) throw new Error(`No se pudo renovar la suscripción: ${subError.message}`);
    await syncPlanActivo(sb, target, ref.valor, true);
  }

  await registrarPago(sb, {
    cuentaId: target.cuentaId,
    empresaId: target.empresaId,
    proveedorRef: paymentId,
    tipo: ref?.tipo === "refill" ? "refill" : ref?.tipo === "addon" ? "addon" : "suscripcion",
    montoClp: monto,
    estado: status,
    raw: recurso,
  });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      /* algunos eventos de MP llegan solo con query params */
    }

    const dataObj = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
    const dataId =
      url.searchParams.get("data.id") ??
      (typeof dataObj.id === "string" || typeof dataObj.id === "number" ? String(dataObj.id) : null) ??
      url.searchParams.get("id");
    const tipo =
      url.searchParams.get("type") ??
      url.searchParams.get("topic") ??
      (typeof body.type === "string" ? body.type : null) ??
      (typeof body.topic === "string" ? body.topic : null);

    const secret = process.env.MP_WEBHOOK_SECRET?.trim();
    if (!secret && process.env.NODE_ENV === "production") {
      await recordOpsEvent({
        severity: "critical",
        source: "pagos/webhook",
        eventName: "mp_webhook_secret_missing",
        summary: "MP_WEBHOOK_SECRET no esta configurado en produccion",
      });
      return NextResponse.json({ ok: false, error: "MP_WEBHOOK_SECRET_MISSING" }, { status: 503 });
    }
    if (secret && !firmaValida(request, dataId, secret)) {
      await recordOpsEvent({
        severity: "warn",
        source: "pagos/webhook",
        eventName: "mp_webhook_invalid_signature",
        summary: "Webhook de Mercado Pago rechazado por firma invalida",
        metadata: { has_data_id: Boolean(dataId), tipo },
      });
      return NextResponse.json({ ok: false, error: "FIRMA_INVALIDA" }, { status: 401 });
    }

    if (!dataId || !tipo) return NextResponse.json({ ok: true, ignorado: "evento sin data.id o type" });

    const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const sb = createServiceClient<Database>(supaUrl, supaKey);

    if (tipo === "preapproval" || tipo === "subscription_preapproval") {
      return await procesarPreapproval(sb, dataId);
    }
    if (tipo === "payment") {
      return await procesarPayment(sb, dataId);
    }
    // Otros topics (p. ej. subscription_authorized_payment) no se procesan
    // por ahora: el cobro mensual también llega como 'payment'.
    return NextResponse.json({ ok: true, ignorado: tipo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pagos/webhook]", msg);
    await recordOpsError({
      severity: "error",
      source: "pagos/webhook",
      eventName: "mercadopago_webhook_failed",
      summary: "No se pudo procesar webhook de Mercado Pago",
      error: err,
    });
    // 500 a propósito: MP reintenta los no-200 y el evento no se pierde.
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
