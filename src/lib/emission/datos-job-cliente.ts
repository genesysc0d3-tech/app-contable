// Lo que el lote manda en `datos` al pedir un job (seguridad de emisión 2026-09-30).
// Módulo SOLO de datos y sin dependencias: lo importa el navegador (useEmisionLote),
// así el bundle del cliente no arrastra el motor de decisión ni el clasificador que
// usa el server para comparar (datos-job.ts). Vuelta 2, V2-B3.

export type DatosJobEnviados = { monto: number; receptor_rut: string | null; glosa: string };

/** Los MISMOS campos que van al payload de la extensión (buildBoletaJob / buildFacturaJob). */
export function datosParaJob(item: { monto: number; receptorRut?: string | null; detalle: string }): DatosJobEnviados {
  return { monto: item.monto, receptor_rut: item.receptorRut ?? null, glosa: item.detalle };
}
