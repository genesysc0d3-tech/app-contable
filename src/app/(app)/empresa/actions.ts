"use server";

import { createHash, randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validarRut, cleanRut } from "@/lib/sii/validation";
import { contextoCuentaPorEmpresa } from "@/lib/entitlements";
import { recordCuentaAudit } from "@/lib/audit/account";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";

export interface DatosEmisor {
  rut?: string | null;
  razon_social?: string | null;
  giro?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  email_sii?: string | null;
  tipo_contribuyente?: string;
  /** Default de operación del contribuyente: semilla para auto-clasificar la 1ª
   *  cartola (p2p_cripto/forex_divisas/servicios/ventas/mixto). null = la IA decide. */
  operacion_hint_default?: string | null;
}

// Mismos valores que documentos_subidos.tipo_operacion_hint (DocumentoHint).
const HINTS_OPERACION_VALIDOS = new Set(["p2p_cripto", "forex_divisas", "servicios", "ventas", "mixto"]);

export type BoletasEmisionProveedor = "mock" | "sii_local" | "simpleapi";
export type FacturasEmisionProveedor = "mock" | "sii_local" | "simpleapi";
export type EmisionProveedor = BoletasEmisionProveedor | FacturasEmisionProveedor;

export interface EmisionConfigInput {
  boletasProveedor: BoletasEmisionProveedor;
  facturasProveedor: FacturasEmisionProveedor;
  baseapiSandbox: boolean;
}

const ROLES_INVITABLES = new Set(["admin", "contador", "viewer"]);
const ROLES_GESTION_MIEMBROS = new Set(["owner", "admin"]);
type Sb = SupabaseClient<Database>;

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: FormDataEntryValue | null): string {
  return String(email ?? "").trim().toLowerCase();
}

async function blockSupportWrite() {
  return getDevSupportWriteBlock();
}

async function capacidadEquipo(
  sb: Sb,
  empresaId: string,
): Promise<{ ok: true; cuentaId: string; limite: number; personasActivas: number } | { ok: false; error: string }> {
  const cuenta = await contextoCuentaPorEmpresa(sb, empresaId);
  if (!cuenta) return { ok: false, error: "La empresa no tiene cuenta pagadora configurada" };
  if (!cuenta.planActivo) return { ok: false, error: "Tu plan no está activo" };
  if (!cuenta.equipo) return { ok: false, error: "Equipo está disponible solo en Business" };

  const { data: addons, error: addonsError } = await sb
    .from("cuenta_addons")
    .select("cantidad")
    .eq("cuenta_id", cuenta.cuentaId)
    .eq("tipo", "persona_adicional")
    .eq("estado", "activo");
  if (addonsError) return { ok: false, error: addonsError.message };

  const extras = (addons ?? []).reduce((sum, addon) => sum + (addon.cantidad ?? 0), 0);
  return {
    ok: true,
    cuentaId: cuenta.cuentaId,
    limite: cuenta.personasIncluidas + extras,
    personasActivas: cuenta.personasActivas,
  };
}

async function verificarCupoAceptacion(
  sb: Sb,
  empresaId: string,
  userId: string,
): Promise<{ ok: true; cuentaId: string; yaActivo: boolean } | { ok: false; error: string }> {
  const capacidad = await capacidadEquipo(sb, empresaId);
  if (!capacidad.ok) return capacidad;
  const { data: miembro } = await sb
    .from("cuenta_usuarios")
    .select("activo")
    .eq("cuenta_id", capacidad.cuentaId)
    .eq("usuario_id", userId)
    .maybeSingle();
  if (miembro?.activo) return { ok: true, cuentaId: capacidad.cuentaId, yaActivo: true };
  if (capacidad.personasActivas >= capacidad.limite) {
    return { ok: false, error: "No quedan personas disponibles en el plan" };
  }
  return { ok: true, cuentaId: capacidad.cuentaId, yaActivo: false };
}

function inviteErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "SOLO_TITULAR_CUENTA":
      return "Solo la cuenta pagadora puede agregar personas";
    case "PLAN_INACTIVO":
      return "Tu plan no está activo";
    case "EQUIPO_NO_DISPONIBLE":
      return "Equipo está disponible solo en Business";
    case "CUPO_PERSONAS_AGOTADO":
      return "No quedan personas disponibles en el plan";
    case "EMAIL_YA_EN_CUENTA":
      return "Ese email ya pertenece al equipo";
    case "INVITACION_YA_EXISTE":
      return "Ya existe una invitación pendiente para ese email";
    case "EMAIL_INVALIDO":
      return "Email inválido";
    case "ROL_INVALIDO":
      return "Rol inválido";
    case "CUENTA_NO_CONFIGURADA":
      return "La empresa no tiene cuenta pagadora configurada";
    default:
      return code ? `No se pudo crear la invitación (${code})` : "No se pudo crear la invitación";
  }
}

export async function setDatosEmisor(
  datos: DatosEmisor,
): Promise<{ ok?: boolean; error?: string }> {
  const supportBlock = await blockSupportWrite();
  if (supportBlock) return supportBlock;

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
  const sb = createServiceClient<Database>(url, key);

  const update: Record<string, string | null> = {};
  if (datos.rut !== undefined) update.rut = datos.rut ? cleanRut(datos.rut) : null;
  if (datos.razon_social !== undefined) update.razon_social = datos.razon_social?.trim() ?? null;
  if (datos.giro !== undefined) update.giro = datos.giro?.trim() || null;
  if (datos.direccion !== undefined) update.direccion = datos.direccion?.trim() || null;
  if (datos.comuna !== undefined) update.comuna = datos.comuna?.trim() || null;
  if (datos.email_sii !== undefined) update.email_sii = datos.email_sii?.trim() || null;
  if (datos.tipo_contribuyente !== undefined) update.tipo_contribuyente = datos.tipo_contribuyente;
  if (datos.operacion_hint_default !== undefined) {
    const h = datos.operacion_hint_default;
    if (h !== null && !HINTS_OPERACION_VALIDOS.has(h)) {
      return { error: "Tipo de operación por defecto inválido" };
    }
    update.operacion_hint_default = h; // null = sin default (la IA decide)
  }

  const { error } = await sb
    .from("empresas")
    .update(update)
    .eq("id", usuario.empresa_id);

  if (error) {
    // 23505 = índice único empresas_rut_unico (RUT normalizado ya registrado).
    if (error.code === "23505" || error.message?.includes("duplicate key")) {
      return { error: "Ese RUT ya está registrado en otra cuenta." };
    }
    return { error: error.message };
  }

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
  const supportBlock = await blockSupportWrite();
  if (supportBlock) return supportBlock;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" };
  // Borrar el logo es editar la identidad del emisor: mismo gate que setDatosEmisor
  // (owner/admin) — un 'viewer' no debe poder borrarlo.
  if (!ROLES_GESTION_MIEMBROS.has(String(usuario.rol))) {
    return { error: "Tu rol no permite editar los datos de la empresa" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  const sb = createServiceClient<Database>(url, key);

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
  const supportBlock = await blockSupportWrite();
  if (supportBlock) return supportBlock;

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
  const sb = createServiceClient<Database>(url, key);

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
  const supportBlock = await blockSupportWrite();
  if (supportBlock) return supportBlock;

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
  if (config.facturasProveedor !== "mock" && config.facturasProveedor !== "sii_local" && config.facturasProveedor !== "simpleapi") {
    return { error: "Proveedor de facturas inválido" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  const sb = createServiceClient<Database>(url, key);

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

export interface FormatoCartolaGuardado {
  id: string;
  nombre: string | null;
  createdAt: string;
}

// Solo lectura: lista los formatos de cartola (parser_adapters) enseñados por la
// empresa del usuario. No hay columna "banco" en el schema: el nombre del formato
// (hoja detectada o "Formato manual") es lo que se muestra.
export async function listFormatosCartola(): Promise<{ ok?: boolean; formatos?: FormatoCartolaGuardado[]; error?: string }> {
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

  const { data, error } = await sb
    .from("parser_adapters")
    .select("id, nombre, created_at")
    .eq("creado_por_empresa_id", usuario.empresa_id)
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };

  return {
    ok: true,
    formatos: (data ?? []).map((f) => ({ id: f.id, nombre: f.nombre, createdAt: f.created_at })),
  };
}

export async function crearInvitacionEmpresa(formData: FormData): Promise<{ ok?: boolean; invitePath?: string; error?: string }> {
  const supportBlock = await blockSupportWrite();
  if (supportBlock) return supportBlock;

  const email = normalizeEmail(formData.get("email"));
  const rol = String(formData.get("rol") ?? "contador").trim();
  if (!email || !email.includes("@")) return { error: "Email inválido" };
  if (!ROLES_INVITABLES.has(rol)) return { error: "Rol inválido" };

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

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invitacionResult, error } = await sb.rpc("crear_empresa_invitacion_titular", {
    p_email: email,
    p_empresa_id: usuario.empresa_id,
    p_expires_at: expiresAt,
    p_invited_by: user.id,
    p_rol: rol,
    p_token_hash: tokenHash,
  });
  if (error) return { error: error.message };

  const result = invitacionResult?.[0];
  if (!result?.ok || !result.invitacion_id || !result.cuenta_id) {
    return { error: inviteErrorMessage(result?.error) };
  }

  await recordCuentaAudit({
    sb,
    cuentaId: result.cuenta_id,
    empresaId: usuario.empresa_id,
    usuarioId: user.id,
    accion: "persona_invitada",
    recursoTipo: "empresa_invitacion",
    recursoId: result.invitacion_id,
    resumen: "Persona invitada al equipo",
  });

  revalidatePath("/empresa");
  return { ok: true, invitePath: `/invitar/${token}` };
}

export async function aceptarInvitacionEmpresa(token: string): Promise<{ error?: string }> {
  const supportBlock = await blockSupportWrite();
  if (supportBlock) return supportBlock;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  const sb = createServiceClient<Database>(url, key);

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

  const cupoAceptacion = await verificarCupoAceptacion(sb, invitacion.empresa_id, user.id);
  if (!cupoAceptacion.ok) return { error: cupoAceptacion.error };

  if (existing?.empresa_id === invitacion.empresa_id) {
    if (cupoAceptacion.cuentaId) {
      const [{ error: cuentaUsuarioError }, { error: usuarioEmpresaError }] = await Promise.all([
        sb.from("cuenta_usuarios").upsert({
          cuenta_id: cupoAceptacion.cuentaId,
          usuario_id: user.id,
          activo: true,
          es_titular: false,
        }, { onConflict: "cuenta_id,usuario_id" }),
        sb.from("usuario_empresas").upsert({
          usuario_id: user.id,
          empresa_id: invitacion.empresa_id,
          rol: invitacion.rol,
        }, { onConflict: "usuario_id,empresa_id" }),
      ]);
      const membershipError = cuentaUsuarioError ?? usuarioEmpresaError;
      if (membershipError) return { error: membershipError.message };
    }
    await sb.from("empresa_invitaciones").update({
      estado: "aceptada",
      accepted_by: user.id,
      accepted_at: new Date().toISOString(),
    }).eq("id", invitacion.id);
    await recordCuentaAudit({
      sb,
      cuentaId: cupoAceptacion.cuentaId,
      empresaId: invitacion.empresa_id,
      usuarioId: user.id,
      accion: "persona_agregada",
      recursoTipo: "usuario",
      recursoId: user.id,
      resumen: "Persona agregada al equipo",
      metadata: { invitacion_id: invitacion.id },
    });
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

  if (cupoAceptacion.cuentaId) {
    const [{ error: cuentaUsuarioError }, { error: usuarioEmpresaError }] = await Promise.all([
      sb.from("cuenta_usuarios").upsert({
        cuenta_id: cupoAceptacion.cuentaId,
        usuario_id: user.id,
        activo: true,
        es_titular: false,
      }, { onConflict: "cuenta_id,usuario_id" }),
      sb.from("usuario_empresas").upsert({
        usuario_id: user.id,
        empresa_id: invitacion.empresa_id,
        rol: invitacion.rol,
      }, { onConflict: "usuario_id,empresa_id" }),
    ]);
    const membershipError = cuentaUsuarioError ?? usuarioEmpresaError;
    if (membershipError) {
      await sb.from("usuarios").delete().eq("id", user.id);
      return { error: membershipError.message };
    }
  }

  await sb.from("empresa_invitaciones").update({
    estado: "aceptada",
    accepted_by: user.id,
    accepted_at: new Date().toISOString(),
  }).eq("id", invitacion.id);

  await recordCuentaAudit({
    sb,
    cuentaId: cupoAceptacion.cuentaId,
    empresaId: invitacion.empresa_id,
    usuarioId: user.id,
    accion: "persona_agregada",
    recursoTipo: "usuario",
    recursoId: user.id,
    resumen: "Persona agregada al equipo",
    metadata: { invitacion_id: invitacion.id },
  });

  revalidatePath("/empresa");
  redirect("/");
}
