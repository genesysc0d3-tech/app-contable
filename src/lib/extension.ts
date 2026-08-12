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
export const EXTENSION_NOMBRE = "App Contable Motor Local";

/**
 * Última versión del paquete que sirve `/descargas/masstest-motor-local.zip` (la que
 * "funciona"). MANTENER EN SYNC con `extensions/sii-portal-rpa/manifest.prod.json` y
 * `modules/core.js` (el test lo verifica). Se muestra en la UI de instalación para que
 * el usuario sepa cuál es la vigente y pueda comparar con la que tiene detectada.
 */
export const EXTENSION_VERSION_ACTUAL = "0.1.4";

/** ZIP público usado por la instalación manual durante la beta. */
export const EXTENSION_ZIP_URL = "/descargas/masstest-motor-local.zip";
export const EXTENSION_ZIP_FILENAME = "masstest-motor-local.zip";
export const EXTENSION_ZIP_DOWNLOAD_PROPS = {
  href: EXTENSION_ZIP_URL,
  download: EXTENSION_ZIP_FILENAME,
} as const;
