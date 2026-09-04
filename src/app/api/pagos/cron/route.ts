import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { chileDateString } from "@/lib/chile-date";
import { addDaysStr, addOneMonth, clpConIva, periodoActual } from "@/lib/pagos/metering";
import { actualizarMontoSuscripcion, mpConfigurado, obtenerRecurso } from "@/lib/pagos/mercadopago";
import { cobrarCuenta, decidirReversaFlow, estadoPago, flowConfigurado, ordenDeCobro } from "@/lib/pagos/flow";
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
 * (c) Reconcilia contra Flow los cobros que dimos por buenos: si alguno se dio
 *     vuelta (contracargo/anulación), suspende la suscripción y apaga el plan.
 */

const GRACIA_DIAS = 5;
/**
 * Ventana de reconciliación de reversas. Un contracargo de tarjeta puede llegar
 * meses después del cobro, así que se mira más atrás que un ciclo mensual; el
 * tope por corrida evita que un mes cargado convierta el cron en una tormenta
 * de llamadas a Flow (se completa al día siguiente).
 */
const VENTANA_REVERSAS_DIAS = 120;
const TOPE_REVERSAS_POR_CORRIDA = 60;
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
        .select("id, cuenta_id, empresa_id, plan_codigo, plan_siguiente, estado, cancela_al_terminar")
        .eq("proveedor", "flow")
        .in("estado", ["activa", "morosa"])
        .lte("periodo_hasta", hoy);

      if ((porRenovar ?? []).length > 0) {
        const uf = await getUfClp();
        const { data: planes } = await sb.from("planes_config").select("codigo, nombre, uf_mensual");
        const porCodigo = new Map((planes ?? []).map((p) => [p.codigo, p]));

        for (const s of porRenovar ?? []) {
          // El cliente pidió cancelar: se le respetó el mes que ya había
          // pagado y hoy es el día de cierre. NO se cobra. Esto va ANTES de
          // cualquier cálculo de monto — cobrar y después cerrar sería
          // exactamente lo que la gente teme de las suscripciones.
          if (s.cancela_al_terminar) {
            await sb
              .from("suscripciones")
              .update({ estado: "cancelada", plan_siguiente: null, updated_at: new Date().toISOString() })
              .eq("id", s.id);
            if (s.cuenta_id) {
              await syncPlanActivo(sb, { cuentaId: s.cuenta_id, empresaId: s.empresa_id }, s.plan_codigo, false)
                .catch(() => {});
              await recordOpsEvent({
                sb,
                severity: "info",
                source: "pagos/cron",
                eventName: "suscripcion_cerrada_por_cancelacion",
                summary: "Terminó el período pagado de una suscripción cancelada: se cierra sin cobrar",
                cuentaId: s.cuenta_id,
                resourceType: "suscripcion",
                resourceId: s.id,
                metadata: { plan_codigo: s.plan_codigo },
              }).catch(() => {});
            }
            continue;
          }

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

    // ── (c) RECONCILIACIÓN DE REVERSAS DE FLOW ──────────────────────────────
    // Flow cobra de forma síncrona, así que no hay webhook que nos avise cuando
    // una orden se da vuelta después (contracargo, anulación). Hasta hoy eso no
    // llegaba por ningún lado: la suscripción seguía activa y el plan encendido
    // hasta el vencimiento — servicio gratis y sin alerta. Acá le preguntamos a
    // Flow, que es la fuente de verdad, por los cobros que damos por buenos.
    //
    // Va al final y con su propio try/catch: si la API de Flow no contesta, el
    // resto del cron (que sí cobra) ya se ejecutó.
    let reversas = 0;
    if (flowConfigurado()) {
      try {
        const desde = new Date(Date.now() - VENTANA_REVERSAS_DIAS * 86_400_000).toISOString();
        const { data: pagosFlow } = await sb
          .from("pagos")
          .select("id, cuenta_id, proveedor_ref, monto_clp, estado")
          .eq("proveedor", "flow")
          .eq("estado", "aprobado")
          .gte("created_at", desde)
          .order("created_at", { ascending: false })
          .limit(TOPE_REVERSAS_POR_CORRIDA);

        let consultados = 0;
        let sinRespuesta = 0;
        for (const pago of pagosFlow ?? []) {
          if (!pago.proveedor_ref) continue;
          consultados += 1;
          const enFlow = await estadoPago(pago.proveedor_ref);
          if (!enFlow) sinRespuesta += 1;
          // `estadoPago` devuelve null si la consulta falló: eso NO es una
          // reversa. decidirReversaFlow es deliberadamente desconfiada.
          if (decidirReversaFlow({ statusFlow: enFlow?.status, estadoLocal: pago.estado }) !== "revertir") continue;

          reversas += 1;
          await sb.from("pagos").update({ estado: "revertido", raw: enFlow as unknown as never }).eq("id", pago.id);

          // El plan se apaga: ese cobro ya no existe. La suscripción queda
          // 'morosa' (no 'cancelada') porque el cliente puede regularizar en
          // Planes — es el mismo estado que deja un cobro fallido.
          if (pago.cuenta_id) {
            await sb
              .from("suscripciones")
              .update({ estado: "morosa", updated_at: new Date().toISOString() })
              .eq("cuenta_id", pago.cuenta_id)
              .eq("estado", "activa");
            await apagarPlan(sb, { cuentaId: pago.cuenta_id });
          }

          await recordOpsEvent({
            sb,
            severity: "critical",
            source: "pagos/cron",
            eventName: "flow_pago_revertido",
            summary: `Un cobro de Flow se dio vuelta (${pago.monto_clp ?? "?"} CLP) — plan apagado y suscripción morosa`,
            resourceType: "pago",
            resourceId: pago.id,
            metadata: { flow_order: pago.proveedor_ref, cuenta_id: pago.cuenta_id, status_flow: enFlow?.status ?? null },
          });
        }

        // Un radar que no puede consultar NADA no es un radar tranquilo: es uno
        // apagado. Si Flow no contestó por ninguna orden (llaves malas, FLOW_ENV
        // apuntando al ambiente equivocado, API caída), hay que enterarse — si
        // no, la reconciliación "pasa" todos los días sin mirar nada.
        if (consultados > 0 && sinRespuesta === consultados) {
          await recordOpsEvent({
            sb,
            severity: "warn",
            source: "pagos/cron",
            eventName: "flow_reconciliacion_ciega",
            summary: `Flow no respondió por ninguna de las ${consultados} órdenes consultadas — revisar llaves y FLOW_ENV`,
            metadata: { consultados, ambiente: process.env.FLOW_ENV?.trim() ?? "sandbox" },
          });
        }
      } catch (err) {
        await recordOpsError({
          severity: "error",
          source: "pagos/cron",
          eventName: "flow_reconciliacion_fallo",
          summary: "No se pudo reconciliar reversas contra Flow (se reintenta mañana)",
          error: err,
        });
      }
    }

    return NextResponse.json({ ok: true, hoy, renovadas, cobrosFallidos, morosas, desactivadas, actualizadas, reversas });
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
