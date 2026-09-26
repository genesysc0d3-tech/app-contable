/**
 * Boletas "a medias" (puro, testeable).
 *
 * Incidente LC 2026-09-25 (vía Matías): "¿hay forma de saber cuáles 2 boletas
 * dieron error?". Una boleta a medias = el SII la emitió pero la app no alcanzó
 * a leer el folio; su job queda con lápida `revision_pendiente` y la propuesta
 * se EXCLUYE de la cola de Emitir (para que nadie la re-emita → doble folio).
 * Pero el único lugar donde se veían era el modal del lote mientras estaba
 * abierto: al cerrarlo, desaparecían de todas las pestañas. Acá se arma la
 * lista que la pestaña "A medias" muestra con su campo de folio.
 *
 * Una propuesta con varias lápidas (reintentos) sale UNA vez, con el job más
 * reciente (es el que registra el folio a mano). Se ordena por fecha del
 * movimiento y luego por monto, para cotejar contra el Resumen del SII.
 */
export type JobLapida = { job_id: string; propuesta_id: string | null; created_at: string };

export type PropuestaAMedias = {
  id: string;
  total: number | string | null;
  tipo_dte: number | null;
  receptor_nombre: string | null;
  fecha: string | null;
  descripcion: string | null;
  documento_nombre: string | null;
};

export type ItemAMedias = {
  id: string;
  job_id: string;
  fecha: string;
  descripcion: string;
  receptor_nombre: string | null;
  monto_total: number;
  tipo_dte: number | null;
  documento_nombre: string | null;
  /** Cuándo quedó a medias (ISO). */
  lapida_at: string;
};

export function construirAMedias(jobs: JobLapida[], propuestas: PropuestaAMedias[]): ItemAMedias[] {
  const porPropuesta = new Map<string, JobLapida>();
  for (const j of jobs) {
    if (!j.propuesta_id) continue;
    const prev = porPropuesta.get(j.propuesta_id);
    if (!prev || j.created_at > prev.created_at) porPropuesta.set(j.propuesta_id, j);
  }
  const items: ItemAMedias[] = [];
  for (const p of propuestas) {
    const job = porPropuesta.get(p.id);
    if (!job) continue;
    items.push({
      id: p.id,
      job_id: job.job_id,
      fecha: (p.fecha ?? job.created_at).slice(0, 10),
      descripcion: p.descripcion ?? "Sin descripción",
      receptor_nombre: p.receptor_nombre ?? null,
      monto_total: Number(p.total ?? 0),
      tipo_dte: p.tipo_dte ?? null,
      documento_nombre: p.documento_nombre ?? null,
      lapida_at: job.created_at,
    });
  }
  items.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.monto_total - b.monto_total));
  return items;
}
