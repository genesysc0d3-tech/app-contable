import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { chileDateString } from "@/lib/chile-date";
import { addDaysStr, clpConIva } from "@/lib/pagos/metering";
import { actualizarMontoSuscripcion, mpConfigurado, obtenerRecurso } from "@/lib/pagos/mercadopago";
import { getUfClp } from "@/lib/sii/uf";

/**
 * Cron diario de cobranza (vercel.json → 12:00 UTC ≈ 8-9 AM Chile):
 * (a) Suscripciones activas con periodo_hasta vencido hace más de 5 días
 *     (gracia) → estado 'morosa' + empresas.plan_activo = false.
 * (a2) Canceladas/pausadas con período vencido → apaga plan_activo
 *      (acceso hasta el fin del período ya pagado).
 * (b) El día 1 de cada mes (fecha Chile) re-ancla el monto mensual a la UF
 *     del día vía PUT /preapproval si difiere más de 1%.
 */

const GRACIA_DIAS = 5;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
  }

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const sb = createServiceClient<Database>(url, key);

    const hoy = chileDateString();
    const corte = addDaysStr(hoy, -GRACIA_DIAS);

    // (a) Activas vencidas (más allá de la gracia) → morosas, plan apagado.
    const { data: vencidas, error: vencErr } = await sb
      .from("suscripciones")
      .select("id, empresa_id")
      .eq("estado", "activa")
      .lt("periodo_hasta", corte);
    if (vencErr) throw new Error(`No se pudieron leer suscripciones vencidas: ${vencErr.message}`);

    let morosas = 0;
    for (const s of vencidas ?? []) {
      const { error: e1 } = await sb
        .from("suscripciones")
        .update({ estado: "morosa", updated_at: new Date().toISOString() })
        .eq("id", s.id);
      const { error: e2 } = await sb.from("empresas").update({ plan_activo: false }).eq("id", s.empresa_id);
      if (!e1 && !e2) morosas++;
    }

    // (a2) Canceladas/pausadas cuyo período pagado ya terminó → plan apagado
    // (solo si la empresa no tiene otra suscripción activa).
    const { data: terminadas } = await sb
      .from("suscripciones")
      .select("empresa_id")
      .in("estado", ["cancelada", "pausada"])
      .lt("periodo_hasta", hoy);
    let desactivadas = 0;
    const empresasTerminadas = [...new Set((terminadas ?? []).map((s) => s.empresa_id))];
    if (empresasTerminadas.length > 0) {
      const { data: conPlan } = await sb
        .from("empresas")
        .select("id")
        .in("id", empresasTerminadas)
        .eq("plan_activo", true);
      for (const emp of conPlan ?? []) {
        const { data: otraActiva } = await sb
          .from("suscripciones")
          .select("id")
          .eq("empresa_id", emp.id)
          .eq("estado", "activa")
          .limit(1)
          .maybeSingle();
        if (otraActiva) continue;
        const { error } = await sb.from("empresas").update({ plan_activo: false }).eq("id", emp.id);
        if (!error) desactivadas++;
      }
    }

    // (b) Día 1 del mes (Chile): re-anclar montos a la UF del día.
    let actualizadas = 0;
    if (hoy.endsWith("-01") && mpConfigurado()) {
      const uf = await getUfClp();
      const [{ data: activas }, { data: planes }] = await Promise.all([
        sb
          .from("suscripciones")
          .select("id, plan_codigo, proveedor_ref")
          .eq("estado", "activa")
          .not("proveedor_ref", "is", null),
        sb.from("planes_config").select("codigo, uf_mensual"),
      ]);
      const ufPorPlan = new Map((planes ?? []).map((p) => [p.codigo, p.uf_mensual]));

      for (const s of activas ?? []) {
        const ufMensual = ufPorPlan.get(s.plan_codigo);
        if (!ufMensual || !s.proveedor_ref) continue;
        const objetivo = clpConIva(ufMensual, uf);

        // Monto vigente real desde MP (no confiamos en caché local).
        const recurso = await obtenerRecurso("preapproval", s.proveedor_ref);
        const autoRec = (recurso?.auto_recurring ?? {}) as { transaction_amount?: unknown };
        const actual = typeof autoRec.transaction_amount === "number" ? autoRec.transaction_amount : null;
        if (actual === null || actual <= 0) continue;

        if (Math.abs(objetivo - actual) / actual > 0.01) {
          const upd = await actualizarMontoSuscripcion(s.proveedor_ref, objetivo);
          if (upd.ok) actualizadas++;
          else console.error("[pagos/cron] no se pudo actualizar monto", { suscripcion: s.id, detalle: upd.detalle });
        }
      }
    }

    return NextResponse.json({ ok: true, hoy, morosas, desactivadas, actualizadas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pagos/cron]", msg);
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO", detalle: msg }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
