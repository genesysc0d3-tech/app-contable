"use strict";

export const EXT_SOURCE = "app-contable-extension";
export const PROTOCOL_VERSION = 1;
export const EXTENSION_VERSION = "0.1.6";

/**
 * Orígenes de la app permitidos. Transición de dominio (2026-08): se aceptan
 * AMBOS — el viejo (app-contable-five.vercel.app) y el nuevo (app.massdte.cl) —
 * para que la extensión siga funcionando antes, durante y después de mudar la
 * app. Cuando el viejo deje de servir la app (redirige al nuevo), se podrá quitar.
 */
export const APP_ORIGINS = ["https://app.massdte.cl", "https://app-contable-five.vercel.app"];

export function isAllowedAppUrl(url) {
  try {
    const parsed = new URL(url);
    return APP_ORIGINS.includes(parsed.origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(parsed.origin);
  } catch {
    return false;
  }
}

export function baseMessage(message) {
  return {
    source: EXT_SOURCE,
    protocol_version: PROTOCOL_VERSION,
    ...message,
  };
}
