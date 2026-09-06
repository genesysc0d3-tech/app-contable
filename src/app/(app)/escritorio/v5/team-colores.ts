// Colores de los miembros del team (satélites, iniciales). EXCLUYEN verde,
// ámbar y rojo: esos son del semáforo tributario y no se les roba la voz.
// Módulo puro (sin acciones) para que el censo lo importe bajo vitest.
export const COLORES_TEAM = ["#5B8DEF", "#9B6BFF", "#2BB3C0", "#E77CC7", "#5FB2E0", "#B58AFF", "#4FA3A3", "#C97BA8"];
export function colorDeMiembro(indice: number): string {
  return COLORES_TEAM[((indice % COLORES_TEAM.length) + COLORES_TEAM.length) % COLORES_TEAM.length];
}
