import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { contextoCuentaPorEmpresa } from "@/lib/entitlements";

type Sb = SupabaseClient<Database>;

export type CuentaAuditAction =
  | "empresa_activa_cambiada"
  | "empresa_adicional_creada"
  | "empresa_operativa_elegida"
  | "empresa_migrada_entrante"
  | "empresa_migrada_saliente"
  | "persona_invitada"
  | "persona_agregada"
  | "propuesta_aprobada"
  | "propuestas_aprobadas"
  | "emision_autorizacion_aceptada"
  | "boleta_emitida"
  | "emision_fallida"
  | "modo_soporte_entrado"
  | "modo_soporte_salido"
  | "documento_eliminado"
  | "documento_deshecho"
  | "documento_cancelado"
  | "plan_cambiado_dev"
  | "trial_cortesia_cambiado";

export async function recordCuentaAudit(args: {
  sb: Sb;
  cuentaId?: string | null;
  empresaId?: string | null;
  usuarioId?: string | null;
  accion: CuentaAuditAction;
  recursoTipo?: string | null;
  recursoId?: string | null;
  resumen: string;
  metadata?: Record<string, Json>;
}) {
  try {
    const cuentaId = args.cuentaId ?? (args.empresaId ? (await contextoCuentaPorEmpresa(args.sb, args.empresaId))?.cuentaId : null);
    if (!cuentaId) return;

    const metadata: Record<string, Json> = {};
    for (const [key, value] of Object.entries(args.metadata ?? {})) {
      if (value === undefined) continue;
      metadata[key] = value;
    }

    const { error } = await args.sb.from("cuenta_audit_events").insert({
      cuenta_id: cuentaId,
      empresa_id: args.empresaId ?? null,
      usuario_id: args.usuarioId ?? null,
      accion: args.accion,
      recurso_tipo: args.recursoTipo ?? null,
      recurso_id: args.recursoId ?? null,
      resumen: args.resumen,
      metadata,
    });
    if (error) console.warn("[cuenta-audit] insert fallo:", error.message);
  } catch (error) {
    console.warn("[cuenta-audit] no se pudo registrar evento:", error instanceof Error ? error.message : String(error));
  }
}
