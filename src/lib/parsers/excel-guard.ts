import { utils, type WorkSheet } from "xlsx";

// Techo de celdas ANTES de materializar una hoja (auditoría interna, costo/DoS):
// un .xlsx de pocos KB comprimidos puede declarar un rango gigante
// (!ref A1:XFD1048576) y `sheet_to_json` con defval materializa millones de
// strings → OOM de la función (que además vive hasta 5 min con maxDuration).
// Regla: medir el rango DECLARADO antes de expandir; sobre el techo, error
// honesto. Una cartola real va MUY por debajo de esto.
export const MAX_CELDAS_HOJA = 400_000; // ~4.000 filas × 100 columnas

// Tope del body base64 en las rutas que reciben el archivo crudo (≈10MB
// binarios, mismo techo que la validación de subida).
export const MAX_BASE64_LARGO = 14_000_000;

export function hojaExcedeCeldas(sheet: WorkSheet | undefined): boolean {
  const ref = sheet?.["!ref"];
  if (typeof ref !== "string" || !ref) return false;
  try {
    const range = utils.decode_range(ref);
    // OJO: decode_range no lanza con basura — devuelve COORDENADAS NEGATIVAS
    // ({c:-1,r:-1}), con las que rows×cols da 1 y el techo pasa en silencio
    // (fail-open; lo cazó el test). Coordenada negativa o no finita = ref
    // malformado = sospechoso: cerrado.
    const coords = [range.s.r, range.s.c, range.e.r, range.e.c];
    if (coords.some((n) => !Number.isFinite(n) || n < 0)) return true;
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;
    if (rows < 1 || cols < 1) return true;
    return rows * cols > MAX_CELDAS_HOJA;
  } catch {
    // Rango ilegible = archivo sospechoso: cerrado.
    return true;
  }
}
