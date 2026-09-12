import "server-only";
import { createClient } from "@supabase/supabase-js";
import {
  EXTENSION_VERSION_ACTUAL,
  EXTENSION_VERSION_MINIMA,
  versionDisponibleDeExtension,
  type FilaTelemetriaExtension,
} from "./extension";

/**
 * Empresas INTERNAS / de prueba: no representan lo que un cliente real puede
 * obtener de la tienda (el founder corre builds DESEMPAQUETADAS de ensayo). Se
 * excluyen del cálculo de "versión disponible" para que ese ensayo no haga de
 * canario falso y dispare un nag hacia una versión aún en revisión. Por
 * empresa_id (UUID inmutable), no por RUT (editable). El umbral ≥2 empresas
 * reales es la segunda llave. Endurecimiento futuro: un flag `interna` en la
 * base. Ver [[project_extension_version_disponible]].
 */
const EMPRESAS_INTERNAS: ReadonlySet<string> = new Set<string>([
  "5fe96a36-9f7e-408c-b315-2b55d534e1d1", // MV INVERSIONES (ensayo del founder)
  "7060be65-a566-469b-aea3-65457b55fe19", // EMPRESA DOS PRUEBA (wizard)
]);

// Cache en memoria por instancia (el valor es GLOBAL e igual para todos; cambia
// raro). Evita pegarle a la DB en cada render del dashboard.
let cache: { valor: string; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** Fuerza el recálculo en la próxima llamada (p.ej. tras registrar telemetría). */
export function invalidarVersionDisponible(): void {
  cache = null;
}

/**
 * Versión de la extensión DISPONIBLE (viva en la tienda), derivada de la
 * telemetría de la flota. Requiere service role: lee `ext_last_version` de TODAS
 * las empresas (RLS por tenant obliga). Devuelve SOLO el string de versión, jamás
 * filas ni PII de otros tenants. Ante cualquier duda, devuelve el PISO (nunca
 * sobre-anuncia). Ver [[project_extension_version_disponible]].
 */
export async function getVersionExtensionDisponible(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.valor;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return EXTENSION_VERSION_MINIMA;

  try {
    const sb = createClient(url, key);
    const { data } = await sb
      .from("empresas")
      .select("id, ext_last_version, ext_last_seen_at")
      .not("ext_last_version", "is", null);

    const filas: FilaTelemetriaExtension[] = (data ?? []).map((e) => ({
      empresa_id: e.id as string,
      version: (e.ext_last_version as string | null) ?? null,
      seen_at: (e.ext_last_seen_at as string | null) ?? null,
    }));

    const valor = versionDisponibleDeExtension(filas, new Date(), {
      tope: EXTENSION_VERSION_ACTUAL,
      minima: EXTENSION_VERSION_MINIMA,
      denylist: EMPRESAS_INTERNAS,
    });
    cache = { valor, at: Date.now() };
    return valor;
  } catch {
    return EXTENSION_VERSION_MINIMA;
  }
}
