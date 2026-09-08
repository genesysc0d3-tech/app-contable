"use server";

import { createHash, randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validarRut, cleanRut } from "@/lib/sii/validation";
import { contextoCuentaPorEmpresa, cuentaIdDeEmpresa, esTitularDeCuenta } from "@/lib/entitlements";
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
  /** Tipo por CARRIL (2026-09-04): una empresa puede tener el giro de boletas
   *  exento y el de facturas afecto. null/ausente = hereda tipo_contribuyente. */
  boletas_tipo_default?: string;
  facturas_tipo_default?: string;
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

/**
 * Guard de escritura de la configuración de empresa (fundador 2026-09-08):
 * solo el TITULAR de la cuenta a la que pertenece la empresa la configura.
 * `usuarios.rol` es global (un owner de SU cuenta sigue siendo "owner" cuando
 * está transportado al team de otro), así que el rol no basta: el gris del
 * botón era solo visual y por server action se podía escribir. Fail closed.
 */
async function soloTitular(sb: SupabaseClient<Database>, userId: string, empresaId: string): Promise<string | null> {
  const cuentaId = await cuentaIdDeEmpresa(sb, empresaId);
  if (!cuentaId) return "La empresa no tiene cuenta activa";
  if (!(await esTitularDeCuenta(sb, cuentaId, userId))) return "Solo el titular de la cuenta cambia la configuración de la empresa";
  return null;
}

/**
 * ¿Puede este usuario editar el emisor de `targetId` sin estar parado en ella?
 * (fundador 2026-09-07: las empresas de la cuenta se configuran desde el paso
 * Emisor del wizard, sin cambiar de mesa). Regla: la empresa destino cuelga de
 * la MISMA cuenta que la activa y el usuario es titular de esa cuenta. Fail
 * closed: cualquier duda = no.
 */
async function empresaDeMiCuentaComoTitular(
  sb: SupabaseClient<Database>,
  userId: string,
  activaId: string,
  targetId: string,
): Promise<boolean> {
  const [{ data: activa }, { data: target }] = await Promise.all([
    sb.from("cuenta_empresas").select("cuenta_id").eq("empresa_id", activaId).eq("activa", true).maybeSingle(),
    sb.from("cuenta_empresas").select("cuenta_id").eq("empresa_id", targetId).eq("activa", true).maybeSingle(),
  ]);
  if (!activa?.cuenta_id || !target?.cuenta_id || activa.cuenta_id !== target.cuenta_id) return false;
  const [{ data: cuenta }, { data: membresia }] = await Promise.all([
    sb.from("cuentas").select("owner_usuario_id").eq("id", target.cuenta_id).maybeSingle(),
    sb.from("cuenta_usuarios").select("es_titular").eq("cuenta_id", target.cuenta_id).eq("usuario_id", userId).eq("activo", true).maybeSingle(),
  ]);
  return cuenta?.owner_usuario_id === userId || membresia?.es_titular === true;
}

/** Datos del emisor de OTRA empresa de mi cuenta (para editarla desde el wizard). */
export async function datosEmisorDeEmpresa(empresaId: string): Promise<{ ok: true; datos: DatosEmisor; razon_social: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado" };
  const { data: usuario } = await supabase.from("usuarios").select("empresa_id").eq("id", user.id).single();
  if (!usuario?.empresa_id) return { ok: false, error: "Usuario sin empresa" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "Backend mal configurado" };
  const sb = createServiceClient<Database>(url, key);
  if (empresaId !== usuario.empresa_id && !(await empresaDeMiCuentaComoTitular(sb, user.id, usuario.empresa_id, empresaId))) {
    return { ok: false, error: "EMPRESA_NO_EDITABLE" };
  }
  const { data: e, error } = await sb
    .from("empresas")
    .select("rut, razon_social, giro, direccion, comuna, email_sii, tipo_contribuyente, boletas_tipo_default, facturas_tipo_default, operacion_hint_default")
    .eq("id", empresaId)
    .maybeSingle();
  if (error || !e) return { ok: false, error: error?.message ?? "NO_ENCONTRADA" };
  return {
    ok: true,
    razon_social: e.razon_social,
    datos: {
      rut: e.rut, razon_social: e.razon_social, giro: e.giro, direccion: e.direccion, comuna: e.comuna, email_sii: e.email_sii,
      tipo_contribuyente: e.tipo_contribuyente ?? "auto",
      boletas_tipo_default: e.boletas_tipo_default ?? undefined,
      facturas_tipo_default: e.facturas_tipo_default ?? undefined,
      operacion_hint_default: e.operacion_hint_default ?? null,
    },
  };
}

export async function setDatosEmisor(
  datos: DatosEmisor,
  /** Otra empresa de MI cuenta (wizard, paso Emisor). Ausente = la activa. */
  empresaId?: string,
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
  const empresaObjetivo = empresaId ?? usuario.empresa_id;

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
  const veto = await soloTitular(sb, user.id, empresaObjetivo);
  if (veto) return { error: veto };
  if (empresaObjetivo !== usuario.empresa_id && !(await empresaDeMiCuentaComoTitular(sb, user.id, usuario.empresa_id, empresaObjetivo))) {
    return { error: "Esa empresa no es de tu cuenta o no eres el titular" };
  }

  const update: Record<string, string | null> = {};
  if (datos.rut !== undefined) update.rut = datos.rut ? cleanRut(datos.rut) : null;
  if (datos.razon_social !== undefined) update.razon_social = datos.razon_social?.trim() ?? null;
  if (datos.giro !== undefined) update.giro = datos.giro?.trim() || null;
  if (datos.direccion !== undefined) update.direccion = datos.direccion?.trim() || null;
  if (datos.comuna !== undefined) update.comuna = datos.comuna?.trim() || null;
  if (datos.email_sii !== undefined) update.email_sii = datos.email_sii?.trim() || null;
  if (datos.tipo_contribuyente !== undefined) update.tipo_contribuyente = datos.tipo_contribuyente;
  // Allow-list explícita, igual que el resto: nada de spread del payload.
  const TIPOS_VALIDOS = new Set(["afecto", "exento", "auto"]);
  if (datos.boletas_tipo_default !== undefined && TIPOS_VALIDOS.has(datos.boletas_tipo_default)) {
    update.boletas_tipo_default = datos.boletas_tipo_default;
  }
  if (datos.facturas_tipo_default !== undefined && TIPOS_VALIDOS.has(datos.facturas_tipo_default)) {
    update.facturas_tipo_default = datos.facturas_tipo_default;
  }
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
    .eq("id", empresaObjetivo);

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
  const veto = await soloTitular(sb, user.id, usuario.empresa_id);
  if (veto) return { error: veto };

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
  const veto = await soloTitular(sb, user.id, usuario.empresa_id);
  if (veto) return { error: veto };

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
  const veto = await soloTitular(sb, user.id, usuario.empresa_id);
  if (veto) return { error: veto };

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

/** Empresas que recibe la persona al aceptar: las de la fila, o todas las activas de la cuenta si la fila no marcó ninguna. */
async function ticksParaInvitacion(sb: Sb, cuentaId: string, permitidas: string[] | null): Promise<string[]> {
  const { data: activas } = await sb
    .from("cuenta_empresas")
    .select("empresa_id, es_principal, created_at")
    .eq("cuenta_id", cuentaId)
    .eq("activa", true)
    .order("es_principal", { ascending: false })
    .order("created_at", { ascending: true });
  const ids = (activas ?? []).map((row) => row.empresa_id);
  if (!permitidas) return ids;
  // Solo las que SIGUEN activas en la cuenta: una empresa migrada entre la
  // invitación y la aceptación no se cuela.
  return ids.filter((id) => permitidas.includes(id));
}

async function sembrarTicks(sb: Sb, cuentaId: string, usuarioId: string, empresas: string[]): Promise<string | null> {
  const { error } = await sb
    .from("cuenta_usuario_empresas")
    .upsert(empresas.map((empresaId) => ({ cuenta_id: cuentaId, usuario_id: usuarioId, empresa_id: empresaId })), { onConflict: "cuenta_id,usuario_id,empresa_id" });
  return error ? error.message : null;
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
  return aceptarInvitacionPor({ tokenHash: hashInviteToken(token) });
}

/**
 * La invitación pendiente dirigida al correo de la sesión (para que el
 * onboarding ofrezca "Unirte al team" en vez de obligar a crear empresa).
 * Solo lectura; devuelve lo mínimo para pintar la tarjeta.
 */
export async function invitacionPendienteParaMi(): Promise<{ id: string; empresa: string; invitadoPor: string | null } | null> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    const sb = createServiceClient<Database>(url, key);
    const { data: inv } = await sb
      .from("empresa_invitaciones")
      .select("id, empresa_id, invited_by")
      .ilike("email", user.email)
      .eq("estado", "pendiente")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!inv) return null;
    const [{ data: emp }, { data: quien }] = await Promise.all([
      sb.from("empresas").select("razon_social").eq("id", inv.empresa_id).maybeSingle(),
      inv.invited_by ? sb.from("usuarios").select("nombre").eq("id", inv.invited_by).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return { id: inv.id, empresa: emp?.razon_social ?? "un team", invitadoPor: quien?.nombre ?? null };
  } catch {
    return null;
  }
}

/**
 * Unirse desde el onboarding a la invitación dirigida a MI correo. Misma
 * validación que por link (correo de la sesión = correo invitado, confirmado,
 * pendiente, vigente): el link solo agrega "tener el link", y acá la
 * invitación ya estaba dirigida a este correo.
 */
export async function unirseAlTeamPendiente(invitacionId: string): Promise<{ error?: string }> {
  const id = String(invitacionId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invitación no encontrada" };
  return aceptarInvitacionPor({ id });
}

async function aceptarInvitacionPor(buscar: { tokenHash: string } | { id: string }): Promise<{ error?: string }> {
  const supportBlock = await blockSupportWrite();
  if (supportBlock) return supportBlock;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" };
  const sb = createServiceClient<Database>(url, key);

  let q = sb
    .from("empresa_invitaciones")
    .select("id, empresa_id, email, rol, estado, expires_at, empresas_permitidas");
  q = "tokenHash" in buscar ? q.eq("token_hash", buscar.tokenHash) : q.eq("id", buscar.id);
  const { data: invitacion, error: invError } = await q.maybeSingle();

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
  // "Colaboras en" (2026-09-06): tener cuenta propia ya no impide unirse a un
  // team ajeno. Se agrega la membresía + ticks y NO se le mueve la empresa
  // activa: sigue parado en su casa y entra a colaborar desde el popup.
  if (existing?.vetado) return { error: "Esta cuenta está suspendida" };

  const cupoAceptacion = await verificarCupoAceptacion(sb, invitacion.empresa_id, user.id);
  if (!cupoAceptacion.ok) return { error: cupoAceptacion.error };

  // Ticks del team (2026-09-06): se copian de la FILA de la invitación, jamás
  // del request. NULL = todas las empresas activas de la cuenta al aceptar.
  // Sin tick la base no deja ver nada (empresa_autorizada), así que la persona
  // aterriza parada en una empresa que SÍ ve.
  const ticks = await ticksParaInvitacion(sb, cupoAceptacion.cuentaId, invitacion.empresas_permitidas);
  if (ticks.length === 0) return { error: "La invitación no tiene empresas asignadas. Pide una nueva." };
  const empresaInicial = ticks.includes(invitacion.empresa_id) ? invitacion.empresa_id : ticks[0];

  if (existing) {
    if (cupoAceptacion.cuentaId) {
      const { error: membershipError } = await sb.from("cuenta_usuarios").upsert({
        cuenta_id: cupoAceptacion.cuentaId,
        usuario_id: user.id,
        activo: true,
        es_titular: false,
      }, { onConflict: "cuenta_id,usuario_id" });
      if (membershipError) return { error: membershipError.message };
      const ticksError = await sembrarTicks(sb, cupoAceptacion.cuentaId, user.id, ticks);
      if (ticksError) return { error: ticksError };
      // Solo se lo mueve si NO tiene dónde estar parado (usuario sin empresa
      // propia que ya existía en `usuarios`); con casa propia, se queda en casa.
      if (!existing.empresa_id) {
        await sb.from("usuarios").update({ empresa_id: empresaInicial }).eq("id", user.id);
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

  const nombre = user.user_metadata?.nombre || user.user_metadata?.full_name || user.email || "Usuario";
  const { error: insertError } = await sb.from("usuarios").insert({
    id: user.id,
    email: user.email!,
    nombre,
    empresa_id: empresaInicial,
    rol: invitacion.rol,
  });
  if (insertError) return { error: insertError.message };

  if (cupoAceptacion.cuentaId) {
    const { error: membershipError } = await sb.from("cuenta_usuarios").upsert({
      cuenta_id: cupoAceptacion.cuentaId,
      usuario_id: user.id,
      activo: true,
      es_titular: false,
    }, { onConflict: "cuenta_id,usuario_id" });
    if (membershipError) {
      await sb.from("usuarios").delete().eq("id", user.id);
      return { error: membershipError.message };
    }
    const ticksError = await sembrarTicks(sb, cupoAceptacion.cuentaId, user.id, ticks);
    if (ticksError) {
      await sb.from("cuenta_usuarios").delete().eq("cuenta_id", cupoAceptacion.cuentaId).eq("usuario_id", user.id);
      await sb.from("usuarios").delete().eq("id", user.id);
      return { error: ticksError };
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
