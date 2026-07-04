/**
 * Lectura de comprobantes de transferencia chilenos (BancoEstado, Santander,
 * BCI, Banco de Chile, Global66, Mercado Pago).
 *
 * `parseComprobanteTexto` es una función PURA sobre el texto OCR: heurísticas
 * deterministas, sin red ni IA adicional — por eso es testeable bit a bit.
 * `extraerComprobante` (solo server) encadena el OCR (OpenCode/MiniMax) + el parser.
 *
 * Principio del producto: esto solo PRE-LLENA el formulario de boleta.
 * La emisión SIEMPRE la revisa y aprueba el usuario.
 */

import { ocrImage } from "../ai/ocr";
import { chileDateString } from "../chile-date";

export interface ComprobanteCampos {
  /** Monto de la transferencia en CLP (entero), o null si no se detectó. */
  monto: number | null;
  /** Fecha normalizada YYYY-MM-DD, o null. */
  fecha: string | null;
  /** Comentario/mensaje/asunto del comprobante, o null. */
  glosa: string | null;
  /** Nombre propio de quien pagó (2-4 palabras), o null. */
  pagador: string | null;
  /** 0-1 por campo. Keyword explícita = alta; inferido = media/baja. */
  confianza: { monto: number; fecha: number; pagador: number };
}

export interface ComprobanteExtraccion extends ComprobanteCampos {
  /** Texto completo que devolvió el OCR (para auditoría/debug). */
  textoOcr: string;
}

// ─── Montos ──────────────────────────────────────────────────────────────────

// Palabras que anuncian el monto transferido (no el saldo de la cuenta).
const MONTO_KEYWORDS =
  /\b(monto|total|valor|importe|pag(?:o|ado|aste)|abon(?:o|ado)|transferid[oa]s?|transferiste|enviaste|recibiste|env[ií]o)\b/i;

// Cifras que NO son la transferencia: saldos, cupos, comisiones.
const MONTO_NEGATIVOS = /\b(saldo|disponible|cupo|comisi[oó]n|costo|l[ií]nea de cr[eé]dito)\b/i;

// Número chileno: miles con punto, decimales con coma (",00").
const NUM_CL = "(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,(\\d{1,2}))?";

interface MontoCandidato {
  valor: number;
  index: number;
  conMoneda: boolean;
  conKeyword: boolean;
}

/**
 * Enmascara todo lo que parece número pero no es monto: RUTs, números de
 * cuenta/operación largos, fechas y horas. Se aplica solo a la copia que
 * usa el detector de montos.
 */
function enmascararNoMontos(texto: string): string {
  return texto
    // RUT formateado (12.345.678-5) y sin formato (12345678-5).
    .replace(/\b\d{1,2}(?:\.\d{3}){2}\s*-\s*[\dkK]\b/g, " ")
    .replace(/\b\d{7,8}\s*-\s*[\dkK]\b/g, " ")
    // Fechas ISO y numéricas (dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy).
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g, " ")
    // Horas (14:32, 14:32:05).
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    // Números de operación/cuenta largos: más de 8 dígitos corridos.
    .replace(/\d{9,}/g, " ");
}

function parseNumeroChileno(entero: string, decimales?: string): number | null {
  const digitos = entero.replace(/\./g, "");
  // >8 dígitos = número de operación, no un monto de boleta.
  if (digitos.length === 0 || digitos.length > 8) return null;
  const base = decimales ? Math.round(Number(`${digitos}.${decimales}`)) : Number(digitos);
  if (!Number.isFinite(base) || base <= 0) return null;
  return base;
}

function detectarMonto(texto: string): { monto: number | null; confianza: number } {
  const limpio = enmascararNoMontos(texto);
  // Candidatos indexados por la posición del número (deduplica matches que
  // se pisan entre regexes y fusiona sus señales).
  const candidatos = new Map<number, MontoCandidato>();

  const registrar = (numeroIndex: number, entero: string, decimales: string | undefined, conMoneda: boolean) => {
    const valor = parseNumeroChileno(entero, decimales);
    if (valor === null) return;
    const ventana = limpio.slice(Math.max(0, numeroIndex - 32), numeroIndex);
    if (MONTO_NEGATIVOS.test(ventana)) return; // saldo/cupo/comisión: no es la transferencia
    const previo = candidatos.get(numeroIndex);
    candidatos.set(numeroIndex, {
      valor,
      index: numeroIndex,
      conMoneda: conMoneda || previo?.conMoneda || false,
      conKeyword: MONTO_KEYWORDS.test(ventana) || previo?.conKeyword || false,
    });
  };

  const indexDelNumero = (m: RegExpMatchArray) => (m.index ?? 0) + m[0].indexOf(m[1]);

  // 1) Moneda como prefijo: "$ 45.000", "$45.000", "CLP 45.000", "CLP $45.000".
  for (const m of limpio.matchAll(new RegExp(`(?:\\$|\\bCLP\\b)\\s*\\$?\\s*${NUM_CL}`, "gi"))) {
    registrar(indexDelNumero(m), m[1], m[2], true);
  }
  // 2) Moneda como sufijo: "45.000 CLP", "45.000 pesos".
  for (const m of limpio.matchAll(new RegExp(`${NUM_CL}\\s*(?:CLP|pesos)\\b`, "gi"))) {
    registrar(indexDelNumero(m), m[1], m[2], true);
  }
  // 3) Keyword + número sin símbolo: "Monto: 45000" (dígitos planos solo 4-8).
  for (const m of limpio.matchAll(/\b(?:monto|total|valor|importe)\b[^\d\n]{0,24}(\d{1,3}(?:\.\d{3})+|\d{4,8})(?:,(\d{1,2}))?/gi)) {
    registrar(indexDelNumero(m), m[1], m[2], false);
  }
  // 4) Último recurso: número con formato de miles ("1.000.000") sin más señal.
  if (candidatos.size === 0) {
    for (const m of limpio.matchAll(/(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?/g)) {
      registrar(indexDelNumero(m), m[1], m[2], false);
    }
  }

  if (candidatos.size === 0) return { monto: null, confianza: 0 };

  // El monto "más prominente": repetido y/o con señales fuertes.
  interface Grupo { valor: number; count: number; conMoneda: boolean; conKeyword: boolean; primerIndex: number }
  const porValor = new Map<number, Grupo>();
  for (const c of candidatos.values()) {
    const g = porValor.get(c.valor);
    if (g) {
      g.count += 1;
      g.conMoneda = g.conMoneda || c.conMoneda;
      g.conKeyword = g.conKeyword || c.conKeyword;
      g.primerIndex = Math.min(g.primerIndex, c.index);
    } else {
      porValor.set(c.valor, { valor: c.valor, count: 1, conMoneda: c.conMoneda, conKeyword: c.conKeyword, primerIndex: c.index });
    }
  }
  const score = (g: Grupo) => g.count + (g.conMoneda ? 1.5 : 0) + (g.conKeyword ? 1.5 : 0);
  const grupos = [...porValor.values()].sort((a, b) => score(b) - score(a) || a.primerIndex - b.primerIndex);
  const ganador = grupos[0];

  let confianza: number;
  if (ganador.conMoneda && ganador.conKeyword) confianza = 0.95;
  else if (ganador.conMoneda) confianza = ganador.count >= 2 ? 0.85 : 0.75;
  else if (ganador.conKeyword) confianza = 0.6;
  else confianza = 0.35;
  // Empate cercano entre valores distintos = ambigüedad real del comprobante.
  if (grupos.length > 1 && score(grupos[1]) >= score(ganador) - 0.5) {
    confianza = Math.max(0.2, confianza - 0.15);
  }
  return { monto: ganador.valor, confianza };
}

// ─── Fechas ──────────────────────────────────────────────────────────────────

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};

const FECHA_KEYWORD = /\b(fecha|realizad[oa]|emitid[oa]|emisi[oó]n|d[ií]a)\b/i;

function armarFecha(dia: number, mes: number, anio: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (anio < 2000 || anio > 2099) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function detectarFecha(texto: string, hoy?: Date): { fecha: string | null; confianza: number } {
  const anioActual = Number(chileDateString(hoy).slice(0, 4));
  const candidatos: { fecha: string; confianza: number; index: number }[] = [];

  const agregar = (fecha: string | null, base: number, index: number) => {
    if (!fecha) return;
    const ventana = texto.slice(Math.max(0, index - 16), index);
    const confianza = FECHA_KEYWORD.test(ventana) ? Math.min(0.9, base + 0.15) : base;
    candidatos.push({ fecha, confianza, index });
  };

  // ISO ya normalizado: 2026-06-13.
  for (const m of texto.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    agregar(armarFecha(Number(m[3]), Number(m[2]), Number(m[1])), 0.8, m.index ?? 0);
  }
  // Numérica chilena dd/mm/yyyy, dd-mm-yyyy, dd.mm.yy (siempre día primero).
  for (const m of texto.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g)) {
    const anioRaw = m[3];
    if (anioRaw.length === 3) continue;
    const anio = anioRaw.length === 2 ? 2000 + Number(anioRaw) : Number(anioRaw);
    agregar(armarFecha(Number(m[1]), Number(m[2]), anio), anioRaw.length === 2 ? 0.65 : 0.75, m.index ?? 0);
  }
  // Textual: "13 de junio de 2026", "13 jun 2026", "24 de diciembre" (sin año).
  for (const m of texto.matchAll(/\b(\d{1,2})\s+(?:de\s+)?([a-záéíóúñ]{3,})\.?(?:\s+(?:de\s+|del\s+)?(\d{4}))?\b/gi)) {
    const mes = MESES[m[2].toLowerCase()];
    if (!mes) continue;
    const conAnio = Boolean(m[3]);
    const anio = conAnio ? Number(m[3]) : anioActual;
    agregar(armarFecha(Number(m[1]), mes, anio), conAnio ? 0.75 : 0.45, m.index ?? 0);
  }

  if (candidatos.length === 0) return { fecha: null, confianza: 0 };
  candidatos.sort((a, b) => b.confianza - a.confianza || a.index - b.index);
  return { fecha: candidatos[0].fecha, confianza: candidatos[0].confianza };
}

// ─── Pagador ─────────────────────────────────────────────────────────────────

// Palabra de nombre propio: "María", "González" o sigla bancaria en CAPS.
const NOMBRE_WORD = "(?:[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+|[A-ZÁÉÍÓÚÑÜ]{2,})";
const NOMBRE_RE = new RegExp(`^(${NOMBRE_WORD}(?:\\s+${NOMBRE_WORD}){1,3})`);

// Si aparece una de estas, lo que sigue ya no es parte del nombre.
const PAGADOR_STOPWORDS = new Set([
  "cuenta", "corriente", "vista", "banco", "rut", "run", "cta",
  "numero", "número", "n°", "nº", "desde", "hacia", "transferencia",
]);

function extraerNombre(resto: string): string | null {
  const m = resto.trim().match(NOMBRE_RE);
  if (!m) return null;
  const palabras: string[] = [];
  for (const palabra of m[1].split(/\s+/)) {
    if (PAGADOR_STOPWORDS.has(palabra.toLowerCase())) break;
    palabras.push(palabra);
  }
  if (palabras.length < 2 || palabras.length > 4) return null;
  const nombre = palabras.join(" ");
  return /\d/.test(nombre) ? null : nombre;
}

function detectarPagador(texto: string): { pagador: string | null; confianza: number } {
  // 1) Keyword explícita con dos puntos: "De:", "Desde:", "Origen:", "Nombre:", "Remitente:".
  for (const m of texto.matchAll(/\b(?:desde|origen|nombre|remitente|titular|de)\s*:\s*([^\n]+)/gi)) {
    const nombre = extraerNombre(m[1]);
    if (nombre) return { pagador: nombre, confianza: 0.9 };
  }
  // 2) Inferido de la frase: "Recibiste una transferencia de Juan Pérez".
  for (const m of texto.matchAll(/transferencia\s+de\s+([^\n]+)/gi)) {
    const nombre = extraerNombre(m[1]);
    if (nombre) return { pagador: nombre, confianza: 0.75 };
  }
  return { pagador: null, confianza: 0 };
}

// ─── Glosa ───────────────────────────────────────────────────────────────────

function detectarGlosa(texto: string): string | null {
  // Se exige ":" para no capturar frases tipo "mensaje enviado al destinatario".
  const m = texto.match(/\b(?:comentario|mensaje|asunto|glosa|concepto|motivo)\s*:\s*([^\n]+)/i);
  if (!m) return null;
  const valor = m[1].trim().replace(/^["'«]+|["'»]+$/g, "").trim();
  if (valor.length < 3) return null;
  if (/^(sin\b|no aplica\b|ninguno\b|-+$)/i.test(valor)) return null;
  return valor;
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Parser puro del texto OCR de un comprobante chileno de transferencia.
 * `opciones.hoy` solo se usa para completar el año cuando la fecha viene
 * sin él ("24 de diciembre") — inyectable para tests deterministas.
 */
export function parseComprobanteTexto(texto: string, opciones?: { hoy?: Date }): ComprobanteCampos {
  const fuente = (texto ?? "").normalize("NFC");
  const { monto, confianza: confMonto } = detectarMonto(fuente);
  const { fecha, confianza: confFecha } = detectarFecha(fuente, opciones?.hoy);
  const { pagador, confianza: confPagador } = detectarPagador(fuente);
  return {
    monto,
    fecha,
    glosa: detectarGlosa(fuente),
    pagador,
    confianza: { monto: confMonto, fecha: confFecha, pagador: confPagador },
  };
}

/**
 * OCR (OpenCode/MiniMax) + parser. Solo server: requiere OPENCODE_GO_API_KEY.
 */
export async function extraerComprobante(imageBase64: string, mimeType: string): Promise<ComprobanteExtraccion> {
  const ocr = await ocrImage(imageBase64, mimeType);
  const campos = parseComprobanteTexto(ocr.text);
  return { ...campos, textoOcr: ocr.text };
}
