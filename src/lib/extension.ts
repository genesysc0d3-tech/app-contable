/**
 * URL de la extensión "App Contable Motor Local" en la Chrome Web Store.
 *
 * Se setea al PUBLICAR: variable de entorno `NEXT_PUBLIC_EXTENSION_STORE_URL` en
 * Vercel (p.ej. https://chromewebstore.google.com/detail/<id>). Mientras esté vacío
 * (extensión aún no publicada), los botones "Instalar extensión" caen a los pasos de
 * carga manual (descomprimida). Publicás → seteás la env → el botón lleva a la store
 * de una, sin tocar código.
 */
export const EXTENSION_STORE_URL = (process.env.NEXT_PUBLIC_EXTENSION_STORE_URL ?? "").trim();

/** Nombre visible de la extensión (para copys consistentes). */
export const EXTENSION_NOMBRE = "MassDTE — Motor Local";

/**
 * Última versión del paquete que sirve `/descargas/massdte-motor-local.zip` (la que
 * "funciona"). MANTENER EN SYNC con `extensions/sii-portal-rpa/manifest.prod.json` y
 * `modules/core.js` (el test lo verifica). Se muestra en la UI de instalación para que
 * el usuario sepa cuál es la vigente y pueda comparar con la que tiene detectada.
 */
export const EXTENSION_VERSION_ACTUAL = "0.1.8";

/**
 * Piso de compatibilidad: bajo esta versión la app NO emite (banner + bloqueo con
 * instrucciones de actualizar). Es un PISO deliberado, distinto de la ACTUAL:
 * bloquear por "última" dejaría a todos los clientes tiesos durante las horas que
 * tarda el auto-update de Chrome tras cada publicación. Subirlo es una decisión
 * (p.ej. cuando una versión vieja deja de ser segura o compatible con el dominio).
 */
export const EXTENSION_VERSION_MINIMA = "0.1.6";

/** Compara versiones "x.y.z" numéricamente: <0 si a<b, 0 si iguales, >0 si a>b. */
export function compararVersiones(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * ¿La versión detectada está bajo el piso? `null`/inválida NO bloquea (todas las
 * versiones publicadas mandan `extension_version` en el PONG; ante un dato raro
 * preferimos no dejar al usuario fuera por un bug de detección).
 */
export function extensionDesactualizada(version: string | null | undefined): boolean {
  if (!version || !/^\d+(\.\d+)*$/.test(version)) return false;
  return compararVersiones(version, EXTENSION_VERSION_MINIMA) < 0;
}

/** Copy único para el bloqueo por versión (banner y toasts consistentes). */
export function mensajeExtensionDesactualizada(version: string | null | undefined): string {
  const detectada = version ? `Tu extensión está en la versión ${version}` : "Tu extensión está desactualizada";
  return `${detectada} y esta app necesita la ${EXTENSION_VERSION_MINIMA} o superior. Chrome la actualiza solo dentro de unas horas — o al tiro: abre chrome://extensions y aprieta «Actualizar».`;
}

/** ZIP público usado por la instalación manual durante la beta. */
export const EXTENSION_ZIP_URL = "/descargas/massdte-motor-local.zip";
export const EXTENSION_ZIP_FILENAME = "massdte-motor-local.zip";
export const EXTENSION_ZIP_DOWNLOAD_PROPS = {
  href: EXTENSION_ZIP_URL,
  download: EXTENSION_ZIP_FILENAME,
} as const;
