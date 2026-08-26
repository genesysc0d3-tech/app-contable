import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { chileDateString } from "@/lib/chile-date";
import { addDaysStr, addOneMonth, clpConIva, periodoActual } from "@/lib/pagos/metering";
import { actualizarMontoSuscripcion, mpConfigurado, obtenerRecurso } from "@/lib/pagos/mercadopago";
import { cobrarCuenta, flowConfigurado, ordenDeCobro } from "@/lib/pagos/flow";
import { syncPlanActivo } from "@/lib/pagos/activacion";
import { getUfClp } from "@/lib/sii/uf";
import { empresasActivasDeCuenta } from "@/lib/entitlements";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";

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
type Sb = SupabaseClient<Database>;

async function apagarPlan(sb: Sb, args: { cuentaId?: string | null; empresaId?: string | null }) {
  if (args.cuentaId) {
    const { error: cuentaError } = await sb
      .from("cuentas")
      .update({ plan_activo: false, updated_at: new Date().toISOString() })
      .eq("id", args.cuentaId);
    if (cuentaError) throw new Error(`No se pudo apagar la cuenta: ${cuentaError.message}`);
    const empresaIds = await empresasActivasDeCuenta(sb, args.cuentaId);
    if (empresaIds.length > 0) {
      const { error: empresasError } = await sb.from("empresas").update({ plan_activo: false }).in("id", empresaIds);
      if (empresasError) throw new Error(`No se pudieron apagar empresas de la cuenta: ${empresasError.message}`);
    }
    return;
  }
  if (args.empresaId) {
    const { error: empresaError } = await sb.from("empresas").update({ plan_activo: false }).eq("id", args.empresaId);
    if (empresaError) throw new Error(`No se pudo apagar la empresa: ${empresaError.message}`);
  }
}

async function tieneOtraSuscripcionActivaVigente(
  sb: Sb,
  args: { excluirId: string; cuentaId?: string | null; empresaId?: string | null; fechaMinima: string },
) {
  let query = sb
    .from("suscripciones")
    .select("id, periodo_hasta")
    .eq("estado", "activa")
    .neq("id", args.excluirId);
  query = args.cuentaId ? query.eq("cuenta_id", args.cuentaId) : query.eq("empresa_id", args.empresaId ?? "");
  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron revisar suscripciones activas: ${error.message}`);
  return (data ?? []).some((s) => !s.periodo_hasta || s.periodo_hasta >= args.fechaMinima);
}

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

    // (c) RENOVACIÓN FLOW — va ANTES de (a) a propósito: si hoy se logra
    // cobrar, la suscripción no debe marcarse morosa en la misma corrida.
    //
    // Flow no cobra solo (no usamos sus planes: congelan el precio y el nuestro
    // está en UF). El monto se calcula acá con la UF del día, la misma que va
    // en la factura que le emitimos al cliente.
    //
    // La ventana de gracia hace de ventana de reintento: se intenta todos los
    // días hasta que (a) la marque morosa. Y se reintentan TAMBIÉN las morosas,
    // porque con débito el caso normal es "no había saldo el día 28 y sí lo hay
    // el 30" — recuperarlas solas vale más que la prolijidad de no tocarlas.
    let renovadas = 0;
    let cobrosFallidos = 0;
    if (flowConfigurado()) {
      const { data: porRenovar } = await sb
        .from("suscripciones")
        .select("id, cuenta_id, empresa_id, plan_codigo, plan_siguiente, estado")
        .eq("proveedor", "flow")
        .in("estado", ["activa", "morosa"])
        .lte("periodo_hasta", hoy);

      if ((porRenovar ?? []).length > 0) {
        const uf = await getUfClp();
        const { data: planes } = await sb.from("planes_config").select("codigo, nombre, uf_mensual");
        const porCodigo = new Map((planes ?? []).map((p) => [p.codigo, p]));

        for (const s of porRenovar ?? []) {
          // Downgrade programado (modelo Anthropic): el plan barato entra
          // recién acá, en la renovación — el caro ya estaba pagado entero.
          const codigoACobrar = s.plan_siguiente ?? s.plan_codigo;
          const plan = porCodigo.get(codigoACobrar);
          if (!plan || !s.cuenta_id) continue;
          const montoClp = clpConIva(plan.uf_mensual, uf);
          const cobro = await cobrarCuenta(s.cuenta_id, {
            montoClp,
            concepto: `massDTE ${plan.nombre}`,
            orden: ordenDeCobro(s.cuenta_id, codigoACobrar, periodoActual()),
          });

          if (!cobro.ok && cobro.error !== "COBRO_YA_PAGADO") {
            cobrosFallidos++;
            await recordOpsEvent({
              sb,
              severity: "warn",
              source: "pagos/cron",
              eventName: "flow_renovacion_fallida",
              summary: "No se pudo cobrar la renovación mensual en Flow",
              cuentaId: s.cuenta_id,
              resourceType: "suscripcion",
              resourceId: s.id,
              metadata: { plan_codigo: codigoACobrar, monto_clp: montoClp, error: cobro.error, detalle: cobro.detalle },
            });
            continue;
          }

          await sb
            .from("suscripciones")
            .update({
              estado: "activa",
              plan_codigo: codigoACobrar,
              plan_siguiente: null,
              clp_ultimo_cobro: montoClp,
              periodo_hasta: addOneMonth(hoy),
              updated_at: new Date().toISOString(),
            })
            .eq("id", s.id);
          // Una morosa que se recupera necesita que le vuelvan a encender el
          // plan; una activa ya lo tiene y esto no le hace nada.
          await syncPlanActivo(sb, { cuentaId: s.cuenta_id, empresaId: s.empresa_id }, codigoACobrar, true);
          renovadas++;
        }
      }
    }

    // (a) Activas vencidas (más allá de la gracia) → morosas, plan apagado.
    const { data: vencidas, error: vencErr } = await sb
      .from("suscripciones")
      .select("id, empresa_id, cuenta_id")
      .eq("estado", "activa")
      .lt("periodo_hasta", corte);
    if (vencErr) throw new Error(`No se pudieron leer suscripciones vencidas: ${vencErr.message}`);

    let morosas = 0;
    for (const s of vencidas ?? []) {
      const otraActiva = await tieneOtraSuscripcionActivaVigente(sb, {
        excluirId: s.id,
        cuentaId: s.cuenta_id,
        empresaId: s.empresa_id,
        fechaMinima: corte,
      });
      const { error: e1 } = await sb
        .from("suscripciones")
        .update({ estado: "morosa", updated_at: new Date().toISOString() })
        .eq("id", s.id);
      if (!otraActiva) await apagarPlan(sb, { cuentaId: s.cuenta_id, empresaId: s.empresa_id });
      if (!e1) morosas++;
    }

    // (a2) Canceladas/pausadas cuyo período pagado ya terminó → plan apagado
    // (solo si la empresa no tiene otra suscripción activa).
    const { data: terminadas } = await sb
      .from("suscripciones")
      .select("empresa_id, cuenta_id")
      .in("estado", ["cancelada", "pausada"])
      .lt("periodo_hasta", hoy);
    let desactivadas = 0;
    const processed = new Set<string>();
    for (const s of terminadas ?? []) {
      const key = s.cuenta_id ?? s.empresa_id;
      if (!key || processed.has(key)) continue;
      processed.add(key);
      const otraActiva = await tieneOtraSuscripcionActivaVigente(sb, {
        excluirId: "00000000-0000-0000-0000-000000000000",
        cuentaId: s.cuenta_id,
        empresaId: s.empresa_id,
        fechaMinima: hoy,
      });
      if (otraActiva) continue;
      await apagarPlan(sb, { cuentaId: s.cuenta_id, empresaId: s.empresa_id });
      desactivadas++;
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
          else {
            console.error("[pagos/cron] no se pudo actualizar monto", { suscripcion: s.id, detalle: upd.detalle });
            await recordOpsEvent({
              sb,
              severity: "warn",
              source: "pagos/cron",
              eventName: "subscription_amount_update_failed",
              summary: "No se pudo actualizar monto mensual en Mercado Pago",
              resourceType: "suscripcion",
              resourceId: s.id,
              metadata: { plan_codigo: s.plan_codigo, objetivo_clp: objetivo, detalle: upd.detalle },
            });
          }
        }
      }
    }

    return NextResponse.json({ ok: true, hoy, renovadas, cobrosFallidos, morosas, desactivadas, actualizadas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pagos/cron]", msg);
    await recordOpsError({
      severity: "error",
      source: "pagos/cron",
      eventName: "billing_cron_failed",
      summary: "El cron de cobranza fallo",
      error: err,
    });
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO", detalle: msg }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
