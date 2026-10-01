// Versión publicada vs versión de la pestaña (actualización invisible, 2026-09-30).
//
// El proxy estampa en CADA respuesta la versión del deploy vivo; la pestaña conoce
// la suya (inyectada en el build, next.config → NEXT_PUBLIC_APP_VERSION). Si una
// respuesta que la pestaña YA pidió trae otra versión, hay deploy nuevo: cero
// pedidos extra, cero sondeo.
//
// OJO: process.env.NEXT_PUBLIC_APP_VERSION se lee LITERAL (Next lo inyecta en el
// build; en Vercel no existe en runtime). Por eso la función pura recibe los
// valores y los envoltorios de abajo los leen con el nombre exacto.

export const CABECERA_VERSION = "x-massdte-version";
/** El server sabe que la pestaña es vieja (p. ej. no mandó `datos` al emitir): "1" = ponte al día. */
export const CABECERA_ACTUALIZAR = "x-massdte-actualizar";
export const VERSION_DEV = "dev";

export type EntornoVersion = {
  nodeEnv?: string;
  app?: string;
  /** Kill switch: ACTUALIZACION_AUTO=false → el server deja de publicar versión → nadie recarga. */
  auto?: string;
  /** Solo para probar en local: el server finge publicar esta versión. */
  simulada?: string;
};

/** Versión que publica el SERVIDOR (null = apagado por kill switch). */
export function versionPublicada(e: EntornoVersion): string | null {
  if (e.auto === "false") return null;
  if (e.simulada) return e.simulada;
  if (e.nodeEnv !== "production") return VERSION_DEV;
  return e.app || null;
}

/** Lado server (proxy, rutas): lee el entorno real. */
export function versionPublicadaDelServidor(): string | null {
  return versionPublicada({
    nodeEnv: process.env.NODE_ENV,
    app: process.env.NEXT_PUBLIC_APP_VERSION,
    auto: process.env.ACTUALIZACION_AUTO,
    simulada: process.env.ACTUALIZACION_VERSION_SIMULADA,
  });
}

/** Lado cliente: la versión con la que se construyó ESTA pestaña. En dev, fija. */
export function versionDelCliente(): string {
  if (process.env.NODE_ENV !== "production") return VERSION_DEV;
  return process.env.NEXT_PUBLIC_APP_VERSION || VERSION_DEV;
}
