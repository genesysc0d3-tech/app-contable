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
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

type Senal = { id: string; tipo: Exclude<TipoPdf, "cartola" | "otro"> | "no_cartola"; re: RegExp };

/** Señales de documentos que NO son cartola (cualquiera de ellas manda sobre la cartola). */
const NO_CARTOLA: Senal[] = [
  { id: "dte", tipo: "factura", re: /\b(factura|boleta|nota de (credito|debito)|guia de despacho|liquidacion factura)\s+(electronica|exenta|afecta|de honorarios)\b|\bboleta de honorarios\b|\btimbre electronico\b|\bverifique (este )?documento\b|\bres(olucion)?\.? (ex\.? )?n?[°º]?\s?\d+ de \d{4}\b/ },
  { id: "dte_rut_emisor", tipo: "factura", re: /\br\.?\s?u\.?\s?t\.?\s*:?\s*\d{1,2}\.?\d{3}\.?\d{3}-[\dk]\b.*\b(factura|boleta)\b|\b(factura|boleta)\b.*\bs\.?\s?i\.?\s?i\.?\b/ },
  { id: "neto_iva_total", tipo: "factura", re: /\bmonto neto\b|\bneto\b.*\biva\b.*\btotal\b/ },
  { id: "comprobante", tipo: "comprobante", re: /\bcomprobante de (transferencia|pago|deposito|abono)\b|\bmonto transferido\b|\bdatos del destinatario\b|\bdestinatario\b|\btransferencia (exitosa|realizada|enviada)\b|\bfacturas pagadas\b|\bdocumentos pagados\b/ },
  { id: "nomina", tipo: "comprobante", re: /\bnomina de (pagos?|transferencias?|proveedores|remuneraciones)\b/ },
  { id: "tarjeta", tipo: "tarjeta", re: /\bpago minimo\b|\bcupo (total|disponible|utilizado|nacional|internacional)\b|\bfecha de facturacion\b|\bperiodo de facturacion\b|\bmonto (total )?facturado\b|\btarjeta de credito\b|\bestado de cuenta (de )?tarjeta\b/ },
  { id: "libro_sii", tipo: "no_cartola", re: /\bregistro de compras y ventas\b|\blibro de (compras|ventas|remuneraciones|honorarios)\b|\bdetalle de (compras|ventas)\b/ },
  { id: "liquidacion", tipo: "no_cartola", re: /\bliquidacion de (sueldo|remuneraciones)\b|\bliquido a pagar\b|\btotal haberes\b|\btotal descuentos\b/ },
];

/** Señales de cartola bancaria (en el encabezado o el pie, nunca en una glosa). */
const CARTOLA: { id: string; re: RegExp }[] = [
  { id: "saldo_inicial", re: /\bsaldo (inicial|anterior)\b/ },
  { id: "saldo_final", re: /\bsaldo (final|actual|contable|disponible)\b/ },
  { id: "titulo_cartola", re: /\bcartola\b|\bestado de cuenta (corriente|vista)\b|\bestado de cuenta n[°º]|\bcuenta (corriente|vista|rut)\b|\bmovimientos\b/ },
  { id: "n_cuenta", re: /\bn(umero|ro\.?|[°º])?\s*(de )?cuenta\b|\bcuenta (corriente )?n[°º]/ },
  { id: "periodo", re: /\bperiodo\b|\bdesde\b.*\bhasta\b|^desde\b|^hasta\b/ },
];

/** Línea de títulos de cartola: Fecha + (Cargo/Abono · Débito/Crédito · Giros/Depósitos) + Saldo. */
function esEncabezadoBancario(t: string): boolean {
  return /\bfecha\b/.test(t) && /\bsaldo\b/.test(t)
    && /\b(cargos?|abonos?|debitos?|creditos?|giros?|depositos?|egresos?|ingresos?)\b/.test(t);
}

export function clasificarPdf(items: ItemPdf[]): RutaPdf {
  const lineas = agruparLineas(items);
  const fuera = lineas.filter((l) => !esMovimiento(l)).map((l) => norm(l.celdas.map((c) => c.texto).join(" ")));
  const movs = lineas.filter(esMovimiento).length;
  const rows = movs >= 2 ? grillaDesdeItems(items) : [];
  const conocido = rows.length ? detectarFormatoConocido(rows) : null;

  const noCartola = NO_CARTOLA.filter((s) => fuera.some((t) => s.re.test(t)));
  const cartola = CARTOLA.filter((s) => fuera.some((t) => s.re.test(t))).map((s) => s.id);
  const encabezado = fuera.some(esEncabezadoBancario);
  const senales = [
    ...noCartola.map((s) => s.id),
    ...cartola,
    ...(encabezado ? ["encabezado_bancario"] : []),
    ...(conocido ? [`conocido:${conocido.formato.id}`] : []),
  ];
  const base = { senales, formato_conocido: conocido?.formato.id ?? null, rows };

  // Primero lo que NO es cartola (prioridad pedida): una sola familia → ese tipo;
  // varias → "otro".
  if (noCartola.length) {
    const tipos = [...new Set(noCartola.map((s) => s.tipo))];
    if (tipos.length === 1 && tipos[0] !== "no_cartola") return { ...base, tipo: tipos[0] as TipoPdf, motivo: `senal_${noCartola[0].id}` };
    return { ...base, tipo: "otro", motivo: tipos.length > 1 ? "senales_de_varios_tipos" : `senal_${noCartola[0].id}` };
  }
  if (conocido) return { ...base, tipo: "cartola", motivo: "formato_conocido" };
  // Cartola sin formato conocido: tabla de movimientos + títulos bancarios con
  // saldo + al menos otra marca de cartola (saldo inicial/final, cartola/cuenta,
  // N° de cuenta, período).
  if (movs >= 2 && encabezado && cartola.length >= 1) return { ...base, tipo: "cartola", motivo: "senales_cartola" };
  return { ...base, tipo: "otro", motivo: movs < 2 ? "sin_tabla_de_movimientos" : !encabezado ? "sin_encabezado_bancario" : "sin_marcas_de_cartola" };
}
