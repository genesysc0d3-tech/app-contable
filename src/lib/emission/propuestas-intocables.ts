// ¿Qué propuestas NO pueden volver atrás (a Check, a pendiente, a juzgada)?
// (incidente MH 2026-09-29)
//
// "Devolver a Check" bajaba TODA la cartola de 'aprobado' a 'listo', incluidas las
// 103 que ya tenían boleta en el SII (en propuestas no existe un estado "emitida":
// la verdad vive en boletas_emitidas.propuesta_id, y una emitida se queda en
// 'aprobado'). La clienta vio 684 "pendientes" con 103 ya emitidas y casi las cargó
// a mano → eso SÍ duplicaba. La emisión ya las rechazaba; la que mentía era la UI.
//
// Regla: una propuesta es INTOCABLE para cualquier retroceso de estado si
//   - tiene boleta no anulada (emitida),
//   - quedó a medias o sin respuesta (lápida, ver lapida.ts), o
//   - tiene un intento de emisión EN VUELO (created/running no vencido; mismo
//     criterio que revisarEnVuelo en propuesta-emitible.ts).
// Fail-CLOSED: si la consulta falla, no se toca nada.

import { esLapidaEfectiva, ESTADOS_LAPIDA, type JobParaLapida } from "@/lib/emission/lapida";

export type MotivoIntocable = "emitida" | "a_medias" | "sin_respuesta" | "en_vuelo";

/** Motivo por el que un job impide retroceder su propuesta (null = no impide). */
export function motivoJobIntocable(job: JobParaLapida, ahora: Date = new Date()): Exclude<MotivoIntocable, "emitida"> | null {
  if (!job.propuesta_id) return null;
  const lapida = esLapidaEfectiva(job, ahora);
  if (lapida) return lapida;
  if ((job.estado === "created" || job.estado === "running") && job.expires_at && Date.parse(job.expires_at) > ahora.getTime()) {
    return "en_vuelo";
  }
  return null;
}

export type SeparacionIntocables = {
  /** Se pueden retroceder. Conserva el orden de entrada. */
  tocables: string[];
  /** id → motivo, para las que se quedan donde están. */
  intocables: Map<string, MotivoIntocable>;
};

/** Función pura: separa ids según boletas emitidas y jobs de emisión. */
export function separarIntocables(
  ids: string[],
  propuestasConBoleta: Iterable<string>,
  jobs: JobParaLapida[],
  ahora: Date = new Date(),
): SeparacionIntocables {
  const intocables = new Map<string, MotivoIntocable>();
  for (const id of propuestasConBoleta) intocables.set(id, "emitida");
  for (const j of jobs) {
    if (!j.propuesta_id || intocables.get(j.propuesta_id) === "emitida") continue;
    const m = motivoJobIntocable(j, ahora);
    if (m && !intocables.has(j.propuesta_id)) intocables.set(j.propuesta_id, m);
  }
  const pedidos = new Set(ids);
  for (const id of Array.from(intocables.keys())) if (!pedidos.has(id)) intocables.delete(id);
  return { tocables: ids.filter((id) => !intocables.has(id)), intocables };
}

/** Conteo legible para el resumen de una acción. */
export function contarIntocables(intocables: Map<string, MotivoIntocable>): { emitidas: number; aMedias: number; enVuelo: number } {
  let emitidas = 0, aMedias = 0, enVuelo = 0;
  for (const m of intocables.values()) {
    if (m === "emitida") emitidas++;
    else if (m === "en_vuelo") enVuelo++;
    else aMedias++;
  }
  return { emitidas, aMedias, enVuelo };
}

/**
 * Texto para el toast/auditoría de un retroceso. Ej.:
 *   "581 devueltas a Check · 103 ya emitidas se quedan"
 */
export function resumenRetroceso(devueltas: number, verbo: string, intocables: Map<string, MotivoIntocable>): string {
  const { emitidas, aMedias, enVuelo } = contarIntocables(intocables);
  const partes = [`${devueltas} ${verbo}`];
  if (emitidas > 0) partes.push(`${emitidas} ya ${emitidas === 1 ? "emitida se queda" : "emitidas se quedan"}`);
  if (aMedias > 0) partes.push(`${aMedias} a medias ${aMedias === 1 ? "se queda" : "se quedan"} (verifícala${aMedias === 1 ? "" : "s"} en A medias)`);
  if (enVuelo > 0) partes.push(`${enVuelo} ${enVuelo === 1 ? "se está emitiendo" : "se están emitiendo"} ahora`);
  return partes.join(" · ");
}

// Cliente mínimo (service role o server): solo lo que usamos, para no acoplar tipos.
type Consulta = {
  select: (cols: string) => Consulta;
  eq: (col: string, v: unknown) => Consulta;
  neq: (col: string, v: unknown) => Consulta;
  in: (col: string, v: readonly unknown[]) => Consulta;
} & PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
type SbMin = { from: (t: string) => unknown };

/** Trozos chicos: un .in() con cientos de uuids se pasa del largo de URL y vuelve error. */
const TROZO = 100;

/**
 * Lee boletas y jobs de las propuestas pedidas (2 consultas por trozo de 100) y
 * separa las intocables. Devuelve `error` si alguna consulta falla (fail-closed:
 * el llamador NO debe mover nada en ese caso).
 */
export async function clasificarIntocables(
  sb: SbMin,
  empresaId: string,
  ids: string[],
  ahora: Date = new Date(),
): Promise<SeparacionIntocables | { error: string }> {
  if (ids.length === 0) return { tocables: [], intocables: new Map() };
  const conBoleta = new Set<string>();
  const jobs: JobParaLapida[] = [];
  const tabla = (t: string) => sb.from(t) as Consulta;
  for (let i = 0; i < ids.length; i += TROZO) {
    const trozo = ids.slice(i, i + TROZO);
    const [bols, js] = await Promise.all([
      tabla("boletas_emitidas").select("propuesta_id").eq("empresa_id", empresaId).neq("estado", "anulada").in("propuesta_id", trozo),
      tabla("emision_jobs").select("estado, propuesta_id, expires_at, created_at").eq("empresa_id", empresaId).in("propuesta_id", trozo).in("estado", [...ESTADOS_LAPIDA]),
    ]);
    if (bols.error) return { error: `No se pudo revisar qué boletas ya se emitieron: ${bols.error.message}` };
    if (js.error) return { error: `No se pudo revisar las emisiones en curso: ${js.error.message}` };
    for (const b of (bols.data ?? []) as Array<{ propuesta_id: string | null }>) if (b.propuesta_id) conBoleta.add(b.propuesta_id);
    jobs.push(...((js.data ?? []) as JobParaLapida[]));
  }
  return separarIntocables(ids, conBoleta, jobs, ahora);
}
