// Entrega de avisos SIN gasto extra (regla de escala del fundador: nada de sondeo).
//
// Viajan en pedidos que la app YA hace: el render del layout de la app y la
// respuesta de /api/mesa. Cuesta UNA consulta indexada por vigencia
// (idx_avisos_app_vigentes) con los vistos del usuario embebidos (PK de
// avisos_vistos), y se guarda en memoria de la instancia 60 s por usuario+empresa:
// los refrescos de la mesa no la repiten. Un urgente nuevo llega en la siguiente
// respuesta normal pasado ese minuto.
//
// UN SOLO CAMINO (revisión N2): layout y /api/mesa llaman a esto con service role
// y la audiencia por empresa se decide SIEMPRE acá con avisoParaEmpresa (la empresa
// activa que ya validó quien llama). El RLS + grant por columnas de la migración
// quedan como defensa para lecturas directas del navegador por PostgREST.
//
// FAIL-SAFE (N1): si la consulta falla o pasa el tope, devuelve `undefined` ("no
// sé"), NO `[]`: la pantalla deja su cola como está (un [] le sacaría el aviso que
// está mostrando). Los errores no se cachean, salvo la tabla ausente (migración sin
// aplicar), que se recuerda 5 min para no pagar una consulta fallida en cada carga.
//
// Sin "server-only" a propósito (se testea con un cliente falso); solo lo usan el
// layout y rutas del server.
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { avisoParaEmpresa, avisoVigente, esAvisoValido, type AvisoApp } from "./reglas";

type Sb = SupabaseClient<Database>;

export const CACHE_AVISOS_MS = 60_000;
export const TABLA_AUSENTE_MS = 5 * 60_000;
const MAX_ENTRADAS = 1_000;
const MAX_AVISOS = 20;
// Tabla o relación inexistente (PostgREST / Postgres).
const CODIGOS_AUSENTE = new Set(["PGRST205", "PGRST200", "42P01"]);

// empresa_ids se pide SOLO para filtrar acá y se QUITA antes de responder: al
// navegador nunca viajan UUIDs de otras empresas (B1). Nunca creado_por.
const COLUMNAS = "id, tipo, titulo, cuerpo, formato, desde, hasta, mesa, version_min, created_at, empresa_ids, avisos_vistos(user_id)";

/** Tope de la consulta (M5): si tarda más, la mesa/página sigue sin tocar los avisos. */
export const TOPE_CONSULTA_MS = 1_500;
const TIMEOUT = Symbol("timeout");

type Entrada = { at: number; avisos: AvisoApp[] };
const G = globalThis as typeof globalThis & { __massdteAvisosCache?: { porClave: Map<string, Entrada>; ausenteHasta: number } };
function cache() {
  G.__massdteAvisosCache ??= { porClave: new Map(), ausenteHasta: 0 };
  return G.__massdteAvisosCache;
}

/** Service client para el layout (cargarMesa ya trae el suyo). null sin config → sin avisos. */
export function clienteServicioAvisos(): Sb | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient<Database>(url, key);
}

type FilaServer = AvisoApp & { empresa_ids?: string[] | null; avisos_vistos?: unknown[] | null };

/**
 * Avisos vigentes, de la audiencia de esta empresa, que este usuario no ha cerrado.
 * `[]` = no hay; `undefined` = no se pudo saber (la pantalla no toca su cola).
 */
export async function avisosPendientes(
  sb: Sb | null,
  args: { userId: string; empresaId: string | null; now?: Date; timeoutMs?: number },
): Promise<AvisoApp[] | undefined> {
  const now = args.now ?? new Date();
  const t = now.getTime();
  if (!args.userId || !args.empresaId) return [];
  if (!sb) return undefined;
  const c = cache();
  if (t < c.ausenteHasta) return undefined;
  const clave = `${args.userId}|${args.empresaId}`;
  const hit = c.porClave.get(clave);
  if (hit && t - hit.at < CACHE_AVISOS_MS) return hit.avisos.filter((a) => avisoVigente(a, t));

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const nowIso = now.toISOString();
    const consulta = sb
      .from("avisos_app")
      .select(COLUMNAS)
      .eq("activo", true)
      .lte("desde", nowIso)
      .gt("hasta", nowIso)
      .eq("avisos_vistos.user_id", args.userId)
      .order("desde", { ascending: true })
      .limit(MAX_AVISOS);
    const tope = new Promise<typeof TIMEOUT>((ok) => { timer = setTimeout(() => ok(TIMEOUT), args.timeoutMs ?? TOPE_CONSULTA_MS); });
    const res = await Promise.race([Promise.resolve(consulta), tope]);
    if (res === TIMEOUT) return undefined;
    const { data, error } = res;
    if (error) {
      if (CODIGOS_AUSENTE.has(String((error as { code?: string }).code ?? ""))) c.ausenteHasta = t + TABLA_AUSENTE_MS;
      return undefined;
    }
    const avisos: AvisoApp[] = [];
    for (const fila of (data ?? []) as unknown as FilaServer[]) {
      const { avisos_vistos: vistos, empresa_ids: empresas, ...a } = fila;
      if (Array.isArray(vistos) && vistos.length > 0) continue; // ya lo cerró
      if (!esAvisoValido(a)) continue;
      if (!avisoParaEmpresa({ empresa_ids: empresas ?? null }, args.empresaId)) continue; // LA regla de audiencia
      avisos.push(a);
    }
    if (c.porClave.size >= MAX_ENTRADAS) c.porClave.clear();
    c.porClave.set(clave, { at: t, avisos });
    return avisos;
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Solo tests. */
export function _reiniciarCacheAvisos(): void {
  G.__massdteAvisosCache = { porClave: new Map(), ausenteHasta: 0 };
}
