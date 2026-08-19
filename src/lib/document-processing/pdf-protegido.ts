/**
 * Cartolas PDF con contraseña.
 *
 * Caso MUY común en Chile: Santander, BancoEstado y otros mandan la cartola por
 * correo como PDF protegido, casi siempre con el RUT del titular como clave
 * (sin puntos ni guion; a veces sin DV, a veces solo los primeros dígitos).
 *
 * Antes: pdf-parse lanzaba PasswordException → caía en el catch general → el job
 * REINTENTABA 3 veces (inútil: la clave no va a aparecer sola) → documento en
 * "error" con un mensaje técnico ("No password given") que el usuario no entiende.
 *
 * Ahora:
 *  1) Se detecta el PDF cifrado y se prueban automáticamente variantes del RUT de
 *     la empresa (el 90% de los bancos chilenos). Si calza, el usuario ni se entera.
 *  2) Si ninguna calza → PdfProtegidoError: error DEFINITIVO (sin reintentos, sin
 *     gastar intentos) con mensaje HUMANO que la UI ya muestra tal cual.
 *
 * La clave nunca se persiste: se usa en memoria para abrir el PDF y se descarta.
 */

/** Error definitivo: el PDF tiene clave y no pudimos abrirlo solos. */
export class PdfProtegidoError extends Error {
  readonly definitivo = true as const;
  constructor(message = MENSAJE_PDF_PROTEGIDO) {
    super(message);
    this.name = "PdfProtegidoError";
  }
}

/** Mensaje humano que ve el usuario (la UI muestra progreso_ia.error tal cual). */
export const MENSAJE_PDF_PROTEGIDO =
  "Esta cartola PDF tiene contraseña y no pudimos abrirla. Abre el PDF con tu clave " +
  "(suele ser tu RUT sin puntos ni guion), guárdalo sin contraseña o expórtalo a Excel, " +
  "y vuelve a subirlo.";

/**
 * Variantes de clave a probar a partir del RUT de la empresa, en orden de
 * probabilidad. Sin duplicados, sin vacíos. Ej: "76.448.088-7" →
 * ["764480887", "76448088", "7644808", "76448"…] (solo las que tengan sentido).
 */
export function variantesClaveDesdeRut(rut: string | null | undefined): string[] {
  const limpio = String(rut ?? "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (limpio.length < 2) return [];
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  const out: string[] = [];
  const push = (v: string) => { if (v && !out.includes(v)) out.push(v); };
  push(cuerpo + dv);            // 764480887  (RUT completo sin puntos ni guion)
  push(cuerpo);                 // 76448088   (sin DV)
  push(cuerpo + dv.toLowerCase()); // con k minúscula si aplica
  if (cuerpo.length > 4) push(cuerpo.slice(0, 4)); // primeros 4 dígitos (algunos bancos)
  if (cuerpo.length > 6) push(cuerpo.slice(0, 6)); // primeros 6 dígitos
  return out;
}

/** Detecta si un error de pdf-parse/pdf.js es "necesita clave" o "clave incorrecta". */
export function esErrorDeClavePdf(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  const msg = String((error as { message?: unknown }).message ?? "");
  return name === "PasswordException" || /no password given|incorrect password/i.test(msg);
}
