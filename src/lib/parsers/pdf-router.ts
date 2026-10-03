import type { Row } from "./types";
import { agruparLineas, esMovimiento, grillaDesdeItems, type ItemPdf } from "./pdf-grilla";
import { detectarFormatoConocido } from "./formatos-conocidos";

/**
 * ROUTER DE PDF (2026-10-02): decide ANTES de leer qué es el PDF, por evidencia
 * POSITIVA y determinística. Solo "cartola" entra al lector de cartolas; todo lo
 * demás sigue el camino de siempre (comprobante corto → lector de comprobantes;
 * lo demás → IA). La duda nunca va al lector: señales de dos tipos, o ninguna
 * clara → "otro".
 *
 * Las señales se buscan FUERA de la tabla de movimientos (encabezado, rótulos,
 * pie): una glosa "PAGO FACTURA 123" o "TRANSFERENCIA A …" es un movimiento de
 * cartola, no una factura ni un comprobante.
 */

export type TipoPdf = "cartola" | "comprobante" | "factura" | "tarjeta" | "otro";

export interface RutaPdf {
  tipo: TipoPdf;
  /** Por qué (códigos cortos, sin datos del documento). */
  motivo: string;
  senales: string[];
  /** Id del formato conocido, si calzó. */
  formato_conocido: string | null;
  /** La grilla armada (vacía si no hay tabla de movimientos). */
  rows: Row[];
  /**
   * Marca PROPIA de banco (por qué el PDF es del banco y no de un tercero):
   * "formato_conocido" · "n_cuenta_banco" · "titulo_cartola" · "nombre_banco".
   * null = sin marca propia: aunque el router la deje pasar como cartola, el
   * lector NUNCA la sella (queda provisoria → popup/revisión).
   */
  marca_banco: string | null;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

type Senal = { id: string; tipo: Exclude<TipoPdf, "cartola" | "otro"> | "no_cartola"; re: RegExp };

/**
 * Señales de documentos que NO son cartola, buscadas en TODO lo de fuera de la
 * tabla. Frases ESPECÍFICAS del documento (no de un aviso).
 */
const NO_CARTOLA: Senal[] = [
  { id: "dte", tipo: "factura", re: /\b(factura|boleta|nota de (credito|debito)|guia de despacho|liquidacion factura)\s+(electronica|exenta|afecta|de honorarios)\b|\bboleta de honorarios\b|\btimbre electronico\b|\bverifique (este )?documento\b|\bres(olucion)?\.? (ex\.? )?n?[°º]?\s?\d+ de \d{4}\b/ },
  { id: "dte_rut_emisor", tipo: "factura", re: /\br\.?\s?u\.?\s?t\.?\s*:?\s*\d{1,2}\.?\d{3}\.?\d{3}-[\dk]\b.*\b(factura|boleta)\b|\b(factura|boleta)\b.*\bs\.?\s?i\.?\s?i\.?\b/ },
  { id: "neto_iva_total", tipo: "factura", re: /\bmonto neto\b|\bneto\b.*\biva\b.*\btotal\b/ },
  { id: "comprobante", tipo: "comprobante", re: /\bcomprobante de (transferencia|pago|deposito|abono)\b|\bmonto transferido\b|\bdatos del destinatario\b|^destinatario\b|\btransferencia (exitosa|realizada|enviada)\b|\bfacturas pagadas\b|\bdocumentos pagados\b/ },
  { id: "nomina", tipo: "comprobante", re: /\bnomina de (pagos?|transferencias?|proveedores|remuneraciones)\b/ },
  { id: "tarjeta", tipo: "tarjeta", re: /\bpago minimo\b|\bfecha (de )?facturacion\b|\bperiodo de facturacion\b|\bmonto (total )?facturado\b/ },
  // Moneda de la CUENTA (un rótulo "Moneda: Dólar"), no un aviso "Dólar observado".
  { id: "moneda_extranjera", tipo: "no_cartola", re: /\bmoneda\s*:?\s*(dolar(es)?|usd|us\$|euros?|eur)\b/ },
  { id: "libro_sii", tipo: "no_cartola", re: /\bregistro de compras y ventas\b|\blibro de (compras|ventas|remuneraciones|honorarios)\b|\bdetalle de (compras|ventas)\b/ },
  { id: "liquidacion", tipo: "no_cartola", re: /\bliquidacion de (sueldo|remuneraciones)\b|\bliquido a pagar\b|\btotal haberes\b|\btotal descuentos\b/ },
];

/**
 * Señales que solo valen en el TÍTULO del documento (las primeras líneas de la
 * 1ª página, antes de la tabla): "Línea de crédito", "Cupo autorizado", "AFP",
 * "Crédito de consumo" o "Dólar" también salen como DATO en el encabezado de una
 * cuenta corriente Pyme o en un pie publicitario ("Simule su Crédito de
 * Consumo", "Paga tus cotizaciones AFP", "Dólar observado").
 */
const NO_CARTOLA_TITULO: Senal[] = [
  { id: "tarjeta_titulo", tipo: "tarjeta", re: /\bestado de cuenta (de )?(la )?tarjeta\b|\btarjeta de credito\b/ },
  { id: "credito_titulo", tipo: "no_cartola", re: /\blinea de credito\b|\bcredito (de consumo|hipotecario|comercial)\b/ },
  { id: "prevision_titulo", tipo: "no_cartola", re: /\bafp\b|\bfondo de pensiones\b|\bcuenta de capitalizacion\b/ },
  { id: "cliente_proveedor_titulo", tipo: "no_cartola", re: /\bestado de cuenta (del |de )?(cliente|proveedor)\b|\bcuenta corriente (de |del )?(cliente|proveedor)\b|\bcuenta (de |del )?(cliente|proveedor)\b/ },
  { id: "moneda_titulo", tipo: "no_cartola", re: /\bdolares\b|\busd\b|\bus\$|\bmoneda extranjera\b/ },
];

/** Marcas FUERTES de cartola bancaria (en el encabezado o el pie, nunca en una glosa). */
const FUERTES: { id: string; re: RegExp }[] = [
  { id: "saldo_inicial", re: /\bsaldo (inicial|anterior)\b/ },
  // N° de cuenta CORRIENTE/VISTA/RUT ("Cuenta Corriente N° 123", "CuentaRUT N°",
  // "Cuenta Vista: 123"). Un "N° cuenta cliente" genérico no.
  // Vuelta 6 (M2): también "Cta. Cte. N° 123" / "Cta Cte 123" y "Cuenta Corriente
  // 0-000-12345-6" (sin N°).
  { id: "n_cuenta_banco", re: /\bn(umero|ro\.?|[°º])?\s*(de )?cuenta ?(corriente|vista|rut)\b|\bcuenta ?(corriente|vista|rut)\s*(n[°º]|nro\.?|numero|:)\s*\d|\bcta\.? ?cte\.?\s*(n[°º]\.?|nro\.?|numero|:)?\s*\d|\bcuenta (corriente|vista)\s+\d[\d.-]{4,}/ },
  { id: "titulo_cartola", re: /\bcartola (de )?(cuenta ?)?(corriente|vista|rut|historica)\b|\bestado de cuenta (corriente|vista)\b(?! (de |del )?(cliente|proveedor))|\bcartola cuenta\b/ },
];
/** Marcas débiles: solas no bastan ("Período" sale en un crédito de consumo). */
const DEBILES: { id: string; re: RegExp }[] = [
  { id: "saldo_final", re: /\bsaldo (final|actual|contable|disponible)\b/ },
  { id: "movimientos", re: /\bmovimientos\b|\bcartola\b/ },
  { id: "periodo", re: /\bperiodo\b|\bdesde\b.*\bhasta\b|^desde\b|^hasta\b/ },
];

/**
 * Títulos de cartola: Fecha + Saldo + (Cargo/Abono · Débito/Crédito · Giros/
 * Depósitos · o una sola columna Monto/Valor/Importe con signo, como las
 * fintech). Pueden venir APILADOS en 2-3 líneas ("Monto cheques" / "o cargos").
 */
function esEncabezadoBancario(t: string): boolean {
  return /\bfecha\b/.test(t) && /\bsaldo\b/.test(t)
    && /\b(cargos?|abonos?|debitos?|creditos?|giros?|depositos?|egresos?|ingresos?|monto|valor|importe)\b/.test(t);
}

/**
 * MARCA PROPIA DE BANCO (vuelta 6, endurecida tras la revisión adversarial):
 * el nombre del banco cuenta SOLO en el ENCABEZADO (antes de la tabla; en el pie
 * sale publicidad, en una glosa la contraparte) y solo como:
 *   - "Banco X" (la razón social del propio banco, "Banco Santander-Chile S.A.",
 *     vale), o
 *   - la marca comercial al INICIO de la línea ("BancoEstado", "Mercado Pago",
 *     "Tenpo", "MACH"…), sin una razón social de un tercero en la línea
 *     ("MACH Ingeniería SpA", "Inversiones Santander Ltda." no son bancos).
 * Nunca como dato de pago ("Banco: Santander", "Su banco: …").
 */
const RE_BANCO_X = /\bbanco (de chile|edwards|estado|santander|bci|de credito e inversiones|itau|scotiabank|bice|security|falabella|ripley|consorcio|internacional|btg( pactual)?|do brasil|de la nacion argentina|hsbc|bbva|corpbanca)\b/;
const RE_MARCA_COMERCIAL = /^(bancoestado|scotiabank|itau|bci|bice|coopeuch|mercado ?pago|tenpo|mach|global ?66|santander|prex|chek|cmr falabella)\b/;
const RE_RAZON_SOCIAL = /\b(ltda|limitada|spa|eirl|e\.i\.r\.l|inversiones|sociedad|comercial|ingenieria|servicios|distribuidora|cia|asesorias|constructora|importadora|exportadora)\b|(^|\s)s\.? ?a\.?($|[\s,])/;
export function esNombreDeBanco(t: string): boolean {
  if (/^banco\s*:|\bsu banco\b/.test(t)) return false;
  if (RE_BANCO_X.test(t)) return /^banco /.test(t) || !RE_RAZON_SOCIAL.test(t);
  return RE_MARCA_COMERCIAL.test(t) && !RE_RAZON_SOCIAL.test(t);
}
/**
 * Datos para PAGARLE a un tercero ("Datos para transferencia:" / "Banco: …" /
 * "Cta Cte N° …" / "a nombre de …"): típico de un estado de cuenta de proveedor.
 * Se evalúa por BLOQUE: el verbo suele ir en una línea y el banco y la cuenta en
 * las siguientes, así que la línea que lo abre y las 3 que siguen quedan fuera
 * de las marcas. Frases de PAGO, no rótulos de un resumen ("Transferencias en
 * línea", "Depósitos", "Pagos" no son instrucción).
 */
const RE_INSTRUCCION_PAGO = /\bdatos (bancarios|para (la |el |su )?(transferencia|deposito|pago|abono)|de (pago|transferencia|deposito))\b|\btransfi?er(ir|a|e) a\b|\btransferencias? a nombre\b|\bdeposit(ar|e|en) (en|a)\b|\bforma de pago\b|\bmedios? de pago\b|\bsu banco\b|\ba nombre de\b|\bpag(ar|ue|uen) (en|a)\b|\brealice (su |el |la )?(pago|deposito|transferencia)\b|\bcancelar (en|a)\b|\b(enviar|remitir) (el )?comprobante\b|^banco\s*:/;
/** Documento COMERCIAL (cuenta corriente mercantil de un proveedor): "Señores: …", "Cliente: …", "RUT cliente". */
const RE_DOC_COMERCIAL = /\b(senor(es|a)?|sr(es|a)?\.?|cliente)\s*:|\brut (del )?cliente\b|\bcodigo (de )?cliente\b/;

/** Factura/boleta con N° en las GLOSAS de la mayoría de los movimientos: estado de cuenta de un proveedor, no del banco. */
const RE_GLOSA_DTE = /\b(factura|boleta|nota de (credito|debito))( electronica)?\s*(n[°º.]?\s*)?\d{2,}/;

const reDe = (id: string) => FUERTES.find((f) => f.id === id)!.re;

/**
 * `sinFormatosConocidos`: solo para medir (scripts): ¿cuántas cartolas reales
 * tendrían marca propia de banco si su formato dejara de ser conocido?
 */
export function clasificarPdf(items: ItemPdf[], opts: { sinFormatosConocidos?: boolean } = {}): RutaPdf {
  const lineas = agruparLineas(items);
  const texto = (l: (typeof lineas)[number]) => norm(l.celdas.map((c) => c.texto).join(" "));
  // Por página: dónde empiezan los títulos (apilados: la línea con "fecha" y sus
  // vecinas) y el CUERPO de la tabla (de los títulos —o el 1er movimiento— al
  // último movimiento). Lo de adentro del cuerpo (glosas partidas "TARJETA DE
  // CREDITO VISA", "Destinatario: …") no es señal de nada; lo de afuera sí,
  // aunque traiga fecha y monto ("Fecha facturación 15/09 · Pago mínimo $ x").
  const fueraIdx: number[] = [];
  const titulo: string[] = [];
  // Encabezado = lo de ANTES de la tabla en cada página (o las 3 primeras
  // líneas de una página sin tabla). Ahí, y solo ahí, vale el nombre del banco.
  const encabezadoIdx: number[] = [];
  let encabezado = false;
  let movs = 0;
  const paginas = [...new Set(lineas.map((l) => l.pagina))];
  for (const p of paginas) {
    const idx = lineas.map((l, i) => (l.pagina === p ? i : -1)).filter((i) => i >= 0);
    const esMov = idx.map((i) => esMovimiento(lineas[i]));
    let h = -1;
    for (let k = 0; k < idx.length && h < 0; k++) {
      if (!/\bfecha\b/.test(texto(lineas[idx[k]])) || esMov[k]) continue;
      const ventana = [k - 1, k, k + 1].filter((j) => j >= 0 && j < idx.length && !esMov[j]).map((j) => texto(lineas[idx[j]])).join(" ");
      if (esEncabezadoBancario(ventana)) h = k;
    }
    if (h >= 0) encabezado = true;
    const desde = h >= 0 ? h : esMov.indexOf(true);
    let hasta = esMov.lastIndexOf(true);
    // Glosa partida DESPUÉS del último movimiento de la página: la línea de
    // continuación (sin fecha ni monto, a menos de un renglón) es del cuerpo.
    if (hasta >= 0) {
      const ys = idx.filter((_, k) => esMov[k]).map((i) => lineas[i].y);
      const pasos = ys.slice(1).map((y, k) => ys[k] - y).filter((d) => d > 0).sort((a, b) => a - b);
      const paso = pasos.length ? pasos[Math.floor(pasos.length / 2)] : 14;
      while (hasta + 1 < idx.length) {
        const sig = lineas[idx[hasta + 1]];
        const cerca = lineas[idx[hasta]].y - sig.y <= Math.max(paso, 8) * 0.95;
        const soloTexto = sig.celdas.every((c) => /[a-z]/i.test(c.texto) && !/\d{1,2}[\/-]\d{1,2}/.test(c.texto) && !/\$\s?-?\d/.test(c.texto));
        if (!cerca || !soloTexto) break;
        hasta++;
      }
    }
    if (p === paginas[0]) {
      // Título = las 2 primeras líneas de la 1ª página, más las que lo anuncian
      // ("Estado de cuenta …", "Cartola …") entre las 5 primeras antes de la tabla.
      const tope = Math.min(desde >= 0 ? desde : idx.length, 5);
      idx.slice(0, tope).forEach((i, k) => {
        const t = texto(lineas[i]);
        if (k < 2 || /^(estado de cuenta|cartola|resumen|detalle|informe)\b/.test(t)) titulo.push(t);
      });
    }
    idx.forEach((i, k) => {
      if (desde >= 0 ? k < desde : k < 3) encabezadoIdx.push(i);
      if (esMov[k] && (h < 0 || k > h)) movs++;
      if (desde < 0 || k < desde || k > hasta) fueraIdx.push(i);
    });
  }
  const fuera = fueraIdx.map((i) => texto(lineas[i]));
  const rows = movs >= 2 ? grillaDesdeItems(items) : [];
  const conocido = rows.length && !opts.sinFormatosConocidos ? detectarFormatoConocido(rows) : null;

  const noCartola = NO_CARTOLA.filter((s) => fuera.some((t) => s.re.test(t)));
  const glosasDte = lineas.filter((l) => esMovimiento(l) && RE_GLOSA_DTE.test(texto(l))).length;
  // Encabezado SIN los bloques de instrucción de pago (la línea que lo abre y las 3 siguientes de la página).
  const enBloquePago = new Set<number>();
  encabezadoIdx.forEach((i) => {
    if (!RE_INSTRUCCION_PAGO.test(texto(lineas[i]))) return;
    for (let j = i; j <= i + 3 && j < lineas.length && lineas[j].pagina === lineas[i].pagina; j++) enBloquePago.add(j);
  });
  const encabezadoTxt = encabezadoIdx.filter((i) => !enBloquePago.has(i)).map((i) => texto(lineas[i]));
  // "ESTADO DE CUENTA CORRIENTE" + "Señores: …" es la cuenta corriente MERCANTIL
  // de un proveedor (M3): ahí solo vale un título que diga "cartola".
  const docComercial = encabezadoIdx.some((i) => RE_DOC_COMERCIAL.test(texto(lineas[i])));
  const esTituloCartola = (t: string) => reDe("titulo_cartola").test(t) && (!docComercial || /\bcartola\b/.test(t));
  const fuertes = FUERTES.filter((s) => fuera.some((t) => (s.id === "titulo_cartola" ? esTituloCartola(t) : s.re.test(t)))).map((s) => s.id);
  // Estado de cuenta de un proveedor: casi TODAS las glosas son facturas con N°
  // y no hay saldo del banco. Una cartola B2B con muchos "PAGO FACTURA 1234"
  // trae saldo anterior/inicial y sigue siendo cartola.
  // MARCA PROPIA DE BANCO (vuelta 6, 2026-10-03): lo que dice que el PDF lo
  // emitió un banco y no un tercero. Formato conocido; N° de cuenta
  // corriente/vista/RUT (fuera de una instrucción de pago "deposite en…"); título
  // de cartola de cuenta; o el nombre de un banco/fintech en el ENCABEZADO. Un
  // "N° de cuenta" sin tipo, "Saldo anterior" o los títulos Fecha/Cargo/Abono/
  // Saldo NO son marca propia: un estado de cuenta de proveedor los trae igual.
  // Las tres marcas de texto se buscan SOLO en el encabezado (no en el pie) y
  // fuera de un bloque de instrucción de pago.
  const marcaBanco: string | null = conocido ? "formato_conocido"
    : encabezadoTxt.some((t) => reDe("n_cuenta_banco").test(t)) ? "n_cuenta_banco"
    : encabezadoTxt.some(esTituloCartola) ? "titulo_cartola"
    : encabezadoTxt.some(esNombreDeBanco) ? "nombre_banco"
    : null;
  // Facturas en las glosas (vueltas 3-4-6). SIN marca propia de banco, desde el
  // 20% de glosas con Factura/Boleta/NC/ND N° ya no se distingue de un estado de
  // cuenta de proveedor (una cartola B2B trae 35-40% de "PAGO FACTURA N°", un
  // proveedor ambiguo 40-59%): → "otro" (la IA, como antes del lector). CON
  // marca: solo ≥80% y sin saldo inicial. Si calza un formato conocido, no aplica.
  const pct = movs ? glosasDte / movs : 0;
  // B2: hace falta más de UNA factura (1 «Pago factura» en 5 movimientos no
  // basta), salvo en un estado de 2-3 movimientos, donde una ya es la mitad.
  const muchasFacturas = !conocido && glosasDte >= 1 && (
    (!marcaBanco && pct >= 0.2 && (glosasDte >= 2 || movs <= 3))
    || (glosasDte >= 3 && pct >= 0.8 && !fuertes.includes("saldo_inicial")));
  if (muchasFacturas) noCartola.push({ id: "facturas_en_glosas", tipo: "no_cartola", re: /$^/ });
  // Señales de TÍTULO: no ganan si el PDF calza un formato conocido, ni sobre una
  // línea que además anuncia la cuenta ("CARTOLA CUENTA CORRIENTE · LÍNEA DE
  // CRÉDITO", "Cuenta Corriente Pyme con Línea de Crédito").
  const RE_CUENTA_EN_TITULO = /\bcuenta ?(corriente|vista|rut)\b/;
  const titulosNoCuenta = titulo.filter((t) => !RE_CUENTA_EN_TITULO.test(t) && !FUERTES.find((f) => f.id === "titulo_cartola")!.re.test(t));
  // "Estado de cuenta corriente del CLIENTE/PROVEEDOR" es de un proveedor aunque
  // diga "cuenta corriente": esa señal no se exime.
  if (!conocido) {
    noCartola.push(...NO_CARTOLA_TITULO.filter((s) => (s.id === "cliente_proveedor_titulo" ? titulo : titulosNoCuenta).some((t) => s.re.test(t))));
  }
  const debiles = DEBILES.filter((s) => fuera.some((t) => s.re.test(t))).map((s) => s.id);
  // La marca va PRIMERO: el evento pdf_ruta guarda las 12 primeras señales.
  const senales = [
    ...(marcaBanco ? [`marca:${marcaBanco}`] : ["sin_marca_banco"]),
    ...noCartola.map((s) => s.id),
    ...fuertes, ...debiles,
    ...(encabezado ? ["encabezado_bancario"] : []),
    ...(conocido ? [`conocido:${conocido.formato.id}`] : []),
  ];
  const base = { senales, formato_conocido: conocido?.formato.id ?? null, rows, marca_banco: marcaBanco };

  // Primero lo que NO es cartola (prioridad pedida): una sola familia → ese tipo;
  // varias → "otro".
  if (noCartola.length) {
    const tipos = [...new Set(noCartola.map((s) => s.tipo))];
    if (tipos.length === 1 && tipos[0] !== "no_cartola") return { ...base, tipo: tipos[0] as TipoPdf, motivo: `senal_${noCartola[0].id}` };
    return { ...base, tipo: "otro", motivo: tipos.length > 1 ? "senales_de_varios_tipos" : `senal_${noCartola[0].id}` };
  }
  if (conocido) return { ...base, tipo: "cartola", motivo: "formato_conocido" };
  // Cartola sin formato conocido: tabla de movimientos + títulos bancarios con
  // saldo + al menos una marca FUERTE (saldo inicial/anterior, N° de cuenta
  // corriente/vista, título de cartola de cuenta). Las débiles solas no bastan.
  if (movs >= 2 && encabezado && fuertes.length >= 1) return { ...base, tipo: "cartola", motivo: "senales_cartola" };
  return {
    ...base,
    tipo: "otro",
    motivo: movs < 2 ? "sin_tabla_de_movimientos" : !encabezado ? "sin_encabezado_bancario" : "sin_marcas_fuertes_de_cartola",
  };
}
