/**
 * CONTRAPARTE de un movimiento bancario — módulo PURO (sin base, sin servidor):
 * lo usan el aprendizaje de reglas (servidor) y el Check agrupado (navegador).
 *
 *  - extraerPatronContraparte / regexContraparte: la clave con que se acuña una regla
 *    aprendida (se movió desde src/lib/ai/aprender-regla.ts SIN cambiar comportamiento;
 *    aprender-regla.ts las re-exporta).
 *  - claveContraparte: con QUIÉN es el movimiento, para preguntar en grupo (Fase 4 del
 *    plan del clasificador): un RUT válido (módulo 11) manda; una plataforma de pago
 *    (Mercado Pago, Flow, Khipu…) es un CANAL, no una persona; si no, el nombre.
 *  - pareceCuentaPropia: la glosa nombra a la propia empresa (plata que se movió entre
 *    sus cuentas, no una venta).
 */

/**
 * Palabras que NO identifican a una contraparte: verbos bancarios, conectores,
 * canales y entidades genéricas. Se comparan sin acentos y en minúscula.
 */
const RUIDO = new Set<string>([
  // verbos / sustantivos bancarios
  "transferencia", "transferencias", "transf", "tef", "abono", "abonos", "pago",
  "pagos", "deposito", "depositos", "traspaso", "cargo", "giro", "transaccion",
  "compra", "compras", "cobro", "retiro", "webpay", "redcompra", "servipag",
  "recaudacion", "recaudacrecibida", "recibido", "recibida", "enviada", "enviado",
  // conectores
  "de", "a", "para", "por", "desde", "hacia", "con", "el", "la", "los", "las",
  "un", "una", "y", "e", "o", "u", "del", "al", "su", "sus",
  // canales / medios
  "internet", "web", "online", "movil", "app", "banco", "bco", "cuenta", "cta",
  "electronica", "digital", "linea", "sucursal", "caja", "cajero",
  // movimientos INTERNOS del banco (no son contraparte de venta): un sobregiro,
  // un interés o una comisión no identifican a un cliente. Faltaban y por eso se
  // acuñó la regla-basura "SOBREGIRO CTE → Exenta" (2026-09-01).
  "cte", "sobregiro", "credito", "avance", "desembolso", "descubierto",
  "cursado", "interes", "intereses", "comision", "comisiones", "mantencion",
  "impuesto", "impuestos", "reajuste", "dividendo", "dividendos", "cuota",
  "cuotas", "cheque", "cheques", "timbre", "timbres",
  // entidades genéricas (peligrosas como clave: matchean a cualquiera)
  "proveedor", "proveedores", "cliente", "clientes", "varios", "tercero",
  "terceros", "particular", "particulares", "sueldo", "sueldos", "remuneracion",
  "remuneraciones", "honorarios", "arriendo", "servicio", "servicios",
  // formas jurídicas (no identifican a la persona; un "JUAN PEREZ SPA" no es el
  // mismo tercero que "JUAN PEREZ" persona natural, pero tampoco la razón social
  // se distingue por el sufijo → se botan para no ensuciar/inflar el patrón)
  "spa", "ltda", "limitada", "sa", "eirl", "sac", "cia", "hermanos", "hno",
  "hnos", "sociedad",
  // meta
  "ref", "nro", "no", "num", "numero", "comprobante", "folio", "monto", "fecha",
  "saldo", "glosa", "detalle", "operacion", "op", "id",
]);

/**
 * Regex anclada por límites de "no-letra" alrededor del nombre: hace que "MARIA"
 * NO matchee "MARIANA" ni "JUAN" matchee "JUANA" (el substring plano de
 * ilike/contains sobre-matcheaba). Se guarda como patron_tipo="regex" en la
 * regla aprendida (ruleMatches ya tiene camino regex) y se reusa en la
 * propagación. Sin flag `u` (ruleMatches usa `new RegExp(patron,"i")`): el rango
 * à-ÿ cubre los acentos latinos y, con el flag `i`, también sus mayúsculas.
 * El nombre viene de extraerPatronContraparte: solo letras+espacios, sin
 * metacaracteres regex → seguro de interpolar.
 */
export function regexContraparte(nombre: string): string {
  return `(^|[^a-zà-ÿ])${nombre.toLowerCase()}([^a-zà-ÿ]|$)`;
}

function deAccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export interface PatronContraparte {
  /** Nombre de contraparte limpio (solo letras+espacios, ej. "JUAN PEREZ"). */
  patron: string;
}

/**
 * Extrae una clave de contraparte SEGURA desde la glosa de un movimiento.
 * Devuelve null cuando no logra un patrón específico (no aprendemos entonces).
 *
 * Estrategia: limpiar a solo-letras, tokenizar, botar el ruido bancario, y
 * quedarnos con los tokens que identifican a la persona/entidad. Se exige un
 * mínimo de especificidad (≥2 tokens, o 1 token de ≥5 letras) para no crear
 * reglas que matcheen medio mundo.
 */
export function extraerPatronContraparte(
  descripcion: string | null | undefined,
  receptorNombre?: string | null,
): PatronContraparte | null {
  const desde = (raw: string | null | undefined): string[] => {
    // El patrón CONSERVA acentos: matchea contra la glosa cruda vía `ruleMatches`
    // (includes case-insensitive, accent-sensitive). El chequeo de ruido, en
    // cambio, de-acentúa el token para compararlo contra el set ASCII.
    const base = String(raw ?? "")
      .toUpperCase()
      .replace(/[^A-ZÁÉÍÓÚÜÑ\s]/g, " ") // deja letras (con acento); fuera dígitos, horas, refs, puntuación
      .replace(/\s+/g, " ")
      .trim();
    if (!base) return [];
    return base
      .split(" ")
      .filter((t) => t.length >= 2 && !RUIDO.has(deAccent(t).toLowerCase()));
  };

  // Candidato 1: el nombre de receptor que el humano confirmó (si vino y es útil).
  // Candidato 2: la propia glosa. Preferimos el que dé una clave válida; si ambos,
  // la glosa (es la superficie contra la que matchea la regla).
  const tokensGlosa = desde(descripcion);
  const tokensRecep = desde(receptorNombre);

  const armar = (tokens: string[]): PatronContraparte | null => {
    if (tokens.length === 0) return null;
    const usar = tokens.slice(0, 4); // cap: no guardar glosas kilométricas
    const especifico =
      usar.length >= 2 || (usar.length === 1 && usar[0].length >= 5);
    if (!especifico) return null;
    const patron = usar.join(" ");
    if (deAccent(patron).replace(/[^A-Z]/g, "").length < 5) return null;
    return { patron };
  };

  return armar(tokensGlosa) ?? armar(tokensRecep);
}

// ── RUT ─────────────────────────────────────────────────────────────────────────

/** Dígito verificador (módulo 11) del cuerpo de un RUT. */
export function dvRut(cuerpo: string | number): string {
  const digitos = String(cuerpo).replace(/\D/g, "");
  let suma = 0;
  let mult = 2;
  for (let i = digitos.length - 1; i >= 0; i--) {
    suma += Number(digitos[i]) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const r = 11 - (suma % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

/** RUT normalizado "12345678-K" si es válido (módulo 11), si no null. */
export function normalizarRut(rut: string | null | undefined): string | null {
  const limpio = String(rut ?? "").toUpperCase().replace(/[^0-9K]/g, "");
  if (limpio.length < 2) return null;
  const cuerpo = limpio.slice(0, -1).replace(/^0+/, "");
  const dv = limpio.slice(-1);
  if (!/^\d{6,8}$/.test(cuerpo)) return null;
  return dvRut(cuerpo) === dv ? `${cuerpo}-${dv}` : null;
}

/**
 * Primer RUT VÁLIDO escrito en la glosa. Solo con guion antes del dígito verificador
 * ("12.345.678-5", "12345678-5"): una tira de números sin guion es más probable que
 * sea un número de operación que un RUT (y el módulo 11 acierta 1 de cada 11 al azar).
 */
export function rutEnGlosa(descripcion: string | null | undefined): string | null {
  const g = String(descripcion ?? "");
  const re = /(?:^|[^\d.])(\d{1,2}\.\d{3}\.\d{3}|\d{7,8})\s?-\s?([\dkK])(?![\dA-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(g))) {
    // "OP 12345678-5", "N° 12345678-5", "FOLIO 12345678-5": un número de operación, no un RUT.
    const antes = deAccent(g.slice(0, m.index + 1)).toUpperCase();
    if (/\b(OP|OPER|OPERACION|N|NO|NRO|NUM|NUMERO|FOLIO|REF|COMPROBANTE|TRX|ID)\s*[.°º:#-]*\s*$/.test(antes)) continue;
    const ok = normalizarRut(`${m[1]}${m[2]}`);
    if (ok) return ok;
  }
  return null;
}

// ── Plataformas de pago (un CANAL, no una persona) ──────────────────────────────

/** Plataformas que juntan pagos de muchos compradores: la "contraparte" es el canal. */
export const PLATAFORMAS: ReadonlyArray<{ clave: string; nombre: string; re: RegExp }> = [
  { clave: "MERCADOPAGO", nombre: "Mercado Pago", re: /\bMERCADO\s?PAGO\b|\bMERPAGO\b/ },
  { clave: "MERCADOLIBRE", nombre: "Mercado Libre", re: /\bMERCADO\s?LIBRE\b/ },
  { clave: "FLOW", nombre: "Flow", re: /\bFLOW\b/ },
  { clave: "KHIPU", nombre: "Khipu", re: /\bKHIPU\b/ },
  { clave: "WEBPAY", nombre: "Webpay", re: /\bWEBPAY\b|\bTRANSBANK\b/ },
  { clave: "GETNET", nombre: "Getnet", re: /\bGETNET\b/ },
  { clave: "SUMUP", nombre: "SumUp", re: /\bSUM\s?UP\b/ },
  { clave: "BINANCE", nombre: "Binance", re: /\bBINANCE\b/ },
  { clave: "GLOBAL66", nombre: "Global66", re: /\bGLOBAL\s?66\b/ },
  { clave: "PAYPAL", nombre: "PayPal", re: /\bPAY\s?PAL\b/ },
  { clave: "MACH", nombre: "MACH", re: /\bMACH\b/ },
  { clave: "TENPO", nombre: "Tenpo", re: /\bTENPO\b/ },
];

/** Plataforma de pago nombrada en la glosa (o null). */
export function plataformaEnGlosa(descripcion: string | null | undefined): { clave: string; nombre: string } | null {
  const g = deAccent(String(descripcion ?? "")).toUpperCase();
  for (const p of PLATAFORMAS) if (p.re.test(g)) return { clave: p.clave, nombre: p.nombre };
  return null;
}

// ── Clave de contraparte (para agrupar) ─────────────────────────────────────────

export type TipoClave = "rut" | "canal" | "nombre";

export interface ClaveContraparte {
  /** Clave estable para agrupar: "rut:12345678-5", "canal:MERCADOPAGO", "nombre:JUAN PEREZ". */
  clave: string;
  tipo: TipoClave;
  /** Cómo se le muestra a la clienta ("Juan Perez", "Mercado Pago"). */
  etiqueta: string;
  /** Patrón de la regla aprendida (extraerPatronContraparte) si lo hay. */
  patron: string | null;
}

/**
 * Palabras que, solas, NO nombran a una persona en una glosa: medios, bancos, programas
 * del Estado, parentescos. Solo para AGRUPAR (Check agrupado): la clave de las reglas
 * (extraerPatronContraparte) no cambia. Si al sacarlas no queda un nombre → una por una.
 */
const RUIDO_AGRUPAR = new Set<string>([
  "efectivo", "interbancaria", "interbancario", "fondos", "fondo", "traspaso", "traspasos", "vista", "cuenta", "cuentas",
  "chile", "estado", "santander", "bci", "itau", "scotiabank", "scotia", "bice", "security", "falabella", "ripley",
  "internacional", "consorcio", "bancoestado", "edwards", "corpbanca", "coopeuch",
  "bono", "bonos", "ife", "gobierno", "tesoreria", "subsidio",
  "hijo", "hija", "mama", "papa", "mami", "papi",
  "divisas", "divisa", "compra", "abono", "abonos", "deposito", "depositos", "dep",
  // Vuelta 2 (glosas reales de bancos chilenos): medios, canales y conceptos, no personas.
  "bancos", "banco", "otros", "otro", "otras", "vecina", "caja", "cuentarut", "automatico", "cajero",
  "documentos", "documento", "entrante", "entrantes", "dinero", "recibiste", "recibido", "recibida",
  "corriente", "rendimientos", "rendimiento", "ganados", "ganado", "intereses", "interes", "nacionales",
  "nacional", "mismo", "misma", "propia", "propio", "trans", "transf", "tef", "nomina", "pension",
  "anticipo", "aporte", "familiar", "invierno", "transferencia", "transferencias", "electronica",
  // Vuelta 3: abreviaturas y conceptos de previsión/seguros que traen las glosas.
  "trf", "trx", "rec", "recib", "bcos", "bco", "interb", "transfer", "cod", "en", "afp", "isapre", "pgu",
  "compin", "subsidio", "licencia", "rescate", "vencimiento", "plazo", "seguro", "seguros", "cesantia",
  "credito", "social", "aguinaldo", "tapp", "andes", "caja", "ips", "fonasa", "previred", "mutual",
]);

/**
 * Nombre de persona para AGRUPAR, desde la glosa: fuera RUIDO y RUIDO_AGRUPAR ANTES de
 * cortar a 4 palabras (si no, "TRF REC BCOS MARIA JOSE GONZALEZ" y "…MARIA JOSE PEREZ"
 * compartían clave). Exige ≥2 palabras con forma de nombre propio: "CAMILA" sola, "OTROS
 * BANCOS" o "CAJA VECINA" no forman persona (se miran una por una).
 */
export const MIN_TOKENS_NOMBRE = 2;
function nombreParaAgrupar(descripcion: string | null | undefined): string | null {
  const tokens = String(descripcion ?? "")
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÜÑ\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !RUIDO.has(deAccent(t).toLowerCase()) && !RUIDO_AGRUPAR.has(deAccent(t).toLowerCase()))
    .slice(0, 4);
  if (tokens.length < MIN_TOKENS_NOMBRE) return null;
  const out = tokens.join(" ");
  return deAccent(out).replace(/[^A-Z]/g, "").length >= 5 ? out : null;
}

function titulo(s: string): string {
  return s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, esp: string, l: string) => esp + l.toUpperCase());
}

/**
 * ¿Con quién es este movimiento? Orden: plataforma de pago (canal) > RUT válido > nombre.
 * La plataforma va primero porque una transferencia "MERCADOPAGO 76.xxx.xxx-x" trae el
 * RUT de la plataforma, no el del comprador. null = no se reconoce a nadie (la fila no
 * se agrupa: se mira una por una).
 */
export function claveContraparte(
  descripcion: string | null | undefined,
  receptorRut?: string | null,
): ClaveContraparte | null {
  const extra = extraerPatronContraparte(descripcion);
  const patron = extra?.patron ?? null;
  const canal = plataformaEnGlosa(descripcion);
  if (canal) return { clave: `canal:${canal.clave}`, tipo: "canal", etiqueta: canal.nombre, patron };
  const nombre = nombreParaAgrupar(descripcion);
  const rut = rutEnGlosa(descripcion) ?? normalizarRut(receptorRut);
  if (rut) return { clave: `rut:${rut}`, tipo: "rut", etiqueta: nombre ? titulo(nombre) : rut, patron: nombre ? patron : null };
  if (nombre) return { clave: `nombre:${deAccent(nombre).toUpperCase()}`, tipo: "nombre", etiqueta: titulo(nombre), patron };
  return null;
}

// ── ¿Cuenta propia? ─────────────────────────────────────────────────────────────

/** Palabras de razón social demasiado comunes para identificar a la empresa. */
const GENERICAS_EMPRESA = new Set<string>([
  "inversiones", "inversion", "comercial", "comercializadora", "empresa", "empresas",
  "asesorias", "asesoria", "consultora", "consultores", "importadora", "exportadora",
  "distribuidora", "grupo", "sociedad", "servicios",
  "inmobiliaria", "constructora", "ingenieria", "transportes", "tecnologia", "spa",
  "ltda", "limitada", "sa", "eirl", "y", "de", "del", "la", "el", "los", "las", "cia",
]);

function tokensLetras(s: string | null | undefined): string[] {
  return deAccent(String(s ?? ""))
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * ¿La glosa nombra a la PROPIA empresa? (plata movida entre sus cuentas). Conservador:
 * el nombre COMPLETO — todas las palabras propias de la razón social, sin genéricas ni
 * forma jurídica, al menos 2 y ≥5 letras — debe aparecer en la glosa. Un apellido suelto
 * nunca basta (una clienta "Soto" no es la empresa "Maria Soto EIRL"). También la frase
 * explícita "cuenta propia" / "entre cuentas".
 */
export function pareceCuentaPropia(
  descripcion: string | null | undefined,
  razonSocial: string | null | undefined,
  rutEmpresa?: string | null,
): boolean {
  const g = deAccent(String(descripcion ?? "")).toUpperCase();
  if (/\b(CUENTA PROPIA|CTA PROPIA|ENTRE CUENTAS|MISMA CUENTA|MISMO TITULAR|TRANSF(ERENCIA)?\.? PROPIA|TRASPASO PROPIO|TRASPASO ENTRE CUENTAS)\b/.test(g)) return true;
  // El RUT de la propia empresa en la glosa.
  const rut = normalizarRut(rutEmpresa);
  if (rut && rutEnGlosa(descripcion) === rut) return true;
  const razon = tokensLetras(razonSocial);
  const propias = razon.filter((t) => t.length >= 2 && !GENERICAS_EMPRESA.has(t.toLowerCase()) && !NEUTRAS_EMPRESA.has(t.toLowerCase()));
  const glosa = tokensLetras(descripcion);
  const enGlosa = new Set(glosa);
  if (propias.length >= 2 && propias.join("").length >= 5) {
    if (propias.every((t) => enGlosa.has(t))) return true;
    // Persona natural truncada por el banco: "JUAN PEREZ S" = Juan Perez Soto.
    const ultima = propias[propias.length - 1];
    if (propias.length >= 3 && propias.slice(0, -1).every((t) => enGlosa.has(t)) && glosa.some((t) => ultima.startsWith(t))) return true;
    return false;
  }
  // Una sola palabra distintiva ("Comercial Rojas SpA", "Inversiones Lagos Ltda"): cuenta si
  // va JUNTO a una palabra genérica de la razón social ("COMERCIAL ROJAS", "INV LAGOS").
  // La tarjeta "propia" no rechaza de un toque: mejor un falso positivo que esconder ventas.
  if (propias.length === 1 && propias[0].length >= 4 && enGlosa.has(propias[0])) {
    const genericas = razon.filter((t) => GENERICAS_EMPRESA.has(t.toLowerCase()) && !FORMA_O_CONECTOR.has(t.toLowerCase()));
    // Palabra completa, o abreviatura de ≥5 letras exactas ("INVERS" = INVERSIONES); nunca "INV".
    return genericas.some((gen) => glosa.some((t) => t === gen || (t.length >= 5 && gen.startsWith(t))));
  }
  return false;
}

/**
 * Palabras de razón social que también son bancos, plataformas o el país: no cuentan ni
 * como distintivas ni como compañera genérica ("BANCO CHILE ROJAS" no es "Chile Rojas SpA").
 */
const NEUTRAS_EMPRESA = new Set<string>([
  "chile", "chilena", "chileno", "global", "estado", "santander", "bci", "itau", "scotiabank", "bice",
  "security", "falabella", "ripley", "internacional", "consorcio", "banco", "mercado", "pago", "flow",
  "khipu", "tenpo", "mach", "andes",
]);

/** Forma jurídica y conectores de una razón social: no sirven para reconocerla. */
const FORMA_O_CONECTOR = new Set<string>(["spa", "ltda", "limitada", "sa", "eirl", "y", "de", "del", "la", "el", "los", "las", "cia"]);

/** ¿La glosa trae una forma jurídica (SPA, LTDA, S.A., EIRL)? → probablemente una empresa. */
export function pareceEmpresa(descripcion: string | null | undefined): boolean {
  const g = deAccent(String(descripcion ?? "")).toUpperCase();
  return /\b(SPA|LTDA|LIMITADA|EIRL)\b|\bS\.\s?A\.?(?=\s|$)/.test(g);
}
