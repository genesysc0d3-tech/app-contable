/**
 * Tokenización de identidad de terceros ANTES del LLM (Ley 19.628 — minimización).
 *
 * El clasificador no necesita saber QUIÉN es la contraparte, solo la forma de la
 * operación. Así que antes de mandar la glosa al modelo, apartamos el nombre y el
 * RUT de la PERSONA a una bóveda efímera y en su lugar dejamos un token estable
 * (`PER_1`, `PER_2`…). El modelo clasifica sobre el token; el código re-pega la
 * identidad real al final. La misma persona → el mismo token dentro del lote, así
 * NO se pierde la señal de "cliente repetido" (que la redacción bruta destruía).
 *
 * CLAVE de diseño:
 *  - La bóveda vive en memoria, por lote. Nunca se persiste (cero silo nuevo de PII).
 *  - Se CONSERVAN intactos: nombres de plataforma (Binance, MercadoPago…) y las
 *    pistas de dirección/activo ("TÚ enviaste", "Comprar", "USDT") — son señal de
 *    clasificación. Solo se tapa el identificador de persona (nombre propio + RUT).
 *  - Reusa la calibración de regex de egress.ts (PII_SRC): una sola fuente.
 *
 * Puro y testeable. NO se cablea al pipeline en este PR — eso entra recién tras el
 * harness A/B que prueba cero regresión de clasificación.
 */

import { PII_SRC } from "./egress";

// nombre (con preposición) + RUT opcional pegado detrás → group1 prep, 2 nombre, 3 rut
const PERSONA_RE = new RegExp(`\\b(${PII_SRC.PREP})\\s+(${PII_SRC.NAME})(?:\\s+(${PII_SRC.RUT}))?`, "g");
// RUT suelto (sin nombre delante)
const RUT_SUELTO_RE = new RegExp(`\\b${PII_SRC.RUT}\\b`, "g");
// Nº de cuenta / referencia (8+ dígitos, con dígito verificador opcional). No aporta
// a clasificar. Ojo: los RUT (con puntos) no tienen 8 dígitos seguidos → no se pisan.
const CUENTA_RE = /\b\d{8,}[kK]?/g;

// Contraparte en glosa BANCARIA real: "[ref] TRANSF[.|ER] [DE|A|DESDE|PARA]? <NOMBRE
// a fin>". Case-insensitive; el nombre puede ir en MAYÚS o Título (que el patrón
// genérico de egress no caza). Se CONSERVA el keyword y la dirección (señal de
// entrada/salida); se tokeniza SOLO el nombre. Espeja inferReceptorNombre del
// clasificador SAGRADO, que ya lee estas glosas.
const CONTRAPARTE_RE =
  /\b(transf(?:er)?\.?|trf)(\s+(?:de|a|desde|para))?\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'?\s]*[A-Za-zÁÉÍÓÚÑáéíóúñ])[\s.\-]*$/gi;
// Señal de clasificación que NUNCA se tokeniza aunque caiga tras "Transf de": cripto,
// plataformas, forex y términos de TIPO de operación (que el clasificador podría usar).
// Si el "nombre" capturado trae esto, es señal, no identidad de un tercero.
const SIGNAL_RE =
  /\b(usdt|usdc|usdd|btc|eth|bnb|dai|trx|sol|xrp|binance|buda|orionx|cryptomkt|kraken|okx|bybit|paypal|mercado\s?pago|global\s?66|western\s?union|forex|d[oó]lar|divisa|cripto|crypto|reembolso|devoluci[oó]n|reverso|anulaci[oó]n|factura|boleta|sueldo|remuneraci[oó]n|honorarios|arriendo|dividendo|pr[eé]stamo|aporte|comisi[oó]n|inter[eé]s|seguro|cuota|iva|sii)\b/i;
// Formas jurídicas (SpA, S.A., Ltda, EIRL): marcan una EMPRESA — persona JURÍDICA (Ley
// 19.628 protege a la natural, no a ésta) y SEÑAL de clasificación (afecta/factura vs P2P).
// El nombre de empresa NO se tokeniza: ni es el PII que protegemos ni conviene ocultarlo.
const EMPRESA_RE = /\b(spa|s\.a\.?|ltda\.?|limitada|eirl|e\.i\.r\.l\.?)\b/i;
// Diacríticos combinantes (para normalizar tildes tras NFD)
const DIACRITICOS_RE = /[\u0300-\u036f]/g;

// Nombres de plataforma que NO son personas: si el filtro los agarra (p. ej.
// "Mercado Pago" son 2 palabras Capitalizadas), se re-inyectan intactos porque a
// veces SON la señal (exento, tipo de operación). Normalizados (minúscula, sin tildes).
const PLATAFORMAS = new Set<string>([
  "mercado pago", "mercadopago", "mercado libre", "mercadolibre",
  "global 66", "global66", "banco estado", "bancoestado", "banco de chile",
  "banco santander", "banco bci", "banco falabella", "banco itau", "banco security",
  "orion x", "orionx", "buda com", "cryptomkt", "crypto mkt", "fintual",
  "western union", "khipu com", "mach app",
]);

export interface Vault {
  /** token ("PER_1") → identidad real */
  toReal: Map<string, { rut: string | null; nombre: string | null }>;
  /** RUT normalizado → token (agrupa "misma persona" por RUT) */
  byRut: Map<string, string>;
  /** nombre normalizado → token (agrupa por nombre cuando no hay RUT) */
  byName: Map<string, string>;
  /** contador de tokens del lote */
  seq: { n: number };
}

export function createVault(): Vault {
  return { toReal: new Map(), byRut: new Map(), byName: new Map(), seq: { n: 0 } };
}

function normRut(rut: string): string {
  return rut.replace(/[^0-9kK]/g, "").toUpperCase();
}

function normName(nombre: string): string {
  return nombre.trim().toLowerCase().normalize("NFD").replace(DIACRITICOS_RE, "");
}

function esPlataforma(nombre: string): boolean {
  return PLATAFORMAS.has(normName(nombre));
}

/**
 * Devuelve el token estable para una persona (por RUT si existe, si no por nombre),
 * creándolo y registrando la identidad real en la bóveda si es nuevo. Fusiona datos:
 * si el token ya existía sin RUT y ahora llega el RUT, lo completa.
 */
function tokenFor(vault: Vault, rut: string | null, nombre: string | null): string {
  const nr = rut ? normRut(rut) : null;
  const nn = nombre ? normName(nombre) : null;

  let token = (nr && vault.byRut.get(nr)) || (nn && vault.byName.get(nn)) || null;
  if (!token) {
    token = `PER_${++vault.seq.n}`;
    vault.toReal.set(token, { rut: rut ?? null, nombre: nombre ?? null });
  } else {
    const cur = vault.toReal.get(token)!;
    if (!cur.rut && rut) cur.rut = rut;
    if (!cur.nombre && nombre) cur.nombre = nombre;
  }
  if (nr) vault.byRut.set(nr, token);
  if (nn) vault.byName.set(nn, token);
  return token;
}

/**
 * Reemplaza en el texto la identidad de personas por tokens, conservando
 * plataformas, señales de dirección/activo, montos y fechas. Muta la bóveda.
 */
export function tokenizeForAI(text: string | null | undefined, vault: Vault): string {
  let out = String(text ?? "");

  // 0) Contraparte de glosa bancaria: "Transf[.|er] [de|a]? <NOMBRE a fin>". Conserva
  // el keyword + dirección (señal); tokeniza el nombre salvo que sea señal/plataforma.
  out = out.replace(CONTRAPARTE_RE, (m, kw: string, dir: string | undefined, nombre: string) => {
    const n = nombre.trim();
    if (esPlataforma(n) || SIGNAL_RE.test(n) || EMPRESA_RE.test(n)) return m;
    return `${kw}${dir ?? ""} ${tokenFor(vault, null, n)}`;
  });

  // 1) Persona = nombre (tras preposición) + RUT opcional pegado.
  out = out.replace(PERSONA_RE, (m, prep: string, nombre: string, rut?: string) => {
    if (esPlataforma(nombre) || SIGNAL_RE.test(nombre) || EMPRESA_RE.test(nombre)) {
      // Conservar (plataforma/señal/empresa); si traía un RUT pegado, tokenizar el RUT.
      return rut ? `${prep} ${nombre} ${tokenFor(vault, rut, null)}` : m;
    }
    return `${prep} ${tokenFor(vault, rut ?? null, nombre)}`;
  });

  // 2) RUTs sueltos (sin nombre delante).
  out = out.replace(RUT_SUELTO_RE, (m: string) => tokenFor(vault, m, null));

  // 3) Números de cuenta largos → marcador (no aportan a clasificar).
  out = out.replace(CUENTA_RE, "[NUM]");

  return out;
}

/**
 * Re-hidrata el receptor que devolvió el modelo: si es un token conocido, restaura
 * la identidad real de la bóveda. Si el modelo inventó un token inexistente, devuelve
 * null (aguas abajo se recupera de la glosa cruda). Si no es token, lo deja igual.
 * NUNCA deja pasar un token literal como nombre de receptor.
 */
export function rehydrateReceptor(
  receptor: { receptor_nombre: string | null; receptor_rut: string | null },
  vault: Vault,
): { receptor_nombre: string | null; receptor_rut: string | null } {
  const n = receptor.receptor_nombre?.trim();
  if (n && /^PER_\d+$/.test(n)) {
    const real = vault.toReal.get(n);
    return {
      receptor_nombre: real?.nombre ?? null,
      receptor_rut: real?.rut ?? receptor.receptor_rut ?? null,
    };
  }
  return receptor;
}
