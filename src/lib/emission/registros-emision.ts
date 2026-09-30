// Registros internos de emisión en `documentos_subidos` (incidente LC 2026-09-27).
//
// Cada boleta que sale por la extensión deja una fila "Boleta SII #<folio> - …"
// (tipo 'boleta_sii_local', src/app/api/sii-local/result/route.ts) y cada DTE de
// SimpleAPI una "DTE SimpleAPI #…" (tipo 'dte_simpleapi'). Son punteros al PDF, no
// cartolas. La mesa listaba los documentos con `.limit(50)` por created_at: LC subió
// su cartola BCI a las 18:08 y emitió 358 boletas ese día → la cartola quedó bajo
// 358 registros y "desapareció" ("sigue sin parecerme cargada").
//
// Criterio: la columna `tipo` (la escriben SOLO esos dos inserts; una subida es
// 'excel'/'pdf'/…). NO se excluye 'boleta_unica': ese tipo es también la SOLICITUD
// de una factura/boleta única (fila que la clienta sí mira y que se actualiza al
// emitir), y el registro del lote mock (sandbox).
// Las filas siguen existiendo (PDF, eliminar-documento, etc.): solo no compiten en
// las listas de documentos subidos.

export const TIPOS_REGISTRO_EMISION = ["boleta_sii_local", "dte_simpleapi"] as const;

/** Valor para `.not("tipo", "in", FILTRO_TIPOS_REGISTRO_EMISION)` de PostgREST. */
export const FILTRO_TIPOS_REGISTRO_EMISION = `(${TIPOS_REGISTRO_EMISION.join(",")})`;

export function esRegistroEmision(tipo: string | null | undefined): boolean {
  return (TIPOS_REGISTRO_EMISION as readonly string[]).includes(tipo ?? "");
}

type BoletaMin = { id: string; propuesta_id?: string | null };
type DocMin = { progreso_ia: unknown };

/**
 * Boletas que la mesa muestra como tarjeta sintética "Boleta única" porque no
 * tienen fila propia en la lista: SOLO las de emisión directa (sin propuesta). Una
 * boleta con propuesta salió de una cartola/solicitud: su lugar es la cartola y
 * "Últimas emitidas", no una tarjeta por boleta (eso era lo que tapaba la lista).
 * Una boleta única por la extensión (sin propuesta) perdió su fila
 * 'boleta_sii_local' en la lista, y reaparece acá.
 */
export function boletasUnicasSinDocumento<B extends BoletaMin>(boletas: B[], docs: DocMin[]): B[] {
  const conDoc = new Set(
    docs.map((d) => (d.progreso_ia as { boleta_id?: string } | null)?.boleta_id).filter((v): v is string => Boolean(v)),
  );
  return boletas.filter((b) => !b.propuesta_id && !conDoc.has(b.id));
}
