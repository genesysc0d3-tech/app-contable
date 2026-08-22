import "server-only";
import { randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { sendMessage } from "@/lib/telegram/api";

type Sb = SupabaseClient<Database>;

/**
 * Intervención de soporte con permiso del cliente (diseño del fundador):
 * el código de 6 dígitos nace en el CANAL DEL CLIENTE (Telegram vinculado o
 * banner en su app) y el cliente se lo entrega al operador — el secreto viaja
 * de él hacia soporte, nunca al revés. Canje único → ventana de 1 hora, no
 * renovable, revocable por el cliente. Misma filosofía que el runbook de
 * migración ($1 con código).
 */

const CANJE_MINUTOS = 15;
const VENTANA_MINUTOS = 60;

export type IntervencionRow = Database["public"]["Tables"]["soporte_intervenciones"]["Row"];

export type EstadoIntervencion =
  | { estado: "ninguna" }
  | { estado: "pendiente"; id: string; codigo: string; canal: string; canjeableHasta: string; operadorEmail: string }
  | { estado: "activa"; id: string; expiraAt: string; operadorEmail: string };

function ahora() {
  return new Date();
}

/** La fila viva (pendiente o activa) más reciente de la empresa, si existe. */
async function filaViva(sb: Sb, empresaId: string): Promise<IntervencionRow | null> {
  const { data } = await sb
    .from("soporte_intervenciones")
    .select("*")
    .eq("empresa_id", empresaId)
    .is("revocada_at", null)
    .order("creada_at", { ascending: false })
    .limit(3);
  const now = ahora().toISOString();
  for (const row of data ?? []) {
    if (row.canjeada_at) {
      if (row.expira_at && row.expira_at > now) return row; // activa
    } else if (row.canjeable_hasta > now) {
      return row; // pendiente de canje
    }
  }
  return null;
}

export async function estadoIntervencion(sb: Sb, empresaId: string): Promise<EstadoIntervencion> {
  const row = await filaViva(sb, empresaId);
  if (!row) return { estado: "ninguna" };
  if (row.canjeada_at && row.expira_at) {
    return { estado: "activa", id: row.id, expiraAt: row.expira_at, operadorEmail: row.operador_email };
  }
  return {
    estado: "pendiente",
    id: row.id,
    codigo: row.codigo,
    canal: row.canal,
    canjeableHasta: row.canjeable_hasta,
    operadorEmail: row.operador_email,
  };
}

/** Intervención ACTIVA (canjeada, vigente, no revocada) o null. */
export async function intervencionActiva(sb: Sb, empresaId: string): Promise<IntervencionRow | null> {
  const row = await filaViva(sb, empresaId);
  return row?.canjeada_at ? row : null;
}

/**
 * Crea una solicitud: genera el código, invalida solicitudes pendientes
 * previas y lo manda al Telegram vinculado de la empresa si existe (si no,
 * queda visible en el banner de la app del cliente).
 */
export async function solicitarIntervencion(
  sb: Sb,
  empresaId: string,
  operadorEmail: string,
  motivo: string | null,
): Promise<{ ok: true; canal: "telegram" | "app"; id: string } | { ok: false; error: string }> {
  const viva = await filaViva(sb, empresaId);
  if (viva?.canjeada_at) return { ok: false, error: "Ya hay una intervención activa." };
  if (viva) {
    // Solicitud pendiente previa: se revoca y se emite una nueva (código nuevo).
    await sb.from("soporte_intervenciones").update({ revocada_at: ahora().toISOString() }).eq("id", viva.id);
  }

  const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const canjeableHasta = new Date(ahora().getTime() + CANJE_MINUTOS * 60_000).toISOString();

  // ¿Tiene Telegram vinculado? Ese es el canal preferido (le llega al tiro).
  const { data: chat } = await sb
    .from("telegram_chats")
    .select("chat_id")
    .eq("empresa_id", empresaId)
    .eq("activo", true)
    .order("vinculado_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const canal: "telegram" | "app" = chat && process.env.TELEGRAM_BOT_TOKEN ? "telegram" : "app";

  const { data: inserted, error } = await sb
    .from("soporte_intervenciones")
    .insert({
      empresa_id: empresaId,
      operador_email: operadorEmail,
      codigo,
      canal,
      motivo,
      canjeable_hasta: canjeableHasta,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: error?.message ?? "No se pudo crear la solicitud" };

  if (canal === "telegram" && chat) {
    try {
      await sendMessage(
        chat.chat_id,
        "🛠 <b>Soporte massDTE pide tu permiso para intervenir en tu empresa por 1 hora</b> " +
          "(revisar y arreglar datos contigo).\n\n" +
          `Tu código: <b>${codigo}</b>\n\n` +
          "Compárteselo a soporte SOLO si tú pediste ayuda. " +
          `Vence en ${CANJE_MINUTOS} minutos. Responde /revocar para cortar el acceso en cualquier momento.`,
        { html: true },
      );
    } catch {
      // Telegram falló: el código sigue visible en el banner de su app.
    }
  }

  return { ok: true, canal, id: inserted.id };
}

/** Canje único y atómico: código correcto + ventana vigente → 1 hora exacta. */
export async function canjearIntervencion(
  sb: Sb,
  empresaId: string,
  codigo: string,
): Promise<{ ok: true; expiraAt: string; id: string } | { ok: false; error: string }> {
  const limpio = codigo.trim();
  if (!/^\d{6}$/.test(limpio)) return { ok: false, error: "El código son 6 dígitos." };

  const now = ahora();
  const expiraAt = new Date(now.getTime() + VENTANA_MINUTOS * 60_000).toISOString();
  // UPDATE condicionado = canje de UN solo uso (dos canjes simultáneos: gana uno).
  const { data, error } = await sb
    .from("soporte_intervenciones")
    .update({ canjeada_at: now.toISOString(), expira_at: expiraAt, codigo: "******" })
    .eq("empresa_id", empresaId)
    .eq("codigo", limpio)
    .is("canjeada_at", null)
    .is("revocada_at", null)
    .gt("canjeable_hasta", now.toISOString())
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Código inválido, vencido o ya usado." };
  return { ok: true, expiraAt, id: data[0].id };
}

/** Corta la intervención (viva o pendiente). La usan cliente Y operador. */
export async function terminarIntervencion(
  sb: Sb,
  empresaId: string,
): Promise<{ ok: true; habia: boolean }> {
  const viva = await filaViva(sb, empresaId);
  if (!viva) return { ok: true, habia: false };
  await sb
    .from("soporte_intervenciones")
    .update({ revocada_at: ahora().toISOString() })
    .eq("id", viva.id);
  return { ok: true, habia: true };
}
