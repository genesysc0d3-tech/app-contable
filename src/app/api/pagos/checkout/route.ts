import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crearPersonaAdicionalCuenta, crearRefillCuenta, crearSuscripcion } from "@/lib/pagos/mercadopago";
import { contextoCuentaPorEmpresa } from "@/lib/entitlements";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";

/**
 * Inicia un checkout de Mercado Pago:
 *   POST { tipo: 'plan', plan: 'start'|'pro'|'business' } → suscripción mensual
 *   POST { tipo: 'refill' }                               → pago único REFILL
 * Responde { ok, url } con el init_point para redirigir al pagador.
 */

// Contratar planes es un acto de cobro: solo owner/admin (viewer/contador no).
const ROLES_PAGO = new Set(["owner", "admin"]);

export async function POST(request: Request) {
  try {
    const supportBlock = await getDevSupportWriteBlock();
    if (supportBlock) return NextResponse.json({ ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: supportBlock.error }, { status: 403 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

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

    let body: { tipo?: string; plan?: string } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
    }

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

    let result;
    if (body.tipo === "plan") {
      const plan = typeof body.plan === "string" ? body.plan.trim() : "";
      if (!plan) return NextResponse.json({ ok: false, error: "PLAN_REQUERIDO" }, { status: 400 });
      result = await crearSuscripcion(cuenta.cuentaId, usuario.empresa_id, plan, user.email ?? "");
    } else if (body.tipo === "refill") {
      result = await crearRefillCuenta(cuenta.cuentaId, usuario.empresa_id);
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
      result = await crearPersonaAdicionalCuenta(cuenta.cuentaId, usuario.empresa_id);
    } else {
      return NextResponse.json(
        { ok: false, error: "TIPO_INVALIDO", detalle: "tipo debe ser 'plan', 'refill' o 'persona_adicional'" },
        { status: 400 },
      );
    }

    if (!result.ok) {
      if (result.error === "MP_NO_CONFIGURADO") {
        return NextResponse.json(
          { ok: false, error: "MP_NO_CONFIGURADO", detalle: "Pagos próximamente — escríbenos y activamos tu plan." },
          { status: 503 },
        );
      }
      const status =
        result.error === "PLAN_INVALIDO" ? 400 :
        result.error === "SIN_SUSCRIPCION_ACTIVA" || result.error === "ADDON_PENDIENTE" || result.error === "EQUIPO_NO_DISPONIBLE" ? 409 : 502;
      return NextResponse.json({ ok: false, error: result.error, detalle: result.detalle }, { status });
    }

    return NextResponse.json({ ok: true, url: result.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pagos/checkout]", msg);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO", detalle: msg }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
