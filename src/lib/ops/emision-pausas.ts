// KILL SWITCH de emisión (tanda 1 RPA, 2026-09-10).
//
// Antes de esto no había NINGÚN freno remoto: si el SII cambiaba su portal, la
// flota entera (incluidas extensiones viejas que no se pueden actualizar al
// tiro) seguía intentando emitir contra una página que ya no calzaba. TODA
// emisión —única y lote, boletas y facturas— pasa por POST /api/emision/jobs,
// así que una fila en `emision_pausas` frena a todos sin republicar nada.
//
// Reglas duras:
//   · FAIL-CLOSED: si la consulta de la pausa FALLA (tabla sin migrar, red,
//     lo que sea), se responde como si hubiera pausa. Preferimos que un cliente
//     espere un rato a que un lote entero se estrelle contra un portal cambiado.
//   · NUNCA se bloquea el guardado de un folio real (/api/sii-local/result,
//     reconcile, PATCH heartbeat, DELETE cierre). Esto solo frena la APERTURA
//     de jobs nuevos.
//   · `excepto_empresas` deja emitir a empresas puntuales (p. ej. la del socio
//     para probar el arreglo mientras el resto sigue pausado).
//
// Este módulo NO importa "server-only" a propósito: se testea con un cliente
// falso en vitest. Solo lo usan rutas API y actions del servidor.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Sb = SupabaseClient<Database>;

export type CarrilEmision = "boletas" | "facturas";
export type CarrilPausa = CarrilEmision | "todo";

export interface PausaEmision {
  id: string;
  carril: string;
  activo: boolean;
  motivo_interno: string | null;
  hasta: string;
  excepto_empresas: string[];
  origen: string;
  creado_por: string | null;
  created_at: string | null;
}

/** 39/41 → boletas · 33/34 → facturas. Es la misma partición que usa el guard tributario. */
export function carrilDeTipoDte(tipoDte: number): CarrilEmision {
  return tipoDte === 33 || tipoDte === 34 ? "facturas" : "boletas";
}

/**
 * ¿A este proveedor le aplica el kill switch? SOLO al RPA del portal
 * (`sii_local`): la pausa existe porque el SII cambió SU PÁGINA, y SimpleAPI
 * emite por web service con certificado, sin tocar el portal. Frenarlo también
 * era castigar a un cliente por un problema que no lo alcanza (revisión
 * adversarial 2026-09-10).
 */
export function gateDePausaAplica(provider: string | null | undefined): boolean {
  return provider === "sii_local";
}

/** Evento-marca en ops_events de que YA se alertó por `emision_pausa_query_failed`. */
export const EVENTO_MARCA_ALERTA_PAUSA_QUERY = "emision_pausa_query_failed_alertada";
/** Mínimo entre dos alertas por la misma falla de consulta (dedupe simple). */
export const PAUSA_QUERY_FAILED_ALERTA_MS = 10 * 60 * 1000;

/**
 * Dedupe de la alerta crítica por fallo del kill switch: si la última marca es
 * de hace < 10 min, no se vuelve a mandar. Sin marca (o marca vieja) → se manda.
 * Pura para testear; la ruta consulta la marca y llama a esto.
 */
export function debeAlertarPausaQueryFailed(ultimaMarcaIso: string | null | undefined, now = new Date()): boolean {
  if (!ultimaMarcaIso) return true;
  const t = Date.parse(ultimaMarcaIso);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= PAUSA_QUERY_FAILED_ALERTA_MS;
}

/**
 * Copy que ve el cliente cuando la emisión está pausada. Honesto y sin culpa:
 * no perdió nada, sus documentos siguen listos, y la causa es un cambio en el
 * sitio del SII que nosotros estamos revisando.
 */
export function copyEmisionPausada(carril: CarrilEmision): string {
  return `Pausamos la emisión de ${carril} por un rato mientras revisamos un cambio en el sitio del SII. Tus ${carril} quedan listas y no se pierde nada; inténtalo de nuevo más tarde.`;
}

export type ResultadoPausa =
  | { pausada: false }
  | { pausada: true; pausa: PausaEmision | null; fallo: string | null };

/**
 * ¿Hay una pausa VIVA que alcance a esta empresa en este carril?
 * Viva = activo y no vencida. Alcanza = carril igual o 'todo', y la empresa no
 * está en la lista de excepciones. FAIL-CLOSED ante error de consulta.
 */
export async function pausaActivaParaEmpresa(
  sb: Sb,
  args: { carril: CarrilEmision; empresaId: string; now?: Date },
): Promise<ResultadoPausa> {
  const nowIso = (args.now ?? new Date()).toISOString();
  try {
    const { data, error } = await sb
      .from("emision_pausas")
      .select("id, carril, activo, motivo_interno, hasta, excepto_empresas, origen, creado_por, created_at")
      .eq("activo", true)
      .gt("hasta", nowIso)
      .in("carril", [args.carril, "todo"])
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return { pausada: true, pausa: null, fallo: error.message };
    // El filtro de excepciones se hace acá y no en SQL: `NOT (x = ANY(arr))`
    // no tiene azúcar en PostgREST y la lista viva es chica (≤20 filas).
    const vigente = (data ?? []).find((p) => !(p.excepto_empresas ?? []).includes(args.empresaId));
    if (!vigente) return { pausada: false };
    return { pausada: true, pausa: vigente as PausaEmision, fallo: null };
  } catch (error) {
    return { pausada: true, pausa: null, fallo: error instanceof Error ? error.message : String(error) };
  }
}

/** Todas las pausas VIVAS (para /dev y para el auto-kill: "¿ya hay una para este carril?"). */
export async function pausasVivas(sb: Sb, now = new Date()): Promise<{ pausas: PausaEmision[]; error: string | null }> {
  const { data, error } = await sb
    .from("emision_pausas")
    .select("id, carril, activo, motivo_interno, hasta, excepto_empresas, origen, creado_por, created_at")
    .eq("activo", true)
    .gt("hasta", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { pausas: [], error: error.message };
  return { pausas: (data ?? []) as PausaEmision[], error: null };
}

/** Historial reciente (vivas y levantadas/vencidas) para la tarjeta de /dev. */
export async function historialPausas(sb: Sb, limit = 12): Promise<{ pausas: PausaEmision[]; error: string | null }> {
  const { data, error } = await sb
    .from("emision_pausas")
    .select("id, carril, activo, motivo_interno, hasta, excepto_empresas, origen, creado_por, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { pausas: [], error: error.message };
  return { pausas: (data ?? []) as PausaEmision[], error: null };
}

/** ¿Una pausa viva cubre este carril (propio o 'todo')? Para no apilar auto-pausas. */
export function hayPausaParaCarril(pausas: PausaEmision[], carril: CarrilEmision): boolean {
  return pausas.some((p) => p.carril === carril || p.carril === "todo");
}

export async function crearPausa(
  sb: Sb,
  args: { carril: CarrilPausa; hasta: Date; motivo: string | null; origen: "manual" | "auto"; creadoPor: string | null; exceptoEmpresas?: string[] },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await sb
    .from("emision_pausas")
    .insert({
      carril: args.carril,
      activo: true,
      motivo_interno: args.motivo ? args.motivo.slice(0, 300) : null,
      hasta: args.hasta.toISOString(),
      excepto_empresas: args.exceptoEmpresas ?? [],
      origen: args.origen,
      creado_por: args.creadoPor,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "INSERT_FAILED" };
  return { ok: true, id: data.id };
}

/** Levanta (activo=false) todas las pausas vivas de un carril — o de todos con 'todo'. */
export async function levantarPausas(
  sb: Sb,
  args: { carril: CarrilPausa; now?: Date },
): Promise<{ ok: true; levantadas: number } | { ok: false; error: string }> {
  const nowIso = (args.now ?? new Date()).toISOString();
  let q = sb
    .from("emision_pausas")
    .update({ activo: false }, { count: "exact" })
    .eq("activo", true)
    .gt("hasta", nowIso);
  // 'todo' desde /dev = levantar TODAS las vivas. Un carril concreto levanta
  // las suyas y también las 'todo' (si no, el carril seguiría frenado).
  if (args.carril !== "todo") q = q.in("carril", [args.carril, "todo"]);
  const { error, count } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, levantadas: count ?? 0 };
}
