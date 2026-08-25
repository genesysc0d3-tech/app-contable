import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crearPersonaAdicionalCuenta, crearRefillCuenta, crearSuscripcion } from "@/lib/pagos/mercadopago";
import { comprarPersonaAdicionalFlow, comprarRefillFlow, crearSuscripcionFlow, flowConfigurado } from "@/lib/pagos/flow";
import { contextoCuentaPorEmpresa } from "@/lib/entitlements";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { recordOpsError } from "@/lib/ops/events";

/**
 * Inicia un checkout de Mercado Pago:
 *   POST { tipo: 'plan', plan: 'start'|'pro'|'business' } → suscripción mensual
 *   POST { tipo: 'refill' }                               → pago único REFILL
 * Responde { ok, url } con el init_point para redirigir al pagador.
 */

// Contratar planes es un acto de cobro: solo owner/admin (viewer/contador no).
const ROLES_PAGO = new Set(["owner", "admin"]);

export async function POST(request: Request) {
  const opsContext: { usuarioId?: string; empresaId?: string; cuentaId?: string; tipo?: string; plan?: string } = {};
  try {
    // Plata del cliente: ni la intervención autorizada abre esta ruta.
    const supportBlock = await getDevSupportWriteBlock("pagos_checkout", { nuncaEnIntervencion: true });
    if (supportBlock) return NextResponse.json({ ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: supportBlock.error }, { status: 403 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    opsContext.usuarioId = user.id;

    const limited = enforceRateLimit({
      key: rateLimitKey("pagos-checkout", user.id),
      limit: 8,
      windowMs: 5 * 60_000,
    });
    if (limited) return limited;

    const { data: usuario } = await supabase
      .from("usuarios")
      .select("empresa_id, rol")
      .eq("id", user.id)
      .single();
    if (!usuario?.empresa_id) {
      return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
    }
    opsContext.empresaId = usuario.empresa_id;

    let body: { tipo?: string; plan?: string } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
    }
    opsContext.tipo = body.tipo;
    opsContext.plan = body.plan;

    if (body.tipo !== "persona_adicional" && !ROLES_PAGO.has(String(usuario.rol))) {
      return NextResponse.json(
        { ok: false, error: "ROL_SIN_PERMISO", detalle: "Tu cuenta no puede contratar planes desde este acceso" },
        { status: 403 },
      );
    }

    const cuenta = await contextoCuentaPorEmpresa(supabase, usuario.empresa_id);
    if (!cuenta) {
      return NextResponse.json({ ok: false, error: "CUENTA_NO_CONFIGURADA" }, { status: 409 });
    }
    opsContext.cuentaId = cuenta.cuentaId;

    let result;
    if (body.tipo === "plan") {
      const plan = typeof body.plan === "string" ? body.plan.trim() : "";
      if (!plan) return NextResponse.json({ ok: false, error: "PLAN_REQUERIDO" }, { status: 400 });
      // Flow manda cuando está configurado. La diferencia para el usuario es
      // que no va a "pagar" sino a INSCRIBIR su tarjeta: el primer cobro lo
      // hacemos nosotros al volver. Mercado Pago queda de respaldo mientras
      // convivan; su suscripción no acepta prepago ni Redcompra, que es justo
      // la tarjeta de los clientes chicos.
      const nombrePagador = user.user_metadata?.full_name ?? user.email ?? "Cliente massDTE";
      result = flowConfigurado()
        ? await crearSuscripcionFlow(cuenta.cuentaId, usuario.empresa_id, plan, user.email ?? "", String(nombrePagador))
        : await crearSuscripcion(cuenta.cuentaId, usuario.empresa_id, plan, user.email ?? "");
    } else if (body.tipo === "refill") {
      // Con la tarjeta inscrita en Flow el extra se cobra AL TIRO, sin
      // redirección: el precio ya está impreso en el botón que apretó.
      result = flowConfigurado()
        ? await comprarRefillFlow(cuenta.cuentaId, usuario.empresa_id)
        : await crearRefillCuenta(cuenta.cuentaId, usuario.empresa_id);
    } else if (body.tipo === "persona_adicional") {
      const [{ data: cuentaRow }, { data: membresia }] = await Promise.all([
        supabase.from("cuentas").select("owner_usuario_id").eq("id", cuenta.cuentaId).maybeSingle(),
        supabase.from("cuenta_usuarios").select("es_titular").eq("cuenta_id", cuenta.cuentaId).eq("usuario_id", user.id).maybeSingle(),
      ]);
      if (cuentaRow?.owner_usuario_id !== user.id && membresia?.es_titular !== true) {
        return NextResponse.json(
          { ok: false, error: "SOLO_TITULAR_CUENTA", detalle: "Solo la cuenta pagadora puede comprar personas adicionales" },
          { status: 403 },
        );
      }
      result = flowConfigurado()
        ? await comprarPersonaAdicionalFlow(cuenta.cuentaId)
        : await crearPersonaAdicionalCuenta(cuenta.cuentaId, usuario.empresa_id);
    } else {
      return NextResponse.json(
        { ok: false, error: "TIPO_INVALIDO", detalle: "tipo debe ser 'plan', 'refill' o 'persona_adicional'" },
        { status: 400 },
      );
    }

    if (!result.ok) {
      if (result.error === "MP_NO_CONFIGURADO" || result.error === "FLOW_NO_CONFIGURADO") {
        return NextResponse.json(
          { ok: false, error: "MP_NO_CONFIGURADO", detalle: "Pagos próximamente — escríbenos y activamos tu plan." },
          { status: 503 },
        );
      }
      const status =
        result.error === "PLAN_INVALIDO" ? 400 :
        result.error === "SIN_SUSCRIPCION_ACTIVA" || result.error === "ADDON_PENDIENTE" || result.error === "EQUIPO_NO_DISPONIBLE" || result.error === "SIN_TARJETA" ? 409 : 502;
      return NextResponse.json({ ok: false, error: result.error, detalle: result.detalle }, { status });
    }

    // Dos formas de éxito: redirección a pasarela (url) o cobro directo a la
    // tarjeta inscrita (cobrado) — el botón distingue por el campo.
    if ("url" in result) return NextResponse.json({ ok: true, url: result.url });
    return NextResponse.json({ ok: true, cobrado: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pagos/checkout]", msg);
    await recordOpsError({
      severity: "error",
      source: "pagos",
      eventName: "checkout_failed",
      summary: "No se pudo iniciar checkout",
      cuentaId: opsContext.cuentaId,
      empresaId: opsContext.empresaId,
      usuarioId: opsContext.usuarioId,
      error: err,
      metadata: { tipo: opsContext.tipo, plan: opsContext.plan },
    });
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO", detalle: msg }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
