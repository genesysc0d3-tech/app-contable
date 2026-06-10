"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

const HINTS_VALIDOS = new Set(["p2p_cripto", "forex_divisas", "servicios", "ventas", "mixto"]);

/**
 * Setea el tipo_operacion_hint de un documento. Se usa desde la lista de docs
 * en /subir para que el usuario marque una cartola como "toda P2P cripto",
 * "servicios", etc. El clasificador de tipo de boleta usa este hint como
 * señal fuerte.
 */
export async function setDocumentoHint(
  documentoId: string,
  hint: string | null,
): Promise<{ ok?: boolean; error?: string }> {
  if (hint !== null && !HINTS_VALIDOS.has(hint)) {
    return { error: `Hint inválido: ${hint}` };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);

  const { error, count } = await sb
    .from("documentos_subidos")
    .update({ tipo_operacion_hint: hint }, { count: "exact" })
    .eq("empresa_id", usuario.empresa_id)
    .eq("id", documentoId);

  if (error) return { error: error.message };
  if (!count) return { error: "Documento no encontrado o sin permisos" };

  revalidatePath("/subir");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}
