/**
 * Sesión conversacional del bot de Telegram.
 *
 * Antes el bot procesaba la foto y RECIÉN ahí preguntaba (empresa, tipo). Eso
 * obligaba a inferir qué fotos van juntas mirando el `media_group_id` que arma
 * Telegram, que depende de si el usuario las seleccionó de una o las mandó una
 * por una — cosa que el usuario ni nota.
 *
 * Ahora se pregunta PRIMERO:
 *
 *   hola → [empresa] → [boleta|factura] → imágenes → propuesta
 *
 * La sesión es el contenedor EXPLÍCITO de un comprobante: todo lo que llega
 * mientras está abierta pertenece a él porque el usuario lo dijo, no porque lo
 * adivinemos. Una foto sin sesión abierta no se procesa (ni OCR ni storage).
 *
 * Una sesión viva por chat (chat_id es la PK): abrir otra reemplaza la anterior.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";

type Svc = SupabaseClient<Database>;

/** Igual que los pendientes de hoy: sin esto alguien elige el lunes y manda la foto el jueves. */
export const SESION_TTL_MS = 15 * 60 * 1000;

export type MesaSesion = "boleta" | "factura";
export type EstadoSesion = "eligiendo_empresa" | "eligiendo_mesa" | "esperando_fotos" | "procesando";

export interface EmpresaOpcion {
  id: string;
  rut: string | null;
  nombre: string | null;
}

export interface Sesion {
  chat_id: number;
  token: string;
  empresa_id: string | null;
  mesa: MesaSesion | null;
  estado: EstadoSesion;
  opciones: EmpresaOpcion[];
  documento_id: string | null;
  message_id: number | null;
  expires_at: string;
}

function nuevoToken(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function vencimiento(): string {
  return new Date(Date.now() + SESION_TTL_MS).toISOString();
}

export function parseOpcionesSesion(value: Json | null): EmpresaOpcion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const o = raw as Record<string, unknown>;
    return typeof o.id === "string"
      ? [{
          id: o.id,
          rut: typeof o.rut === "string" ? o.rut : null,
          nombre: typeof o.nombre === "string" ? o.nombre : null,
        }]
      : [];
  });
}

function aSesion(row: {
  chat_id: number;
  token: string;
  empresa_id: string | null;
  mesa: string | null;
  estado: string;
  opciones: Json;
  documento_id: string | null;
  message_id: number | null;
  expires_at: string;
}): Sesion {
  return {
    chat_id: row.chat_id,
    token: row.token,
    empresa_id: row.empresa_id,
    mesa: row.mesa === "boleta" || row.mesa === "factura" ? row.mesa : null,
    estado: row.estado as EstadoSesion,
    opciones: parseOpcionesSesion(row.opciones),
    documento_id: row.documento_id,
    message_id: row.message_id,
    expires_at: row.expires_at,
  };
}

const CAMPOS =
  "chat_id, token, empresa_id, mesa, estado, opciones, documento_id, message_id, expires_at";

/**
 * Abre una sesión nueva (reemplaza la que hubiera). `opciones` son las empresas
 * a mostrar: con una sola igual se muestra el botón (decisión de producto — el
 * paso es el mismo siempre).
 */
export async function abrirSesion(
  svc: Svc,
  chatId: number,
  opciones: EmpresaOpcion[],
): Promise<Sesion | null> {
  const { data, error } = await svc
    .from("telegram_sesiones")
    .upsert(
      {
        chat_id: chatId,
        token: nuevoToken(),
        empresa_id: null,
        mesa: null,
        estado: "eligiendo_empresa",
        opciones: opciones as unknown as Json,
        documento_id: null,
        message_id: null,
        expires_at: vencimiento(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" },
    )
    .select(CAMPOS)
    .single();
  if (error || !data) return null;
  return aSesion(data);
}

/** La sesión viva del chat, o null si no hay o ya venció. */
export async function sesionDe(svc: Svc, chatId: number): Promise<Sesion | null> {
  const { data } = await svc
    .from("telegram_sesiones")
    .select(CAMPOS)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return aSesion(data);
}

/** Guarda el message_id del menú, para poder editarlo en vez de mandar otro. */
export async function recordarMensaje(svc: Svc, chatId: number, messageId: number): Promise<void> {
  await svc
    .from("telegram_sesiones")
    .update({ message_id: messageId, updated_at: new Date().toISOString() })
    .eq("chat_id", chatId);
}

/**
 * Paso 1 → 2. El callback manda el ÍNDICE de la opción, no el uuid: la data de
 * un callback de Telegram topa en 64 bytes y no cabe con holgura.
 */
export async function elegirEmpresa(
  svc: Svc,
  chatId: number,
  token: string,
  indice: number,
): Promise<{ sesion: Sesion; empresa: EmpresaOpcion } | null> {
  const actual = await sesionDe(svc, chatId);
  if (!actual || actual.token !== token) return null;
  const empresa = actual.opciones[indice];
  if (!empresa) return null;

  const { data, error } = await svc
    .from("telegram_sesiones")
    .update({
      empresa_id: empresa.id,
      estado: "eligiendo_mesa",
      expires_at: vencimiento(),
      updated_at: new Date().toISOString(),
    })
    .eq("chat_id", chatId)
    .eq("token", token)
    .select(CAMPOS)
    .single();
  if (error || !data) return null;
  return { sesion: aSesion(data), empresa };
}

/** Paso 2 → 3: elegida la mesa, la sesión queda esperando imágenes. */
export async function elegirMesa(
  svc: Svc,
  chatId: number,
  token: string,
  mesa: MesaSesion,
): Promise<Sesion | null> {
  const actual = await sesionDe(svc, chatId);
  if (!actual || actual.token !== token || !actual.empresa_id) return null;

  const { data, error } = await svc
    .from("telegram_sesiones")
    .update({
      mesa,
      estado: "esperando_fotos",
      expires_at: vencimiento(),
      updated_at: new Date().toISOString(),
    })
    .eq("chat_id", chatId)
    .eq("token", token)
    .select(CAMPOS)
    .single();
  if (error || !data) return null;
  return aSesion(data);
}

/**
 * Ata el documento a la sesión y la pasa a 'procesando'. Devuelve false si otra
 * foto ya lo hizo (así solo el primero crea el documento del comprobante).
 */
export async function fijarDocumento(
  svc: Svc,
  chatId: number,
  token: string,
  documentoId: string,
): Promise<boolean> {
  const { data } = await svc
    .from("telegram_sesiones")
    .update({
      documento_id: documentoId,
      estado: "procesando",
      expires_at: vencimiento(),
      updated_at: new Date().toISOString(),
    })
    .eq("chat_id", chatId)
    .eq("token", token)
    .is("documento_id", null)
    .select("chat_id")
    .maybeSingle();
  return Boolean(data);
}

export async function cerrarSesion(svc: Svc, chatId: number): Promise<void> {
  await svc.from("telegram_sesiones").delete().eq("chat_id", chatId);
}

/** Alarga la vida de la sesión mientras el usuario sigue mandando fotos. */
export async function tocarSesion(svc: Svc, chatId: number): Promise<void> {
  await svc
    .from("telegram_sesiones")
    .update({ expires_at: vencimiento(), updated_at: new Date().toISOString() })
    .eq("chat_id", chatId);
}
