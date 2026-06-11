"use server";

import { createHash, randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validarRut, cleanRut } from "@/lib/sii/validation";

export interface DatosEmisor {
  rut?: string | null;
  razon_social?: string | null;
  giro?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  email_sii?: string | null;
  tipo_contribuyente?: string;
}

export type BoletasEmisionProveedor = "mock" | "sii_local" | "simpleapi";
export type FacturasEmisionProveedor = "mock" | "simpleapi";
export type EmisionProveedor = BoletasEmisionProveedor | FacturasEmisionProveedor;

export interface EmisionConfigInput {
  boletasProveedor: BoletasEmisionProveedor;
  facturasProveedor: FacturasEmisionProveedor;
  baseapiSandbox: boolean;
}

const ROLES_INVITABLES = new Set(["admin", "contador", "viewer"]);
const ROLES_GESTION_MIEMBROS = new Set(["owner", "admin"]);

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: FormDataEntryValue | null): string {
  return String(email ?? "").trim().toLowerCase();
}

export async function setDatosEmisor(
  datos: DatosEmisor,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" };
  if (!ROLES_GESTION_MIEMBROS.has(String(usuario.rol))) {
    return { error: "Solo owner/admin puede cambiar los datos fiscales del emisor" };
  }

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
  revalidatePath("/massdte");
  return { ok: true };
}

// La subida de logo vive SOLO en /api/empresa/upload-logo (multipart). Antes
// había una server action gemela (setEmpresaLogo) sin callers — eliminada para
// no mantener dos caminos que derivan extensión/bucket distinto.

export async function removeEmpresaLogo(): Promise<{ ok?: boolean; error?: string }> {
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

  const logoDir = `${usuario.empresa_id}/logos`;
  const { data: oldFiles } = await sb.storage.from("documentos").list(logoDir);
  if (oldFiles?.length) {
    const { error } = await sb.storage.from("documentos").remove(oldFiles.map((oldFile: { name: string }) => `${logoDir}/${oldFile.name}`));
    if (error) return { error: error.message };
  }

  revalidatePath("/empresa");
  revalidatePath("/escritorio");
  revalidatePath("/escritorio/v5");
  revalidatePath("/massdte");
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
    .select("empresa_id, rol")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" };
  if (!ROLES_GESTION_MIEMBROS.has(String(usuario.rol))) {
    return { error: "Solo owner/admin puede cambiar la configuración fiscal" };
  }

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
  revalidatePath("/escritorio/v5");
  revalidatePath("/massdte");
  return { ok: true };
}

export async function setEmisionConfig(
  config: EmisionConfigInput,
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" };
  if (!ROLES_GESTION_MIEMBROS.has(String(usuario.rol))) {
    return { error: "Solo owner/admin puede cambiar el proveedor de emisión" };
  }

  if (config.boletasProveedor !== "mock" && config.boletasProveedor !== "sii_local" && config.boletasProveedor !== "simpleapi") {
    return { error: "Proveedor de boletas inválido" };
  }
  if (config.facturasProveedor !== "mock" && config.facturasProveedor !== "simpleapi") {
    return { error: "Proveedor de facturas inválido" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);

  const { error } = await sb
    .from("empresas")
    .update({
      emision_proveedor: config.boletasProveedor,
      boletas_emision_proveedor: config.boletasProveedor,
      facturas_emision_proveedor: config.facturasProveedor,
      emision_baseapi_sandbox: config.baseapiSandbox,
    })
    .eq("id", usuario.empresa_id);
  if (error) {
    const message = String(error.message || "");
    if (/emision_proveedor|boletas_emision_proveedor|facturas_emision_proveedor|emision_baseapi_sandbox|column|check constraint|violates check/i.test(message)) {
      return { error: "La base de datos aún no tiene aplicada la migración de proveedores combinados. Mantén Modo de prueba por ahora y aplica las migraciones." };
    }
    return { error: message };
  }

  revalidatePath("/empresa");
  revalidatePath("/escritorio");
  revalidatePath("/escritorio/v5");
  revalidatePath("/massdte");
  return { ok: true };
}

export async function crearInvitacionEmpresa(formData: FormData): Promise<{ ok?: boolean; invitePath?: string; error?: string }> {
  const email = normalizeEmail(formData.get("email"));
  const rol = String(formData.get("rol") ?? "contador").trim();
  if (!email || !email.includes("@")) return { error: "Email inválido" };
  if (!ROLES_INVITABLES.has(rol)) return { error: "Rol inválido" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" };
  if (!ROLES_GESTION_MIEMBROS.has(usuario.rol)) return { error: "Solo owner/admin puede invitar usuarios" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);

  const { data: miembroExistente } = await sb
    .from("usuarios")
    .select("id")
    .eq("empresa_id", usuario.empresa_id)
    .ilike("email", email)
    .maybeSingle();
  if (miembroExistente?.id) return { error: "Ese email ya pertenece a la empresa" };

  const { data: invitacionPendiente } = await sb
    .from("empresa_invitaciones")
    .select("id")
    .eq("empresa_id", usuario.empresa_id)
    .eq("estado", "pendiente")
    .ilike("email", email)
    .maybeSingle();
  if (invitacionPendiente?.id) return { error: "Ya existe una invitación pendiente para ese email" };

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await sb.from("empresa_invitaciones").insert({
    empresa_id: usuario.empresa_id,
    email,
    rol,
    token_hash: tokenHash,
    invited_by: user.id,
    expires_at: expiresAt,
  });
  if (error) return { error: error.message };

  revalidatePath("/empresa");
  return { ok: true, invitePath: `/invitar/${token}` };
}

export async function aceptarInvitacionEmpresa(token: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb: any = createServiceClient(url, key);

  const tokenHash = hashInviteToken(token);
  const { data: invitacion, error: invError } = await sb
    .from("empresa_invitaciones")
    .select("id, empresa_id, email, rol, estado, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (invError) return { error: invError.message };
  if (!invitacion) return { error: "Invitación no encontrada" };
  if (invitacion.estado !== "pendiente") return { error: "Invitación ya no está pendiente" };
  if (new Date(invitacion.expires_at).getTime() < Date.now()) return { error: "Invitación expirada" };
  if (String(user.email ?? "").toLowerCase() !== String(invitacion.email).toLowerCase()) {
    return { error: "Debes iniciar sesión con el email invitado" };
  }
  if (!user.email_confirmed_at && !user.confirmed_at) {
    return { error: "Confirma tu email antes de aceptar la invitación" };
  }

  const { data: existing } = await sb
    .from("usuarios")
    .select("empresa_id, vetado, rol")
    .eq("id", user.id)
    .maybeSingle();
  if (existing?.empresa_id && existing.empresa_id !== invitacion.empresa_id) {
    return { error: "Este usuario ya pertenece a otra empresa. El selector multiempresa queda para la siguiente fase." };
  }
  if (existing?.vetado) return { error: "Esta cuenta está suspendida" };

  if (existing?.empresa_id === invitacion.empresa_id) {
    await sb.from("empresa_invitaciones").update({
      estado: "aceptada",
      accepted_by: user.id,
      accepted_at: new Date().toISOString(),
    }).eq("id", invitacion.id);
    revalidatePath("/empresa");
    redirect("/");
  }

  const nombre = user.user_metadata?.nombre || user.user_metadata?.full_name || user.email || "Usuario";
  const { error: insertError } = await sb.from("usuarios").insert({
    id: user.id,
    email: user.email!,
    nombre,
    empresa_id: invitacion.empresa_id,
    rol: invitacion.rol,
  });
  if (insertError) return { error: insertError.message };

  await sb.from("empresa_invitaciones").update({
    estado: "aceptada",
    accepted_by: user.id,
    accepted_at: new Date().toISOString(),
  }).eq("id", invitacion.id);

  revalidatePath("/empresa");
  redirect("/");
}
