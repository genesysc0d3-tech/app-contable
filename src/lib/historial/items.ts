import type { SearchItem } from "../tree-structure";
import { receptorObligatorio } from "../sii/validation";

/**
 * Construcción del item de Historial para una PROPUESTA, con minimización del
 * tercero POR MONTO (Res. Ex. SII 44/2025 + Ley 19.628 / 21.719).
 *
 * Bajo umbral la identidad del tercero NO debe exponerse: ni como título, ni en
 * la ficha, ni en el índice de búsqueda (si no, el Historial se vuelve un
 * "buscador de personas"). La glosa cruda del banco —que suele traer el nombre
 * del pagador, ej. "Transf de YUNISBELL ALEJANDRA"— se reemplaza por el rótulo
 * neutro "Consumidor final" (la MISMA etiqueta que ya usa la app en BoletaVisor
 * y EmitirDirectaView) y los campos identificatorios se ELIMINAN del objeto, de
 * modo que nunca viajan al cliente.
 *
 * Fuente única de verdad del umbral: receptorObligatorio (el mismo predicado que
 * gobierna la emisión). Sobre umbral la ley obliga a identificar al comprador, así
 * que ahí sí se conserva el nombre.
 */
type PropuestaRow = {
  id: string;
  confianza?: number | null;
  created_at?: string | null;
  receptor_rut?: string | null;
  receptor_razon_social?: string | null;
  movimientos_raw?: {
    descripcion?: string | null;
    monto?: number | null;
    documentos_subidos?: { id?: string | null } | null;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
};

export function propuestaReceptorMinimizado(montoClp: number | null | undefined, umbralClp: number): boolean {
  // minimizado = NO obligatorio identificar = monto en o bajo el umbral.
  return !receptorObligatorio(Math.abs(Number(montoClp ?? 0)), umbralClp);
}

export function buildPropuestaItem(prop: PropuestaRow, umbralClp: number): SearchItem {
  const descripcion = prop.movimientos_raw?.descripcion ?? null;
  const minimizado = propuestaReceptorMinimizado(prop.movimientos_raw?.monto, umbralClp);

  const data: Record<string, unknown> = { ...prop, receptor_minimizado: minimizado };
  if (minimizado) {
    // Que la identidad del tercero NO llegue al cliente (ni al DOM, ni al índice).
    delete data.receptor_rut;
    delete data.receptor_razon_social;
    const mr = data.movimientos_raw && typeof data.movimientos_raw === "object"
      ? { ...(data.movimientos_raw as Record<string, unknown>) }
      : null;
    if (mr) {
      delete mr.descripcion; // la glosa cruda es lo que carga el nombre del pagador
      data.movimientos_raw = mr;
    }
  }

  return {
    id: "prop-" + prop.id,
    label: minimizado ? "Propuesta · Consumidor final" : "Propuesta · " + (descripcion ?? "—"),
    subtitle: "Confianza " + Math.round((prop.confianza ?? 0) * 100) + "%",
    type: "propuesta",
    fecha: String(prop.created_at ?? ""),
    data,
  };
}
