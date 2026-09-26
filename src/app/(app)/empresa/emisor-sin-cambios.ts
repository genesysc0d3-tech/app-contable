/**
 * Dirty-check del formulario del emisor (puro, testeable).
 *
 * Incidente 2026-09-25 (LC, vía Matías): "puse exento, le doy a Listo y sigue
 * en automático". Dentro del popup el botón "Guardar" está oculto y el único
 * guardado es "Listo"/cambiar de paso, que solo escribe si algo cambió; y la
 * comparación olvidaba `boletas_tipo_default` y `facturas_tipo_default` (los
 * tipos por carril, 2026-09-04). Cambiar SOLO Boletas → Exento nunca se
 * guardaba. Acá se compara campo por campo, con la lista completa.
 */
export type SnapshotEmisor = {
  rut: string | null;
  razon_social: string;
  giro: string;
  direccion: string;
  comuna: string;
  email_sii: string;
  tipo_contribuyente: string;
  boletas_tipo_default: string;
  facturas_tipo_default: string;
  operacion_hint_default: string | null;
  sociedad_profesionales: boolean;
};

export const CAMPOS_EMISOR: (keyof SnapshotEmisor)[] = [
  "rut", "razon_social", "giro", "direccion", "comuna", "email_sii",
  "tipo_contribuyente", "boletas_tipo_default", "facturas_tipo_default",
  "operacion_hint_default", "sociedad_profesionales",
];

export function emisorSinCambios(datos: SnapshotEmisor, prev: SnapshotEmisor): boolean {
  return CAMPOS_EMISOR.every((k) => (datos[k] ?? null) === (prev[k] ?? null));
}
