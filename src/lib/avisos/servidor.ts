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

const COLUMNAS = "id, tipo, titulo, cuerpo, formato, desde, hasta, empresa_ids, mesa, version_min, created_at, avisos_vistos(user_id)";

type Entrada = { at: number; avisos: AvisoApp[] };
const G = globalThis as typeof globalThis & { __massdteAvisosCache?: { porClave: Map<string, Entrada>; ausenteHasta: number } };
function cache() {
  G.__massdteAvisosCache ??= { porClave: new Map(), ausenteHasta: 0 };
  return G.__massdteAvisosCache;
}

export async function avisosPendientes(
  sb: Sb,
  args: { userId: string; empresaId: string | null; now?: Date },
): Promise<AvisoApp[]> {
  const now = args.now ?? new Date();
  const t = now.getTime();
  if (!args.userId || !args.empresaId) return [];
  const c = cache();
  if (t < c.ausenteHasta) return [];
  const clave = `${args.userId}|${args.empresaId}`;
  const hit = c.porClave.get(clave);
  if (hit && t - hit.at < CACHE_AVISOS_MS) return hit.avisos.filter((a) => avisoVigente(a, t));

  let avisos: AvisoApp[] = [];
  try {
    const nowIso = now.toISOString();
    const { data, error } = await sb
      .from("avisos_app")
      .select(COLUMNAS)
      .eq("activo", true)
      .lte("desde", nowIso)
      .gt("hasta", nowIso)
      .eq("avisos_vistos.user_id", args.userId)
      .order("desde", { ascending: true })
      .limit(MAX_AVISOS);
    if (error) {
      if (CODIGOS_AUSENTE.has(String((error as { code?: string }).code ?? ""))) c.ausenteHasta = t + TABLA_AUSENTE_MS;
      avisos = [];
    } else {
      for (const fila of (data ?? []) as unknown as (AvisoApp & { avisos_vistos?: unknown[] | null })[]) {
        const { avisos_vistos: vistos, ...a } = fila;
        if (Array.isArray(vistos) && vistos.length > 0) continue; // ya lo cerró
        if (!esAvisoValido(a)) continue;
        if (!avisoParaEmpresa(a, args.empresaId)) continue; // espejo del RLS
        avisos.push(a);
      }
    }
  } catch {
    avisos = [];
  }

  if (c.porClave.size >= MAX_ENTRADAS) c.porClave.clear();
  c.porClave.set(clave, { at: t, avisos });
  return avisos;
}

/** Solo tests. */
export function _reiniciarCacheAvisos(): void {
  G.__massdteAvisosCache = { porClave: new Map(), ausenteHasta: 0 };
}
