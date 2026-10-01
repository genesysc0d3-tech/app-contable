// Bus mínimo para que los avisos que llegan en /api/mesa (MesaController) lleguen
// a <AvisosApp> (layout) sin otro pedido. Una sola instancia por pestaña aunque el
// módulo se cargue en dos chunks (mismo patrón que lib/actualizacion/ocupado.ts).
import type { AvisoApp } from "./reglas";

type Oyente = (avisos: AvisoApp[]) => void;
const G = globalThis as typeof globalThis & { __massdteAvisosBus?: Set<Oyente> };
G.__massdteAvisosBus ??= new Set();
const oyentes = G.__massdteAvisosBus;

/** Vacío también se publica: cada carga de la mesa es un buen momento para re-evaluar (cambió de mesa). */
export function publicarAvisos(avisos: unknown): void {
  if (!Array.isArray(avisos)) return;
  for (const o of oyentes) { try { o(avisos as AvisoApp[]); } catch { /* un oyente roto no tumba la mesa */ } }
}

export function escucharAvisos(o: Oyente): () => void {
  oyentes.add(o);
  return () => { oyentes.delete(o); };
}
