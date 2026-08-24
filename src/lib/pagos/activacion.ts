/**
 * Activación de plan tras un pago — compartida por TODAS las pasarelas.
 *
 * Vivía dentro del webhook de Mercado Pago. Se sacó acá cuando entró Flow:
 * duplicar esto habría sido un bug esperando, porque el re-upgrade
 * multiempresa (revivir las empresas que un downgrade apagó, pero SOLO las
 * que apagó el downgrade y no las que apagó soporte) es fácil de copiar mal.
 * Una pasarela nueva no debe volver a escribir estas reglas: las importa.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { empresaPrincipalDeCuenta, empresasActivasDeCuenta } from "../entitlements";

type Sb = SupabaseClient<Database>;

export async function resolverTargetPago(sb: Sb, sujetoId: string): Promise<{ cuentaId: string | null; empresaId: string | null }> {
  const { data: cuenta } = await sb.from("cuentas").select("id").eq("id", sujetoId).maybeSingle();
  if (cuenta?.id) {
    return { cuentaId: cuenta.id, empresaId: await empresaPrincipalDeCuenta(sb, cuenta.id) };
  }

  const { data: cuentaEmpresa } = await sb
    .from("cuenta_empresas")
    .select("cuenta_id")
    .eq("empresa_id", sujetoId)
    .maybeSingle();
  return { cuentaId: cuentaEmpresa?.cuenta_id ?? null, empresaId: sujetoId };
}

export async function syncPlanActivo(sb: Sb, target: { cuentaId: string | null; empresaId: string | null }, plan: string, activo: boolean) {
  if (target.cuentaId) {
    const { error: cuentaError } = await sb
      .from("cuentas")
      .update({ plan_codigo: plan, plan_activo: activo, updated_at: new Date().toISOString() })
      .eq("id", target.cuentaId);
    if (cuentaError) throw new Error(`No se pudo actualizar la cuenta: ${cuentaError.message}`);

    // Re-upgrade a un plan multiempresa: las empresas desactivadas por el
    // downgrade (motivo 'fuera_de_plan') REVIVEN solas — sus datos nunca se
    // tocaron. Las desactivadas por soporte NO (motivo distinto). También se
    // limpia la marca de elección única: la próxima bajada vuelve a preguntar.
    if (activo) {
      const { data: planRow } = await sb
        .from("planes_config")
        .select("multiempresa")
        .eq("codigo", plan)
        .maybeSingle();
      if (planRow?.multiempresa === true) {
        await sb
          .from("cuenta_empresas")
          .update({ activa: true, desactivada_motivo: null })
          .eq("cuenta_id", target.cuentaId)
          .eq("activa", false)
          .eq("desactivada_motivo", "fuera_de_plan");
        await sb
          .from("cuentas")
          .update({ empresa_operativa_elegida_at: null })
          .eq("id", target.cuentaId);
      }
    }

    const empresaIds = await empresasActivasDeCuenta(sb, target.cuentaId);
    if (empresaIds.length > 0) {
      const { error: empresasError } = await sb.from("empresas").update({ plan_activo: activo, plan }).in("id", empresaIds);
      if (empresasError) throw new Error(`No se pudieron actualizar empresas de la cuenta: ${empresasError.message}`);
    }
    return;
  }
  if (target.empresaId) {
    const { error: empresaError } = await sb.from("empresas").update({ plan_activo: activo, plan }).eq("id", target.empresaId);
    if (empresaError) throw new Error(`No se pudo actualizar la empresa: ${empresaError.message}`);
  }
}
