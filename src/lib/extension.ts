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
export const EXTENSION_VERSION_ACTUAL = "0.2.4";

/**
 * Piso de compatibilidad: bajo esta versión la app NO emite (banner + bloqueo con
 * instrucciones de actualizar). Es un PISO deliberado, distinto de la ACTUAL:
 * bloquear por "última" dejaría a todos los clientes tiesos durante las horas que
 * tarda el auto-update de Chrome tras cada publicación. Subirlo es una decisión
 * (p.ej. cuando una versión vieja deja de ser segura o compatible con el dominio).
 *
 * 0.1.8 (2026-08-24): bajo esta versión la extensión todavía exige tipear el "RUT
 * de la empresa a emitir" y lo cruza contra el del job → una cuenta con DOS
 * empresas falla siempre en una de las dos (incidente real de una clienta). No es
 * cosmético: quien quede en 0.1.7 con multiempresa no puede emitir igual, así que
 * conviene decírselo antes de que pierda el rato en vez de dejarlo intentar.
 */
export const EXTENSION_VERSION_MINIMA = "0.1.8";

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

/**
 * ¿Hay una versión MÁS NUEVA publicada que la instalada? Señal SUAVE: no bloquea
 * (para eso está el piso `EXTENSION_VERSION_MINIMA`), solo avisa. Sirve para el
 * hueco entre publicar y que Chrome propague el auto-update: el usuario ve que
 * existe algo nuevo en vez de enterarse cuando algo falla.
 */
export function hayVersionNuevaDeExtension(
  version: string | null | undefined,
  // La versión DISPONIBLE (viva en la tienda), no la constante construida. El
  // default preserva callers sin migrar; el flujo real la inyecta (ver
  // extension-server.ts + el context de v5). NUNCA usar EXTENSION_VERSION_ACTUAL
  // como "disponible": esa es la que CONSTRUIMOS, y puede estar en revisión.
  disponible: string = EXTENSION_VERSION_ACTUAL,
): boolean {
  if (!version || !/^\d+(\.\d+)*$/.test(version)) return false;
  return compararVersiones(version, disponible) < 0;
}

/** Una fila de telemetría de extensión (una empresa). */
export interface FilaTelemetriaExtension {
  empresa_id: string;
  version: string | null;
  seen_at: string | null; // ISO; ext_last_seen_at
}

export interface OpcionesVersionDisponible {
  tope: string;   // EXTENSION_VERSION_ACTUAL — techo duro (lo construido)
  minima: string; // EXTENSION_VERSION_MINIMA — piso; también el fallback si no hay señal
  denylist: ReadonlySet<string>; // empresa_id internas/prueba a excluir
  ventanaDias?: number; // recencia de ext_last_seen_at (default 30)
  nMinimo?: number;     // empresas REALES distintas para declarar una versión "viva" (default 2)
}

/** Quita segmentos cero finales para agrupar versiones equivalentes ("0.2.1.0" → "0.2.1"). */
function canonicalizarVersion(v: string): string {
  const partes = v.split(".").map((x) => parseInt(x, 10) || 0);
  while (partes.length > 1 && partes[partes.length - 1] === 0) partes.pop();
  return partes.join(".");
}

/**
 * Deriva qué versión de la extensión está DISPONIBLE (viva en la tienda) a partir
 * de la telemetría de la flota. Regla: una versión está viva ⇔ la corren `nMinimo`
 * empresas REALES distintas (no internas) y RECIENTES; se topea por lo construido
 * (`tope`) y se pisa por `minima`. Sin señal → `minima` (NUNCA sobre-anuncia).
 *
 * Por qué así (bug 2026-09-12): el app anunciaba una versión por una constante
 * hardcodeada (bumpeada al SUBIR), aunque estuviera en revisión. La telemetría es
 * la única señal honesta: si un cliente real la corre, es que está viva. El umbral
 * `nMinimo` + la denylist evitan que una instalación desempaquetada de prueba
 * (p.ej. la del founder) haga de canario falso. Función PURA (recibe las filas),
 * para testear con telemetría envenenada sin tocar la DB.
 */
export function versionDisponibleDeExtension(
  filas: FilaTelemetriaExtension[],
  ahora: Date,
  opts: OpcionesVersionDisponible,
): string {
  const ventanaMs = (opts.ventanaDias ?? 30) * 24 * 60 * 60 * 1000;
  const limite = ahora.getTime() - ventanaMs;
  const nMinimo = opts.nMinimo ?? 2;

  const porVersion = new Map<string, Set<string>>();
  for (const f of filas) {
    if (!f.version || !/^\d+(\.\d+)*$/.test(f.version)) continue; // formato inválido
    if (opts.denylist.has(f.empresa_id)) continue;               // interna/prueba
    if (!f.seen_at) continue;
    const t = Date.parse(f.seen_at);
    if (!Number.isFinite(t) || t < limite) continue;             // rancio
    if (compararVersiones(f.version, opts.tope) > 0) continue;    // > lo construido (dato sucio)
    // Canonicaliza antes de agrupar: "0.2.1" y "0.2.1.0" son la MISMA versión
    // (compararVersiones rellena con 0), pero como strings distintos caerían en
    // buckets separados y ninguno cruzaría el umbral → falso piso. Blinda formatos
    // mixtos (si el manifest algún día migra a 4 partes).
    const canon = canonicalizarVersion(f.version);
    if (!porVersion.has(canon)) porVersion.set(canon, new Set());
    porVersion.get(canon)!.add(f.empresa_id);
  }

  let mejor: string | null = null;
  for (const [v, empresas] of porVersion) {
    if (empresas.size < nMinimo) continue; // un solo canario no vale
    if (mejor === null || compararVersiones(v, mejor) > 0) mejor = v;
  }

  if (mejor === null) return opts.minima; // sin señal viva: no anunciar nada nuevo
  if (compararVersiones(mejor, opts.tope) > 0) mejor = opts.tope;   // clamp techo
  if (compararVersiones(mejor, opts.minima) < 0) mejor = opts.minima; // clamp piso
  return mejor;
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
