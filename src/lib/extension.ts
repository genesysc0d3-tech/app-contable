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
