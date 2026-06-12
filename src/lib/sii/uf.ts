/**
 * Valor UF del día vía API pública mindicador.cl (sin API key), con caché
 * en memoria de 12h (la UF cambia una vez al día) y fallback a la constante
 * referencial si la API falla — la emisión jamás se bloquea por esto.
 * Server-only: las rutas la consultan y le pasan el umbral resuelto a
 * validarBoleta (que sigue siendo síncrona y usable en cliente).
 */
import { UF_REFERENCIA_CLP, UMBRAL_IDENTIFICACION_UF } from "./validation";

let cache: { valor: number; ts: number } | null = null;
const TTL_MS = 12 * 60 * 60 * 1000;

export async function getUfClp(): Promise<number> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.valor;
  try {
    const res = await fetch("https://mindicador.cl/api/uf", {
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 43_200 },
    });
    if (res.ok) {
      const data = (await res.json()) as { serie?: { valor?: number }[] };
      const valor = Number(data?.serie?.[0]?.valor);
      // Sanity: la UF vive en decenas de miles de pesos; basura de la API no pasa.
      if (Number.isFinite(valor) && valor > 10_000 && valor < 200_000) {
        cache = { valor, ts: Date.now() };
        return valor;
      }
    }
  } catch {
    /* API caída o lenta → fallback */
  }
  return cache?.valor ?? UF_REFERENCIA_CLP;
}

/** Umbral de identificación del comprador en pesos (135 UF, Res. Ex. SII 44/2025). */
export async function getUmbralIdentificacionClp(): Promise<number> {
  return Math.round(UMBRAL_IDENTIFICACION_UF * (await getUfClp()));
}
