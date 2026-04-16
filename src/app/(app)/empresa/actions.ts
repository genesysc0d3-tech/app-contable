"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { validarRut, cleanRut } from "@/lib/sii/validation";

export interface DatosEmisor {
  rut?: string | null;
  razon_social?: string | null;
  giro?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  email_sii?: string | null;
}

export async function setDatosEmisor(
  datos: DatosEmisor,
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

  if (datos.rut && !validarRut(datos.rut)) {
    return { error: "RUT inválido (falla dígito verificador)" };
  }
  if (datos.razon_social !== undefined && datos.razon_social !== null && !datos.razon_social.trim()) {
    return { error: "Razón social no puede estar vacía" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);

  const update: Record<string, string | null> = {};
  if (datos.rut !== undefined) update.rut = datos.rut ? cleanRut(datos.rut) : null;
  if (datos.razon_social !== undefined) update.razon_social = datos.razon_social?.trim() ?? null;
  if (datos.giro !== undefined) update.giro = datos.giro?.trim() || null;
  if (datos.direccion !== undefined) update.direccion = datos.direccion?.trim() || null;
  if (datos.comuna !== undefined) update.comuna = datos.comuna?.trim() || null;
  if (datos.email_sii !== undefined) update.email_sii = datos.email_sii?.trim() || null;

  const { error } = await sb
    .from("empresas")
    .update(update)
    .eq("id", usuario.empresa_id);

  if (error) return { error: error.message };

  revalidatePath("/empresa");
  revalidatePath("/escritorio");
  return { ok: true };
}

export async function solicitarCAFMock(
  tipo_dte: 39 | 41 | 61,
  cantidad: number,
): Promise<{ ok?: boolean; error?: string; folio_desde?: number; folio_hasta?: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" };

  if (![39, 41, 61].includes(tipo_dte)) return { error: "Tipo DTE inválido" };
  if (!Number.isInteger(cantidad) || cantidad < 10 || cantidad > 1000) {
    return { error: "Cantidad debe ser entera entre 10 y 1000" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);

  const { data: last } = await sb
    .from("boletas_caf_mock")
    .select("folio_hasta")
    .eq("empresa_id", usuario.empresa_id)
    .eq("tipo_dte", tipo_dte)
    .order("folio_hasta", { ascending: false })
    .limit(1)
    .maybeSingle();

  const folio_desde = ((last?.folio_hasta as number | undefined) ?? 0) + 1;
  const folio_hasta = folio_desde + cantidad - 1;

  const { error } = await sb
    .from("boletas_caf_mock")
    .insert({
      empresa_id: usuario.empresa_id,
      tipo_dte,
      folio_desde,
      folio_hasta,
      folio_actual: folio_desde,
      estado: "activo",
    });

  if (error) return { error: error.message };

  revalidatePath("/empresa");
  revalidatePath("/escritorio");
  return { ok: true, folio_desde, folio_hasta };
}
