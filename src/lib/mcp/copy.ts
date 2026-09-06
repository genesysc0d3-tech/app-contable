/**
 * Copy compartido del conector MCP — vive fuera de los archivos "use server"
 * (Next solo deja exportar funciones async desde ahí) para que la pantalla de
 * consentimiento y el panel de Empresa digan EXACTAMENTE lo mismo.
 */

/** Bloqueo por plan (fundador 2026-09-06: "el mcp se bloquea en trial, sale gris en su plan y listo"). */
export const MCP_REQUIERE_PLAN =
  "El conector se activa con un plan. En la prueba gratis puedes usar toda la app; el asistente conectado viene con Start, Pro o Business.";
