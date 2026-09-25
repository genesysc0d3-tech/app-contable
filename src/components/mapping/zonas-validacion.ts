/**
 * Validación de las zonas del mapeador de cartolas (pura, testeable).
 *
 * Incidente 2026-09-25 (LC, vía Matías): "Falta completar: Fecha es obligatoria"
 * con la columna FECHA ya asignada. La fecha era la PRIMERA columna (índice 0) y
 * el chequeo era `!zoneMap.fecha` → 0 es falsy → "no hay fecha". Solo se
 * notaba cuando la fecha venía primero, que es lo normal en una cartola.
 */
export function mensajeValidacionZonas(zoneMap: Record<string, number | undefined>): string | null {
  if (zoneMap.fecha === undefined) return "Fecha es obligatoria";
  if (zoneMap.descripcion === undefined) return "Descripción / Glosa es obligatoria";
  return null;
}
