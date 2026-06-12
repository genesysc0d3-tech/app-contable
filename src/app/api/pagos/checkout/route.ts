import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { crearRefill, crearSuscripcion } from "@/lib/pagos/mercadopago";

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
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const { data: usuario } = await supabase
      .from("usuarios")
      .select("empresa_id, rol")
      .eq("id", user.id)
      .single();
    if (!usuario?.empresa_id) {
      return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
    }
    if (!ROLES_PAGO.has(String(usuario.rol))) {
      return NextResponse.json(
        { ok: false, error: "ROL_SIN_PERMISO", detalle: "Solo el dueño o un admin pueden contratar planes" },
        { status: 403 },
      );
    }

    let body: { tipo?: string; plan?: string } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
    }

    let result;
    if (body.tipo === "plan") {
      const plan = typeof body.plan === "string" ? body.plan.trim() : "";
      if (!plan) return NextResponse.json({ ok: false, error: "PLAN_REQUERIDO" }, { status: 400 });
      result = await crearSuscripcion(usuario.empresa_id, plan, user.email ?? "");
    } else if (body.tipo === "refill") {
      result = await crearRefill(usuario.empresa_id);
    } else {
      return NextResponse.json(
        { ok: false, error: "TIPO_INVALIDO", detalle: "tipo debe ser 'plan' o 'refill'" },
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
        result.error === "SIN_SUSCRIPCION_ACTIVA" ? 409 : 502;
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
