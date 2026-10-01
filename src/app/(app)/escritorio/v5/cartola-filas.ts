// Agrupación de las filas del editor de cartola (Check de agregados) — puro y testeable.
//
// Regla del fundador (2026-09-29): "las emitidas nunca vuelven y el documento en
// Check de agregados no se puede borrar, solo vuelven las que no se terminaron" y
// "las emitidas quedan tachadas en Check de agregados".
//
// En propuestas_ia NO existe un estado "emitida": una emitida se queda en 'aprobado'
// (o donde la dejó un retroceso viejo, incidente MH 2026-09-29). La verdad vive en
// boletas_emitidas.propuesta_id — viaja embebida en la misma consulta de la mesa
// (mesa-data.ts, `boletas_emitidas(folio,estado,ref)`), sin consultas por fila.
// Una boleta ANULADA no cuenta: esa propuesta sigue siendo trabajo pendiente.
//
// Las "A medias" (lápida: revision_pendiente / sin respuesta, ver lapida.ts) tampoco
// se tocan desde Check: se verifican en la pestaña A medias de Emitir.

export type SectionKey = "pendientes" | "listas" | "rechazadas" | "emision" | "a_medias" | "emitidas";

/** Boleta embebida en la propuesta (PostgREST devuelve arreglo; toleramos objeto/null). */
export type BoletaEmbebida = { folio: number | string | null; estado: string | null; ref?: string | null };

export type Terminada =
  | { tipo: "emitida"; folio: number | string | null; ref: string | null }
  | { tipo: "a_medias" };

type PropuestaMin = { id: string; estado: string | null; boletas_emitidas?: BoletaEmbebida[] | BoletaEmbebida | null };

/** Boleta vigente (no anulada) de la propuesta, o null. Con varias, la de folio mayor. */
export function boletaVigente(p: PropuestaMin): BoletaEmbebida | null {
  const raw = p.boletas_emitidas;
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  let mejor: BoletaEmbebida | null = null;
  for (const b of arr) {
    if (!b || b.estado === "anulada") continue;
    if (!mejor || Number(b.folio ?? 0) > Number(mejor.folio ?? 0)) mejor = b;
  }
  return mejor;
}

/**
 * ¿La fila ya terminó su viaje? Emitida (boleta no anulada) gana sobre A medias.
 * null = sigue siendo trabajo: se ve y se acciona como siempre.
 */
export function terminadaDe(p: PropuestaMin, aMediasIds: ReadonlySet<string>): Terminada | null {
  const b = boletaVigente(p);
  if (b) return { tipo: "emitida", folio: b.folio ?? null, ref: b.ref ?? null };
  if (aMediasIds.has(p.id)) return { tipo: "a_medias" };
  return null;
}

/** Sección natural de una fila VIVA (sin mirar si terminó). */
function seccionPorEstado(estado: string | null): SectionKey | null {
  if (estado === "pendiente" || estado === "editado") return "pendientes";
  if (estado === "listo") return "listas";
  if (estado === "rechazado" || estado === "descartado") return "rechazadas";
  if (estado === "aprobado") return "emision";
  return null;
}

/**
 * Agrupa por ESTADO. Las terminadas van a su propio grupo al final, sin importar el
 * estado de la propuesta (una emitida que quedó en 'listo' por un retroceso viejo
 * NO puede verse como lista). `juzgadasEnSesion`: la ✕ individual deja la fila
 * tachada donde estaba durante la sesión del popup.
 */
export function agruparFilas<P extends PropuestaMin>(
  propuestas: P[],
  aMediasIds: ReadonlySet<string>,
  juzgadasEnSesion: ReadonlyMap<string, SectionKey> = new Map(),
): { groups: Record<SectionKey, P[]>; terminadas: Map<string, Terminada> } {
  const groups: Record<SectionKey, P[]> = { pendientes: [], listas: [], rechazadas: [], emision: [], a_medias: [], emitidas: [] };
  const terminadas = new Map<string, Terminada>();
  for (const p of propuestas) {
    const t = terminadaDe(p, aMediasIds);
    if (t) {
      terminadas.set(p.id, t);
      groups[t.tipo === "emitida" ? "emitidas" : "a_medias"].push(p);
      continue;
    }
    const s = seccionPorEstado(p.estado);
    if (!s) continue;
    if (s === "rechazadas") {
      const casa = juzgadasEnSesion.get(p.id);
      groups[casa && casa !== "rechazadas" && casa !== "emitidas" && casa !== "a_medias" ? casa : "rechazadas"].push(p);
    } else {
      groups[s].push(p);
    }
  }
  return { groups, terminadas };
}

/** Conteo para el visor resumen: cuántas terminaron (emitidas / a medias). */
export function contarTerminadas(propuestas: PropuestaMin[], aMediasIds: ReadonlySet<string>): { emitidas: number; aMedias: number } {
  let emitidas = 0, aMedias = 0;
  for (const p of propuestas) {
    const t = terminadaDe(p, aMediasIds);
    if (t?.tipo === "emitida") emitidas++;
    else if (t?.tipo === "a_medias") aMedias++;
  }
  return { emitidas, aMedias };
}
