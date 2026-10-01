// Entrega de avisos SIN gasto extra (regla de escala del fundador: nada de sondeo).
//
// Viajan en pedidos que la app YA hace: el render del layout de la app y la
// respuesta de /api/mesa. Cuesta UNA consulta indexada por vigencia
// (idx_avisos_app_vigentes) con los vistos del usuario embebidos (PK de
// avisos_vistos), y se guarda en memoria de la instancia 60 s por usuario+empresa:
// los refrescos de la mesa no la repiten. Un urgente nuevo llega en la siguiente
// respuesta normal pasado ese minuto.
//
// FAIL-SAFE: si la tabla no existe (migración sin aplicar) o la consulta falla,
// devuelve [] — la app no muestra nada y sigue igual. Una tabla ausente se
// recuerda 5 min para no pagar una consulta fallida en cada carga.
//
// Sin "server-only" a propósito (se testea con un cliente falso); solo lo usan
// el layout y rutas del server, con el cliente de la SESIÓN (el RLS manda).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { avisoParaEmpresa, avisoVigente, esAvisoValido, type AvisoApp } from "./reglas";

type Sb = SupabaseClient<Database>;

export const CACHE_AVISOS_MS = 60_000;
export const TABLA_AUSENTE_MS = 5 * 60_000;
const MAX_ENTRADAS = 1_000;
const MAX_AVISOS = 20;
// Tabla o relación inexistente (PostgREST / Postgres).
const CODIGOS_AUSENTE = new Set(["PGRST205", "PGRST200", "42P01"]);

// Columnas MÍNIMAS (B1): lo que la clienta puede leer por RLS + grant de columnas.
// Con el cliente de la SESIÓN no se pide empresa_ids (no tiene el privilegio; el RLS ya
// filtra su empresa). Con service role (cargarMesa) se pide para filtrar acá y se
// QUITA antes de responder: al navegador nunca viajan UUIDs de otras empresas.
const COLUMNAS_SESION = "id, tipo, titulo, cuerpo, formato, desde, hasta, mesa, version_min, created_at, avisos_vistos(user_id)";
const COLUMNAS_SERVICIO = "id, tipo, titulo, cuerpo, formato, desde, hasta, mesa, version_min, created_at, empresa_ids, avisos_vistos(user_id)";

/** Tope de la consulta (M5): si tarda más, la mesa/página sigue sin avisos. */
export const TOPE_CONSULTA_MS = 1_500;
const TIMEOUT = Symbol("timeout");

type Entrada = { at: number; avisos: AvisoApp[] };
const G = globalThis as typeof globalThis & { __massdteAvisosCache?: { porClave: Map<string, Entrada>; ausenteHasta: number } };
function cache() {
  G.__massdteAvisosCache ??= { porClave: new Map(), ausenteHasta: 0 };
  return G.__massdteAvisosCache;
}

type FilaServer = AvisoApp & { empresa_ids?: string[] | null; avisos_vistos?: unknown[] | null };

export async function avisosPendientes(
  sb: Sb,
  args: {
    userId: string;
    empresaId: string | null;
    /** "sesion" (RLS, por defecto) o "servicio" (service role: filtra empresa explícito). */
    cliente?: "sesion" | "servicio";
    now?: Date;
    timeoutMs?: number;
  },
): Promise<AvisoApp[]> {
  const now = args.now ?? new Date();
  const t = now.getTime();
  if (!args.userId || !args.empresaId) return [];
  const c = cache();
  if (t < c.ausenteHasta) return [];
  const clave = `${args.userId}|${args.empresaId}`;
  const hit = c.porClave.get(clave);
  if (hit && t - hit.at < CACHE_AVISOS_MS) return hit.avisos.filter((a) => avisoVigente(a, t));

  const servicio = args.cliente === "servicio";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const nowIso = now.toISOString();
    const consulta = sb
      .from("avisos_app")
      .select(servicio ? COLUMNAS_SERVICIO : COLUMNAS_SESION)
      .eq("activo", true)
      .lte("desde", nowIso)
      .gt("hasta", nowIso)
      .eq("avisos_vistos.user_id", args.userId)
      .order("desde", { ascending: true })
      .limit(MAX_AVISOS);
    const tope = new Promise<typeof TIMEOUT>((ok) => { timer = setTimeout(() => ok(TIMEOUT), args.timeoutMs ?? TOPE_CONSULTA_MS); });
    const res = await Promise.race([Promise.resolve(consulta), tope]);
    // Tardó: [] SIN cachear (la próxima carga reintenta).
    if (res === TIMEOUT) return [];
    const { data, error } = res;
    const avisos: AvisoApp[] = [];
    if (error) {
      if (CODIGOS_AUSENTE.has(String((error as { code?: string }).code ?? ""))) c.ausenteHasta = t + TABLA_AUSENTE_MS;
    } else {
      for (const fila of (data ?? []) as unknown as FilaServer[]) {
        const { avisos_vistos: vistos, empresa_ids: empresas, ...a } = fila;
        if (Array.isArray(vistos) && vistos.length > 0) continue; // ya lo cerró
        if (!esAvisoValido(a)) continue;
        if (servicio && !avisoParaEmpresa({ empresa_ids: empresas ?? null }, args.empresaId)) continue; // espejo del RLS
        avisos.push(a);
      }
    }
    if (c.porClave.size >= MAX_ENTRADAS) c.porClave.clear();
    c.porClave.set(clave, { at: t, avisos });
    return avisos;
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Solo tests. */
export function _reiniciarCacheAvisos(): void {
  G.__massdteAvisosCache = { porClave: new Map(), ausenteHasta: 0 };
}
