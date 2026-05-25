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
  tipo_contribuyente?: string;
  logo_storage_path?: string | null;
  logo_mime_type?: string | null;
}

const LOGO_MIME_TYPES = new Set([
  "image/png",
  "image/svg+xml",
  "image/webp",
  "image/gif",
  "image/jpeg",
]);

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
  if (datos.tipo_contribuyente !== undefined) update.tipo_contribuyente = datos.tipo_contribuyente;

  const { error } = await sb
    .from("empresas")
    .update(update)
    .eq("id", usuario.empresa_id);

  if (error) return { error: error.message };

  revalidatePath("/empresa");
  revalidatePath("/escritorio");
  revalidatePath("/escritorio/v5");
  return { ok: true };
}

export async function setEmpresaLogo(
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { error: "Selecciona una imagen" };
  if (!LOGO_MIME_TYPES.has(file.type)) return { error: "Formato no soportado. Usa PNG, SVG, WebP, GIF o JPG" };
  if (file.size > 2 * 1024 * 1024) return { error: "El logo no puede superar 2MB" };

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

  const ext = file.type === "image/svg+xml" ? "svg" : (file.name.split(".").pop() || "png").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const storagePath = `${usuario.empresa_id}/logos/logo-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await sb.storage
    .from("documentos")
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });
  if (uploadError) return { error: uploadError.message };

  const { data: empresaActual } = await sb
    .from("empresas")
    .select("logo_storage_path")
    .eq("id", usuario.empresa_id)
    .single();

  const { error } = await sb
    .from("empresas")
    .update({ logo_storage_path: storagePath, logo_mime_type: file.type })
    .eq("id", usuario.empresa_id);
  if (error) return { error: error.message };

  if (empresaActual?.logo_storage_path && empresaActual.logo_storage_path !== storagePath) {
    await sb.storage.from("documentos").remove([empresaActual.logo_storage_path]);
  }

  revalidatePath("/empresa");
  revalidatePath("/escritorio");
  revalidatePath("/escritorio/v5");
  return { ok: true };
}

export async function setCertificadoSii(
  activo: boolean,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);

  const { error } = await sb
    .from("empresas")
    .update({ tiene_certificado_sii: activo })
    .eq("id", usuario.empresa_id);
  if (error) return { error: error.message };

  revalidatePath("/empresa");
  revalidatePath("/escritorio");
  return { ok: true };
}
