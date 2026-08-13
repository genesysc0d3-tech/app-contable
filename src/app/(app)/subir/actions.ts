"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { revalidatePath } from "next/cache";
import { esMedioPagoValido } from "@/lib/sii/medios-pago";

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
  const sb = createServiceClient<Database>(url, key);

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

/**
 * Setea el método de pago de TODAS las boletas de un documento.
 *
 * El SII exige el método de pago en cada boleta; hoy solo se pide en las de
 * sobre 135 UF y el resto sale como "Efectivo" (fallback del worker). En una
 * cartola bancaria eso es incorrecto por definición: nada entra en efectivo
 * (caso real de beta: 65 boletas emitidas como efectivo siendo transferencias).
 * Una propuesta individual puede sobrescribirlo con su propio medio_pago.
 */
export async function setDocumentoMedioPago(
  documentoId: string,
  medioPago: string | null,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" };

  // Solo valores del selector del SII: un rótulo inventado haría abortar la
  // emisión en el portal (el worker falla cerrado si no encuentra la opción).
  const limpio = typeof medioPago === "string" ? medioPago.trim() : null;
  if (limpio && !esMedioPagoValido(limpio)) {
    return { error: "Método de pago no válido para el SII" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  const sb = createServiceClient<Database>(url, key);

  const { error, count } = await sb
    .from("documentos_subidos")
    .update({ medio_pago_comun: limpio || null }, { count: "exact" })
    .eq("empresa_id", usuario.empresa_id)
    .eq("id", documentoId);

  if (error) return { error: error.message };
  if (!count) return { error: "Documento no encontrado o sin permisos" };

  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}

/**
 * Setea la glosa común y el toggle de glosa de un documento. En MassDTE, todas
 * las boletas que se emitan desde este documento llevan esta glosa (mismo Excel
 * = misma glosa, ej. "P2P todo el día"). Si glosaActiva es false, se emiten sin
 * glosa. Máx 80 caracteres (límite del campo Detalle del SII).
 */
export async function setDocumentoGlosa(
  documentoId: string,
  glosaComun: string | null,
  glosaActiva: boolean,
): Promise<{ ok?: boolean; error?: string }> {
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
  const sb = createServiceClient<Database>(url, key);

  const glosa = typeof glosaComun === "string" ? glosaComun.trim().slice(0, 80) : null;
  const { error, count } = await sb
    .from("documentos_subidos")
    .update({ glosa_comun: glosa || null, glosa_activa: glosaActiva }, { count: "exact" })
    .eq("empresa_id", usuario.empresa_id)
    .eq("id", documentoId);

  if (error) return { error: error.message };
  if (!count) return { error: "Documento no encontrado o sin permisos" };

  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}
