/**
 * Extrae la imagen del Timbre Electrónico (PDF417) desde el PDF OFICIAL del
 * SII que la extensión captura y guardamos en R2. El timbre es la única imagen
 * embebida del documento (verificado contra PDFs reales 2026-08-20: una sola
 * XObject de ~517×168, que decodificada contiene el TED auténtico con folio y
 * firma CAF). Se re-encodea a PNG con un encoder mínimo propio (zlib de Node,
 * sin dependencias) para incrustarla en la boleta personalizada.
 *
 * SOLO SERVER (pdfjs-dist vive en serverExternalPackages).
 */
import { deflateSync } from "node:zlib";

interface ImagenPdfjs {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
  kind: number; // 1=GRAYSCALE_1BPP, 2=RGB_24BPP, 3=RGBA_32BPP
}

/** Devuelve el timbre como PNG, o null si el PDF no trae imagen reconocible. */
export async function extraerTimbrePng(pdfBytes: Uint8Array): Promise<{ png: Buffer; width: number; height: number } | null> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    // COPIA a propósito: pdf.js se APROPIA del buffer que recibe y lo deja
    // desprendido (largo 0). Sin la copia, el siguiente que quiera leer el
    // mismo PDF —p.ej. `datos-oficiales-dte`— recibe cero bytes y falla en
    // silencio. Leer no puede destruir lo que te pasaron.
    data: new Uint8Array(pdfBytes),
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  try {
    const page = await doc.getPage(1);
    const ops = await page.getOperatorList();

    // Nombres de todas las imágenes pintadas en la página.
    const nombres: string[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] === pdfjs.OPS.paintImageXObject) {
        const nombre = ops.argsArray[i]?.[0];
        if (typeof nombre === "string") nombres.push(nombre);
      }
    }

    // El timbre es la imagen MÁS GRANDE y APAISADA (PDF417 ≈ 3:1). Si el PDF
    // trajera otras (logos del portal), este criterio lo distingue.
    let mejor: ImagenPdfjs | null = null;
    for (const nombre of nombres) {
      const img = await new Promise<ImagenPdfjs | null>((resolve) => {
        try {
          page.objs.get(nombre, (obj: ImagenPdfjs | null) => resolve(obj));
        } catch {
          resolve(null);
        }
      });
      if (!img?.data || !img.width || !img.height) continue;
      if (img.width < img.height) continue; // el timbre siempre es apaisado
      if (!mejor || img.width * img.height > mejor.width * mejor.height) mejor = img;
    }
    if (!mejor) return null;

    const rgb = aRgb24(mejor);
    if (!rgb) return null;
    return { png: encodePngRgb(rgb, mejor.width, mejor.height), width: mejor.width, height: mejor.height };
  } finally {
    // pdfjs v6: destroy vive en distintos lugares según build — best effort.
    try {
      const d = doc as unknown as { destroy?: () => Promise<void>; cleanup?: () => void };
      if (typeof d.destroy === "function") await d.destroy();
      else if (typeof d.cleanup === "function") d.cleanup();
    } catch { /* liberar memoria es best-effort */ }
  }
}

/** Normaliza los kinds de pdfjs a RGB de 3 bytes por píxel. */
function aRgb24(img: ImagenPdfjs): Uint8Array | null {
  const n = img.width * img.height;
  const out = new Uint8Array(n * 3);
  const d = img.data;
  if (img.kind === 2 && d.length >= n * 3) {
    out.set(d.subarray(0, n * 3));
    return out;
  }
  if (img.kind === 3 && d.length >= n * 4) {
    for (let i = 0, j = 0; i < n * 4; i += 4, j += 3) {
      out[j] = d[i]; out[j + 1] = d[i + 1]; out[j + 2] = d[i + 2];
    }
    return out;
  }
  if (img.kind === 1) {
    // 1 bit por píxel, filas alineadas a byte (0=negro, 1=blanco).
    const stride = Math.ceil(img.width / 8);
    if (d.length < stride * img.height) return null;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const bit = (d[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const j = (y * img.width + x) * 3;
        out[j] = v; out[j + 1] = v; out[j + 2] = v;
      }
    }
    return out;
  }
  return null;
}

/** Encoder PNG mínimo (color type 2 = RGB 8-bit, filtro 0). */
function encodePngRgb(rgb: Uint8Array, width: number, height: number): Buffer {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filtro None
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(tipo: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([len, cuerpo, crc]);
}

let tablaCrc: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!tablaCrc) {
    tablaCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tablaCrc[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = tablaCrc[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
