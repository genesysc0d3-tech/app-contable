"use server";

/**
 * Cancelar el plan desde la app — y volver atrás si te arrepientes.
 *
 * La página decía «cancela cuando quieras» y no había ningún botón: había que
 * escribirle a soporte. En Chile, lo contratado por internet se tiene que poder
 * terminar por internet y con la misma facilidad con que se contrató
 * (Ley 19.496). Afirmarlo sin tenerlo era peor que no decir nada.
 *
 * Dos decisiones que valen más que el código:
 *
 * 1. Se cancela AL TERMINAR EL PERÍODO. El mes ya está pagado; cortarlo al
 *    instante sería quedarse con la plata y el servicio. La suscripción sigue
 *    'activa' hasta la fecha y el cron la cierra ese día sin cobrar.
 * 2. Se puede DESHACER mientras no llegue la fecha. Cancelar por error, o
 *    cambiar de opinión el mismo día, no puede costar volver a contratar.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getUsuario } from "@/lib/dal";
import { contextoCuentaPorEmpresa } from "@/lib/entitlements";
import { recordOpsEvent } from "@/lib/ops/events";

type Resultado = { ok: true; hasta: string | null } | { error: string };

async function suscripcionDeLaCuenta(cancelar: boolean): Promise<Resultado> {
  const usuario = await getUsuario();
  if (!usuario) return { error: "Tienes que iniciar sesión." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Tienes que iniciar sesión." };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado." };
  const sb = createServiceClient<Database>(url, key);

  const cuenta = await contextoCuentaPorEmpresa(sb, usuario.empresa_id);
  if (!cuenta) return { error: "Tu empresa no tiene una cuenta de cobro configurada." };

  // Solo quien paga puede cancelar lo que paga. Un invitado del equipo no
  // decide por la cuenta.
  const { data: cuentaRow } = await sb
    .from("cuentas")
    .select("owner_usuario_id")
    .eq("id", cuenta.cuentaId)
    .maybeSingle();
  const { data: membresia } = await sb
    .from("cuenta_usuarios")
    .select("es_titular")
    .eq("cuenta_id", cuenta.cuentaId)
    .eq("usuario_id", user.id)
    .maybeSingle();
  if (cuentaRow?.owner_usuario_id !== user.id && membresia?.es_titular !== true) {
    return { error: "Solo quien paga la cuenta puede cancelar el plan." };
  }

  const { data: suscripcion } = await sb
    .from("suscripciones")
    .select("id, estado, periodo_hasta, plan_codigo")
    .eq("cuenta_id", cuenta.cuentaId)
    .eq("estado", "activa")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!suscripcion) return { error: "No hay una suscripción activa que cancelar." };

  const { error } = await sb
    .from("suscripciones")
    .update({ cancela_al_terminar: cancelar, updated_at: new Date().toISOString() })
    .eq("id", suscripcion.id);
  if (error) return { error: "No se pudo guardar el cambio. Intenta de nuevo." };

  await recordOpsEvent({
    sb,
    severity: "info",
    source: "pagos",
    eventName: cancelar ? "suscripcion_cancelada_por_cliente" : "cancelacion_revertida_por_cliente",
    summary: cancelar
      ? "El cliente pidió cancelar su plan; se cierra al terminar el período pagado"
      : "El cliente deshizo la cancelación de su plan",
    cuentaId: cuenta.cuentaId,
    empresaId: usuario.empresa_id,
    usuarioId: user.id,
    resourceType: "suscripcion",
    resourceId: suscripcion.id,
    metadata: { plan_codigo: suscripcion.plan_codigo, periodo_hasta: suscripcion.periodo_hasta },
  }).catch(() => {});

  revalidatePath("/planes");
  return { ok: true, hasta: suscripcion.periodo_hasta };
}

export async function cancelarPlan(): Promise<Resultado> {
  return suscripcionDeLaCuenta(true);
}

export async function deshacerCancelacion(): Promise<Resultado> {
  return suscripcionDeLaCuenta(false);
}
