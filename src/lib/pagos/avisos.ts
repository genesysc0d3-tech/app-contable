/**
 * Avisos de contratación: uno al cliente (qué contrató) y uno interno a
 * cobros@ (quién contrató qué). Fail-open completo: cualquier caída queda en
 * ops_events como warn y el flujo de pago sigue como si nada.
 */
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { CORREO_COBROS, enviarCorreo, plantillaAvisoContratacion, plantillaPlanContratado } from "../correo";
import { recordOpsEvent } from "../ops/events";

export async function avisarContratacion(cuentaId: string, planCodigo: string, montoClp: number): Promise<void> {
  try {
    const db = createServiceClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const [{ data: cuenta }, { data: plan }, { data: sus }] = await Promise.all([
      db.from("cuentas").select("owner_usuario_id").eq("id", cuentaId).maybeSingle(),
      db.from("planes_config").select("nombre").eq("codigo", planCodigo).maybeSingle(),
      db.from("suscripciones").select("periodo_hasta").eq("cuenta_id", cuentaId).eq("estado", "activa").maybeSingle(),
    ]);
    const { data: usuario } = cuenta?.owner_usuario_id
      ? await db.from("usuarios").select("nombre, email").eq("id", cuenta.owner_usuario_id).maybeSingle()
      : { data: null };

    const planNombre = plan?.nombre ?? planCodigo;
    const resultados: string[] = [];

    if (usuario?.email) {
      const m = plantillaPlanContratado({ planNombre, montoClp, hastaFecha: sus?.periodo_hasta ?? "" });
      const r = await enviarCorreo({ para: usuario.email, asunto: m.asunto, html: m.html });
      if (!r.ok) resultados.push(`cliente: ${r.detalle}`);
    } else {
      resultados.push("cliente: cuenta sin correo de dueño");
    }

    const a = plantillaAvisoContratacion({
      clienteNombre: usuario?.nombre ?? "Cliente sin nombre",
      clienteEmail: usuario?.email ?? "(sin correo)",
      planNombre,
      montoClp,
    });
    const ri = await enviarCorreo({ para: CORREO_COBROS, asunto: a.asunto, html: a.html });
    if (!ri.ok) resultados.push(`interno: ${ri.detalle}`);

    if (resultados.length > 0) {
      await recordOpsEvent({
        severity: "warn",
        source: "pagos/flow",
        eventName: "aviso_contratacion_incompleto",
        summary: "Plan activado pero algún correo de aviso no salió",
        cuentaId,
        metadata: { fallas: resultados },
      });
    }
  } catch {
    // Fail-open hasta el final: ni siquiera el registro del warn puede romper.
  }
}
