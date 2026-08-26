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
// El \b final NO es decorativo: sin él, el patrón muerde el PREFIJO de números
// más largos. Un monto de 8+ dígitos sin separador de miles ($12500000) quedaba
// parcialmente enmascarado, y justo los montos grandes son los que la ley obliga
// a identificar. Con el cierre, o calza el número completo o no calza nada.
const CUENTA_RE = /\b\d{8,}[kK]?\b/g;
// Correo y teléfono. El Art. 2 f) los nombra como identificadores igual que el
// nombre y la cédula, y no estaban cubiertos por ningún patrón — llegan por OCR
// de comprobantes y de chats P2P todo el tiempo.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Deliberadamente CONSERVADOR: exige prefijo país o separadores explícitos. Una
// corrida de 8 dígitos pelados es indistinguible de un número de cuenta, y la
// primera versión de este patrón se comía pedazos de cuentas y de montos — el
// mismo error que ya había costado caro en CUENTA_RE. Un teléfono sin separadores
// cae igual en CUENTA_RE, que para el caso hace el mismo trabajo.
const TELEFONO_RE = /(?:\+?56[\s.-]?)(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}\b|\b9[\s.-]\d{4}[\s.-]\d{4}\b/g;

// Contraparte en glosa BANCARIA real: "[ref] TRANSF[.|ER] [DE|A|DESDE|PARA]? <NOMBRE
// a fin>". Case-insensitive; el nombre puede ir en MAYÚS o Título (que el patrón
// genérico de egress no caza). Se CONSERVA el keyword y la dirección (señal de
// entrada/salida); se tokeniza SOLO el nombre. Espeja inferReceptorNombre del
// clasificador SAGRADO, que ya lee estas glosas.
// Medido contra 1.643 glosas de producción: la versión anterior dejaba escapar el
// nombre en el 16,3% de las glosas que traían uno. Dos causas, ambas acá:
//   · "transf(er)?" NO caza la palabra completa TRANSFERENCIA (tras TRANSFER viene
//     ENCIA, no un espacio) — 109 casos. Y ABONO ni siquiera estaba en la lista — 51 más.
//   · el ancla final ($) exigía que el nombre cerrara la glosa: cualquier cola
//     ("/ REF 998877") desarmaba el patrón entero.
// Ahora las alternativas van de más larga a más corta (para que TRANSFERENCIA gane
// antes que TRANSFER) y el cierre es un lookahead que tolera cola.
const CONTRAPARTE_RE =
  /\b(transferencias?|transferencia|transfer|transf\.?|trf|abonos?|ingresos?|dep[oó]sitos?|tef)(\s+(?:de|a|desde|para|por|recibida|enviada)){0,2}\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'\s]*?[A-Za-zÁÉÍÓÚÑáéíóúñ])(?=[\s.\-]*(?:$|[\/,;|()]|\bref\b|\bn[°º]\b|\d))(?:\s+(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])\b)?/gi;
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
// Un token nuestro, exacto. Se usa para RECONOCERLO y también para RECHAZARLO.
const ES_TOKEN = /^PER_\d+$/;

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
  /**
   * Nombres que resultaron pertenecer a MÁS DE UNA persona dentro del lote
   * (mismo nombre, RUT distinto). Una vez marcado, ese nombre deja de resolver
   * por sí solo: sin RUT no hay forma de saber cuál de las dos es, y adivinar
   * termina en una boleta a nombre del contribuyente equivocado.
   */
  nombresAmbiguos: Set<string>;
}

export function createVault(): Vault {
  return { toReal: new Map(), byRut: new Map(), byName: new Map(), seq: { n: 0 }, nombresAmbiguos: new Set() };
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

  // El RUT manda: identifica sin ambigüedad. El nombre es solo un desempate para
  // cuando no hay RUT.
  let token = (nr && vault.byRut.get(nr)) || null;

  if (!token && nn && !vault.nombresAmbiguos.has(nn)) {
    const porNombre = vault.byName.get(nn);
    if (porNombre) {
      const cur = vault.toReal.get(porNombre)!;
      const curNr = cur.rut ? normRut(cur.rut) : null;
      if (nr && curNr && curNr !== nr) {
        // Dos RUT distintos bajo el mismo nombre: son DOS personas. Antes se
        // fusionaban y la segunda heredaba el RUT de la primera — o sea una
        // boleta real al SII a nombre de alguien que no participó. El nombre
        // queda marcado como ambiguo para que nadie más resuelva por él.
        vault.nombresAmbiguos.add(nn);
        vault.byName.delete(nn);
      } else {
        token = porNombre;
      }
    }
  }

  if (!token) {
    token = `PER_${++vault.seq.n}`;
    vault.toReal.set(token, { rut: rut ?? null, nombre: nombre ?? null });
  } else {
    const cur = vault.toReal.get(token)!;
    if (!cur.rut && rut) cur.rut = rut;
    if (!cur.nombre && nombre) cur.nombre = nombre;
  }
  if (nr) vault.byRut.set(nr, token);
  if (nn && !vault.nombresAmbiguos.has(nn)) vault.byName.set(nn, token);
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
  out = out.replace(CONTRAPARTE_RE, (m, kw: string, dir: string | undefined, nombre: string, rut?: string) => {
    const n = nombre.trim();
    // El RUT pegado va en la MISMA llamada a tokenFor que el nombre: si se dejara
    // para el patrón de RUT suelto, la misma persona saldría partida en dos tokens.
    if (esPlataforma(n) || SIGNAL_RE.test(n)) {
      return rut ? `${kw}${dir ?? ""} ${n} ${tokenFor(vault, rut, null)}` : m;
    }

    // Forma jurídica: antes se conservaba el nombre ENTERO por ser "empresa". Pero
    // un EIRL chileno se llama literalmente "NOMBRE APELLIDO E.I.R.L." y una SpA
    // unipersonal igual — o sea el sufijo que servía de señal "no es persona" era
    // justo el que garantizaba que el nombre civil saliera sin tapar.
    // Se separa: el sufijo SE CONSERVA (es la señal que el clasificador usa para
    // distinguir factura de P2P) y el nombre SE TOKENIZA.
    const forma = n.match(EMPRESA_RE);
    if (forma) {
      const soloNombre = n.slice(0, forma.index).trim().replace(/[,\s]+$/, "");
      if (!soloNombre) return m;
      const t = tokenFor(vault, rut ?? null, soloNombre);
      return `${kw}${dir ?? ""} ${t} ${n.slice(forma.index!).trim()}`;
    }

    return `${kw}${dir ?? ""} ${tokenFor(vault, rut ?? null, n)}`;
  });

  // 0.5) Correo y teléfono: no aportan nada a clasificar y son identificadores
  // directos. Se enmascaran sin entrar a la bóveda (no hay identidad que re-pegar:
  // el receptor se resuelve por nombre/RUT, no por su correo).
  out = out.replace(EMAIL_RE, "[CORREO]");
  out = out.replace(TELEFONO_RE, "[TEL]");

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
  const r = receptor.receptor_rut?.trim();

  if (n && ES_TOKEN.test(n)) {
    const real = vault.toReal.get(n);
    return {
      receptor_nombre: real?.nombre ?? null,
      // Si el RUT que devolvió el modelo también es un token, NO se conserva:
      // antes se colaba literal ("PER_1" como RUT) porque solo se validaba el
      // nombre, pese a que el comentario prometía lo contrario.
      receptor_rut: real?.rut ?? (r && !ES_TOKEN.test(r) ? r : null),
    };
  }

  // El nombre no es token pero el RUT sí: pasaba entero antes de este chequeo.
  if (r && ES_TOKEN.test(r)) {
    const real = vault.toReal.get(r);
    return { receptor_nombre: receptor.receptor_nombre ?? null, receptor_rut: real?.rut ?? null };
  }

  return receptor;
}
