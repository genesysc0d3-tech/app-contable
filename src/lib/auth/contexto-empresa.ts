/**
 * Guard de acceso COMPARTIDO de las acciones que tocan propuestas/reglas de la empresa
 * activa (Check en revisar/actions.ts y "Lo que aprendí"). Antes vivía dentro de
 * revisar/actions.ts; se movió acá sin cambiar su comportamiento (+ el corte de vetado)
 * para que toda pantalla nueva use EXACTAMENTE el mismo.
 *
 * Devuelve un cliente SERVICE ROLE: bypassa RLS, así que cada consulta del llamador
 * debe ir scopeada con .eq("empresa_id", empresaId).
 *
 * soloLectura: la acción no escribe nada si el modo soporte bloquea la escritura; en
 * ese caso igual entrega el contexto pero con puedeEscribir=false (el llamador NO debe
 * escribir: ni recalcular ni crear soportes).
 */
import { createClient } from "@/lib/supabase/server";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { getDevSupportMode, getDevSupportWriteBlock } from "@/lib/dev/support-mode";

export type ContextoEmpresa = {
  empresaId: string;
  userId: string;
  sb: SupabaseClient;
  soporte: boolean | null;
  puedeEscribir: boolean;
};

export async function getEmpresaAndService(opts: { soloLectura?: boolean } = {}): Promise<ContextoEmpresa | { error: string }> {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock && !opts.soloLectura) return supportBlock;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol, vetado")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" };
  // Vetado: corta también acá (no solo la navegación de la app).
  if ((usuario as { vetado?: boolean | null }).vetado === true) return { error: "Tu acceso está bloqueado" };

  // Aprobar/editar propuestas (y deshacer reglas) es un acto tributario: 'viewer' queda
  // fuera, igual que en las rutas de emisión (ROLES_EMISION).
  if (!ROLES_EMISION.has(String(usuario.rol))) {
    return { error: "Tu rol no permite esta acción" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };

  const sb = createServiceClient(url, key);
  return { empresaId: usuario.empresa_id, userId: user.id, sb, soporte: await enIntervencionDeSoporte(), puedeEscribir: !supportBlock };
}

/** ¿La escritura la hace un operador en una intervención de soporte autorizada?
 *  (getDevSupportWriteBlock ya la dejó pasar). Va al sello: decision_soporte.
 *  Sin la cookie de soporte no consulta la base. null = no se pudo saber. */
async function enIntervencionDeSoporte(): Promise<boolean | null> {
  try {
    const modo = await getDevSupportMode();
    return modo?.ok === true;
  } catch {
    return null;
  }
}
