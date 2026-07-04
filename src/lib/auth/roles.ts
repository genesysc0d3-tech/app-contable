/**
 * Fuente ÚNICA de verdad para los roles con permiso de escritura/emisión.
 *
 * Estaba copiada como `new Set(["owner","admin","contador"])` en ~12 rutas y libs.
 * Centralizarla evita que una cambie y las demás queden con una matriz de permisos
 * distinta (p. ej. sumar un rol nuevo y olvidar habilitarlo en un endpoint).
 */

/** Roles que pueden emitir, aprobar y ejecutar acciones destructivas sobre documentos. */
export const ROLES_EMISION = new Set(["owner", "admin", "contador"]);

export function esRolEmision(rol: string | null | undefined): boolean {
  return !!rol && ROLES_EMISION.has(rol);
}
