import { leerCuadre } from "@/lib/cartola/cuadre-mesa";
import { revisarColumnas } from "@/lib/cartola/verificacion";

/**
 * ¿Qué cartola abre SOLA el popup "Revisa las columnas"? (2026-09-30) El
 * resultado de subir vive donde la clienta está mirando: la mesa, justo cuando
 * la cartola termina de procesarse. UNA vez por documento (si lo cierra, queda
 * el aviso en la tarjeta) y solo cartolas recién subidas o que se vieron
 * procesando en esta sesión: los documentos antiguos jamás saltan solos.
 */
export const VENTANA_RECIENTE_MS = 30 * 60_000;
const CLAVE = "massdte:columnas-auto";

type DocMin = { id: string; estado: string; created_at: string; progreso_ia: unknown };

export function docParaAbrirSolo<T extends DocMin>(
  docs: T[],
  s: { vistosProcesando: Set<string>; yaAbiertos: Set<string>; ahora: number },
): T | null {
  for (const d of docs) {
    if (d.estado !== "procesado" || s.yaAbiertos.has(d.id)) continue;
    const reciente = s.vistosProcesando.has(d.id) || s.ahora - new Date(d.created_at).getTime() < VENTANA_RECIENTE_MS;
    if (!reciente) continue;
    const cuadre = leerCuadre(d.progreso_ia);
    if (cuadre && revisarColumnas(cuadre).abrir) return d;
  }
  return null;
}

/** Documentos a los que ya se les abrió solo (por navegador; sin storage = en memoria). */
export function leerYaAbiertos(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CLAVE) ?? "[]") as string[]); } catch { return new Set(); }
}

export function marcarAbierto(id: string, yaAbiertos: Set<string>): void {
  yaAbiertos.add(id);
  // Solo los últimos 200: la lista no crece para siempre.
  try { localStorage.setItem(CLAVE, JSON.stringify([...yaAbiertos].slice(-200))); } catch { /* sin storage: vale para la sesión */ }
}
