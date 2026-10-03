/**
 * CARTOLAS PDF SINTÉTICAS (2026-10-02, "comida para entrenamiento" del lector).
 *
 * Imitan el FORMATO (posiciones, títulos, formatos de fecha y monto, bloques de
 * resumen) de dos familias de cartolas PDF reales que trajo el fundador, leídas
 * SOLO en local. Todo el contenido es INVENTADO con semilla determinística:
 * empresa, RUT, cuenta, ejecutivo, glosas y montos. Los PDFs reales no salen de
 * la máquina ni entran al repo.
 *
 *   "itau"   — Letter. Encabezado de pares etiqueta/valor; "Período: dd/mm/aaaa -
 *              dd/mm/aaaa"; "Saldo anterior cuenta corriente" con el monto en la
 *              línea de ABAJO; tabla Fecha (dd/mm, SIN año) | Nº Operación |
 *              Sucursal | Descripción | "Depósitos / o abonos" (título en 2
 *              líneas) | Giros o cargos | Saldo diario; montos "$1.234.567" con
 *              "$0" en la otra columna; al final "Resumen de Saldos" con Total
 *              cargos / Total Abono / … / "Saldo promedio" + "últimos tres meses"
 *              y los montos 2 líneas más abajo.
 *   "estado" — A4. "ESTADO DE CUENTA N° nn", Desde/Hasta dd-mm-aaaa, "Saldo
 *              Anterior $ x" en la misma línea; tabla Fecha (dd-mm-aaaa) |
 *              Descripción | N° Doc. | Cargos ("$ -12.345") | Abonos | Saldo; el
 *              título se repite en cada página; ~45 movimientos por página.
 *
 * Variantes: multipágina, saldo negativo (sobregiro), glosa partida en 2 líneas,
 * y sabotajes (un monto alterado → el saldo NO cuadra; títulos cargo↔abono
 * cruzados) para comprobar que el lector nunca sella una lectura mala.
 *
 * No lo importa código de producto: solo tests y scripts.
 */

export type FormatoPdf = "itau" | "estado";
export interface MovPdf { fecha: string; monto: number; tipo: "ENTRADA" | "SALIDA"; glosa: string }
export interface OpcionesPdf {
  formato: FormatoPdf;
  seed?: number;
  filas?: number;
  /** Año/mes del período (default 2025-03). */
  anio?: number;
  mes?: number;
  /** Saldo inicial (negativo = parte sobregirada). */
  saldoInicial?: number;
  /** Glosas largas partidas en 2 líneas (cada ~4ª fila). */
  glosaMultilinea?: boolean;
  /** Sabotaje: el monto impreso de una fila no calza con su saldo. */
  montoAlterado?: boolean;
  /** Sabotaje: los títulos de cargo y abono intercambiados (la plata no se mueve). */
  titulosCruzados?: boolean;
  /** Sin la línea de resumen al final (formato "itau"). */
  sinResumen?: boolean;
  /** Un mes con movimientos en UN solo sentido (la otra columna queda vacía). */
  unSentido?: "cargos" | "abonos";
  /** Aviso publicitario al pie de cada página ("Simule su Crédito de Consumo"…). */
  aviso?: string;
  /** Cuenta Pyme: la línea de crédito informada como DATO ("Cupo autorizado $ x") en el encabezado ("estado"). */
  lineaCredito?: boolean;
}
export interface CartolaPdf { pdf: Uint8Array; verdad: MovPdf[]; saldoInicial: number; saldoFinal: number }

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
}

const GLOSAS_IN = [
  "Transf. De Comercial Ficticia", "Deposito En Efectivo", "Pago Proveedores 000111222", "Abono Ventas Tarjeta", "Transferencia De Juan Ejemplo",
];
const GLOSAS_OUT = [
  "Transf. A Servicios Inventados", "Comision Servicio Internet", "Iva Com.transf.electr.fondos", "Pago Bdp Sii 00000000001", "Transferencia A Maria Prueba", "Cheque Pagado Por Canje",
];
const GLOSAS_LARGAS = [
  ["Transferencia A Distribuidora", "Ficticia Del Sur Limitada"],
  ["Pago Cotizaciones Previsionales", "Periodo Anterior Folio 000123"],
];

/** "$1.234.567" (itau) · "$ 1.234.567" / "$ -1.234" (estado). */
function pesos(n: number, conEspacio: boolean): string {
  const s = Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `$${conEspacio ? " " : ""}${n < 0 ? "-" : ""}${s}`;
}
const dd = (n: number) => String(n).padStart(2, "0");

function generarMovs(o: Required<Pick<OpcionesPdf, "seed" | "filas" | "anio" | "mes" | "saldoInicial">> & { glosaMultilinea: boolean; unSentido?: "cargos" | "abonos" }) {
  const r = rng(o.seed);
  const diasMes = new Date(o.anio, o.mes, 0).getDate();
  const movs: (MovPdf & { lineas: string[]; dia: number })[] = [];
  let saldo = o.saldoInicial;
  for (let i = 0; i < o.filas; i++) {
    const dia = Math.min(diasMes, 1 + Math.floor((i * diasMes) / o.filas));
    // Sobregiro: si el saldo inicial es negativo, los cargos dominan un rato.
    const azar = o.saldoInicial < 0 ? r() < 0.35 : r() < 0.45;
    const entrada = o.unSentido ? o.unSentido === "abonos" : azar;
    const monto = Math.round((3_000 + r() * 2_500_000) / 10) * 10;
    const larga = o.glosaMultilinea && i % 4 === 1;
    const lineas = larga
      ? GLOSAS_LARGAS[i % GLOSAS_LARGAS.length]
      : [(entrada ? GLOSAS_IN : GLOSAS_OUT)[Math.floor(r() * (entrada ? GLOSAS_IN.length : GLOSAS_OUT.length))]];
    saldo += entrada ? monto : -monto;
    movs.push({ fecha: `${o.anio}-${dd(o.mes)}-${dd(dia)}`, monto, tipo: entrada ? "ENTRADA" : "SALIDA", glosa: lineas.join(" "), lineas, dia });
  }
  return { movs, saldoFinal: saldo };
}

export async function cartolaPdfSintetica(opts: OpcionesPdf): Promise<CartolaPdf> {
  const o = {
    seed: opts.seed ?? 7,
    filas: opts.filas ?? 12,
    anio: opts.anio ?? 2025,
    mes: opts.mes ?? 3,
    saldoInicial: opts.saldoInicial ?? 4_500_000,
    glosaMultilinea: opts.glosaMultilinea ?? false,
    unSentido: opts.unSentido,
  };
  const { movs, saldoFinal } = generarMovs(o);
  const { jsPDF } = await import("jspdf");
  const doc = opts.formato === "itau"
    ? new jsPDF({ unit: "pt", format: "letter" })
    : new jsPDF({ unit: "pt", format: "a4" });
  doc.setFont("helvetica", "normal");
  const t = (s: string, x: number, y: number, size = 7) => { doc.setFontSize(size); doc.text(s, x, y); };
  const tr = (s: string, xDer: number, y: number, size = 7) => { doc.setFontSize(size); doc.text(s, xDer, y, { align: "right" }); };
  const ultimoDia = new Date(o.anio, o.mes, 0).getDate();
  const desde = `01/${dd(o.mes)}/${o.anio}`;
  const hasta = `${dd(ultimoDia)}/${dd(o.mes)}/${o.anio}`;
  // Sabotaje: la fila del medio imprime otro monto (el saldo impreso sigue el verdadero).
  const iAlterada = opts.montoAlterado ? Math.floor(movs.length / 2) : -1;
  const impreso = (i: number) => (i === iAlterada ? movs[i].monto + 10_000 : movs[i].monto);
  let totalCargos = 0;
  let totalAbonos = 0;
  movs.forEach((m, i) => { if (m.tipo === "ENTRADA") totalAbonos += impreso(i); else totalCargos += impreso(i); });

  if (opts.formato === "itau") {
    const pie = (pag: number) => {
      t("(600) 000 0000", 97, 682); t("Banco Ejemplo Phone y Emergencias", 97, 693); t("Bancarias", 97, 702);
      t("Servicio Empresas", 386, 682);
      t("Infórmese sobre la garantía estatal de los depósitos en su banco o en www.cmfchile.cl", 122, 709, 6);
      t(`Página ${pag}`, 508, 733);
    };
    const titulos = (y: number) => {
      const [tAbono, tCargo] = opts.titulosCruzados ? [["Giros o", "cargos"], ["Depósitos o abonos"]] : [["Depósitos", "o abonos"], ["Giros o cargos"]];
      t("Fecha", 76, y); t("Nº Operación", 127, y); t("Sucursal", 193, y); t("Descripción", 240, y);
      t(tAbono[0], 366, y); if (tAbono[1]) t(tAbono[1], 369, y + 9);
      t(tCargo.join(" "), 416, y); t("Saldo diario", 487, y);
    };
    t("Banco Ejemplo Empresas", 112, 46, 10);
    t("Cuenta Corriente 0001234567", 72, 102); t(`${hasta} 10:20:30`, 457, 102);
    t("Cartola Histórica", 72, 122); t("Período", 259, 122); t(`: ${desde} - ${hasta}`, 293, 122);
    t("Estado de Cuenta Corriente", 72, 148, 9);
    const pares: [string, string, string, string][] = [
      ["Nombre", ": Comercial Ejemplo Limitada", "", ""],
      ["Dirección", ": Calle Inventada 123", "Número de cuenta", ": 0001234567"],
      ["Comuna", ": Comuna Ficticia", "Estado Número", ": 101"],
      ["Ciudad", ": Santiago", "Período", `: ${desde} - ${hasta}`],
      ["Código Postal", ": 0", "Email cliente", ": contacto@ejemplo.cl"],
      ["Ejecutivo", ": Ejecutiva De Prueba", "Teléfono", ": 220000000"],
    ];
    pares.forEach(([a, b, c, d], k) => { const y = 172 + k * 12.5; t(a, 72, y); t(b, 142, y); if (c) { t(c, 306, y); t(d, 386, y); } });
    t("Moneda", 128, 286); t("Monto línea de crédito", 243, 286); t("Monto utilizado", 419, 286);
    t("Peso chileno", 119, 299); t("$0", 278, 295); t("$0", 442, 295);
    t("Monto disponible", 112, 323); t("Fecha vencimiento", 249, 323); t("Saldo anterior cuenta corriente", 392, 323);
    t("$0", 138, 333); t(pesos(o.saldoInicial, false), 424, 333);
    t("Movimientos", 72, 357, 8);
    titulos(372);
    let y = 411;
    let pag = 1;
    let saldo = o.saldoInicial;
    movs.forEach((m, i) => {
      const alto = m.lineas.length > 1 ? 30 : 20.5;
      if (y + alto > 670) {
        pie(pag); doc.addPage(); pag++;
        t("Banco Ejemplo Empresas", 112, 46, 10);
        titulos(80); y = 115;
      }
      saldo += m.tipo === "ENTRADA" ? m.monto : -m.monto;
      t(`${dd(Number(m.fecha.slice(8)))}/${dd(o.mes)}`, 76, y); t(String(900000000 + i * 137), 127, y); t("0100", 193, y);
      t(m.lineas[0], 240, y); if (m.lineas[1]) t(m.lineas[1], 240, y + 9);
      tr(pesos(m.tipo === "ENTRADA" ? impreso(i) : 0, false), 400, y);
      tr(pesos(m.tipo === "SALIDA" ? impreso(i) : 0, false), 466, y);
      tr(pesos(saldo, false), 527, y);
      y += alto;
    });
    if (!opts.sinResumen) {
      if (y + 50 > 670) { pie(pag); doc.addPage(); pag++; y = 90; }
      y += 10;
      t("Resumen de Saldos", 72, y, 8);
      t("Total cargos", 90, y + 16); t("Total Abono", 200, y + 16); t("Pago productos mismo Banco", 300, y + 16); t("Saldo promedio", 450, y + 16);
      t("últimos tres meses", 450, y + 25);
      t(pesos(totalCargos, false), 90, y + 38); t(pesos(totalAbonos, false), 200, y + 38); t("$0", 300, y + 38);
      t(pesos(Math.round((o.saldoInicial + saldoFinal) / 2), false), 450, y + 38);
    }
    pie(pag);
  } else {
    const desdeG = desde.replace(/\//g, "-");
    const hastaG = hasta.replace(/\//g, "-");
    const titulos = (y: number) => {
      const [tc, ta] = opts.titulosCruzados ? ["Abonos", "Cargos"] : ["Cargos", "Abonos"];
      t("Fecha", 42, y); t("Descripción", 94, y); t("N° Doc.", 351, y); t(tc, 403, y); t(ta, 454, y); t("Saldo", 505, y);
    };
    t(`ESTADO DE CUENTA N° ${dd(o.mes)}`, 451, 148, 8);
    t("Cliente", 42, 162); t("COMERCIAL EJEMPLO LIMITADA", 119, 162);
    t("Dirección", 42, 176); t("AVENIDA INVENTADA", 119, 176); t("Número Cuenta", 300, 176); t("000111222333", 377, 176);
    t("Desde", 42, 190); t(desdeG, 119, 190); t("Hasta", 300, 190); t(hastaG, 377, 190);
    t("Saldo Anterior", 42, 204); t(pesos(o.saldoInicial, true), 119, 204); t("Depositos / Abonos", 300, 204); t(pesos(totalAbonos, true), 377, 204);
    t("Cargos / Giros", 42, 218); t(pesos(totalCargos, true), 119, 218); t("Saldo Actual", 300, 218); t(pesos(saldoFinal, true), 377, 218);
    t("Ejecutivo", 42, 232); t("EJECUTIVO DE PRUEBA", 119, 232); t("Sucursal", 300, 232); t("OFICINA CENTRO", 377, 232);
    if (opts.lineaCredito) { t("Línea de crédito", 42, 246); t("Cupo autorizado $ 5.000.000", 119, 246); t("Cupo utilizado $ 0", 300, 246); }
    titulos(266);
    let y = 280;
    let saldo = o.saldoInicial;
    movs.forEach((m, i) => {
      const alto = m.lineas.length > 1 ? 21 : 12.4;
      if (y + alto > 800) { doc.addPage(); titulos(60); y = 74; }
      saldo += m.tipo === "ENTRADA" ? m.monto : -m.monto;
      t(`${dd(Number(m.fecha.slice(8)))}-${dd(o.mes)}-${o.anio}`, 42, y);
      t(m.lineas[0], 94, y); if (m.lineas[1]) t(m.lineas[1], 94, y + 9);
      t(i % 3 === 0 ? String(4000000 + i * 31) : "0", 351, y);
      if (m.tipo === "SALIDA") tr(pesos(-impreso(i), true), 449, y);
      else tr(pesos(impreso(i), true), 501, y);
      tr(pesos(saldo, true), 553, y);
      y += alto;
    });
    if (y + 30 > 820) { doc.addPage(); y = 60; }
    t("ANTECEDENTES REFERENCIALES SUJETOS A CONFIRMACIÓN, INFÓRMESE SOBRE", 42, y + 14);
    t("LA GARANTÍA ESTATAL DE LOS DEPÓSITOS EN SU BANCO O EN WWW.EJEMPLO.CL", 42, y + 23);
  }
  if (opts.aviso) {
    const total = doc.getNumberOfPages();
    for (let k = 1; k <= total; k++) { doc.setPage(k); t(opts.aviso, 42, opts.formato === "itau" ? 760 : 830, 6); }
  }
  const pdf = new Uint8Array(doc.output("arraybuffer"));
  return { pdf, verdad: movs.map(({ fecha, monto, tipo, glosa }) => ({ fecha, monto, tipo, glosa })), saldoInicial: o.saldoInicial, saldoFinal };
}

// ---------------------------------------------------------------------------
// NEGATIVOS: PDFs que NO son cartola pero traen tablas con fecha y monto (la
// regla vieja "≥2 filas con fecha+monto = cartola" los mandaba al lector).
// Todo inventado.

export type TipoNegativo =
  | "factura_sii" | "comprobante_transferencia" | "comprobante_facturas_pagadas" | "nomina_transferencias"
  | "tarjeta_credito" | "rcv_libro_compras" | "liquidacion_sueldo" | "estado_cuenta_cliente" | "cartola_linea_credito";
export const TIPOS_NEGATIVOS: TipoNegativo[] = [
  "factura_sii", "comprobante_transferencia", "comprobante_facturas_pagadas", "nomina_transferencias",
  "tarjeta_credito", "rcv_libro_compras", "liquidacion_sueldo", "estado_cuenta_cliente", "cartola_linea_credito",
];
/** Tipo que el router debería decir (o "otro" si no es uno de los 4 tipos con flujo propio). */
export const ESPERADO_NEGATIVO: Record<TipoNegativo, string> = {
  factura_sii: "factura", comprobante_transferencia: "comprobante", comprobante_facturas_pagadas: "comprobante",
  nomina_transferencias: "comprobante", tarjeta_credito: "tarjeta", rcv_libro_compras: "otro", liquidacion_sueldo: "otro",
  estado_cuenta_cliente: "otro", cartola_linea_credito: "otro",
};

export async function negativoPdfSintetico(tipo: TipoNegativo, seed = 1, filas = 8): Promise<Uint8Array> {
  const r = rng(seed);
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFont("helvetica", "normal");
  const t = (s: string, x: number, y: number, size = 8) => { doc.setFontSize(size); doc.text(s, x, y); };
  const tr = (s: string, x: number, y: number, size = 8) => { doc.setFontSize(size); doc.text(s, x, y, { align: "right" }); };
  const monto = () => Math.round((5_000 + r() * 900_000) / 10) * 10;
  const fecha = (i: number) => `${dd(1 + (i % 27))}/${dd(1 + (seed % 12))}/2026`;
  const tabla = (y0: number, titulos: [string, number][], fila: (i: number) => [string, number, boolean?][]) => {
    titulos.forEach(([s, x]) => t(s, x, y0));
    for (let i = 0; i < filas; i++) {
      const y = y0 + 16 + i * 13;
      if (y > 800) { doc.addPage(); }
      fila(i).forEach(([s, x, der]) => (der ? tr(s, x, y) : t(s, x, y)));
    }
    return y0 + 16 + filas * 13;
  };
  if (tipo === "factura_sii") {
    t("COMERCIAL EJEMPLO SPA", 40, 50, 11); t("Giro: Venta de artículos ficticios", 40, 64);
    t("R.U.T.: 76.111.111-6", 400, 50, 10); t("FACTURA ELECTRONICA", 400, 64, 10); t(`N° ${1000 + seed}`, 430, 78, 10);
    t("S.I.I. - SANTIAGO CENTRO", 400, 92);
    t(`Fecha Emision: ${fecha(0)}`, 40, 110); t("Señor(es): CLIENTE FICTICIO LTDA", 40, 124);
    const y = tabla(150, [["Fecha", 40], ["Código", 110], ["Descripción", 170], ["Cantidad", 360], ["Precio", 430], ["Total", 520]],
      (i) => [[fecha(i), 40], [`P-${100 + i}`, 110], [`Producto ficticio ${i + 1}`, 170], [String(1 + (i % 4)), 380], [`$ ${monto().toLocaleString("es-CL")}`, 470, true], [`$ ${monto().toLocaleString("es-CL")}`, 555, true]]);
    t("MONTO NETO", 400, y + 20); tr("$ 1.000.000", 555, y + 20); t("IVA 19%", 400, y + 34); tr("$ 190.000", 555, y + 34); t("TOTAL", 400, y + 48); tr("$ 1.190.000", 555, y + 48);
    t("Timbre Electrónico SII", 40, y + 70); t("Res. 80 de 2014 - Verifique documento: www.sii.cl", 40, y + 84);
  } else if (tipo === "comprobante_transferencia" || tipo === "comprobante_facturas_pagadas") {
    t("Banco Ejemplo", 40, 50, 12); t("Comprobante de Transferencia", 40, 70, 11);
    t("Transferencia realizada con éxito", 40, 88);
    t(`Fecha: ${fecha(0)} 10:22`, 40, 110); t(`Monto transferido: $ ${monto().toLocaleString("es-CL")}`, 40, 124);
    t("Datos del destinatario", 40, 146); t("Nombre: Proveedor Ficticio SpA", 40, 160); t("Cuenta: 000123456", 40, 174);
    if (tipo === "comprobante_facturas_pagadas") {
      t("Facturas pagadas", 40, 200, 10);
      tabla(216, [["Fecha", 40], ["N° Factura", 130], ["Detalle", 220], ["Monto", 520]],
        (i) => [[fecha(i), 40], [String(2000 + i), 130], ["Pago factura proveedor", 220], [`$ ${monto().toLocaleString("es-CL")}`, 555, true]]);
    }
  } else if (tipo === "nomina_transferencias") {
    t("Banco Ejemplo Empresas", 40, 50, 12); t("Nómina de Transferencias", 40, 70, 11); t("Estado: Procesada", 40, 86);
    tabla(110, [["Fecha", 40], ["Nombre beneficiario", 110], ["RUT", 300], ["Banco", 380], ["Monto", 520]],
      (i) => [[fecha(i), 40], [`Beneficiario Ficticio ${i + 1}`, 110], [`1${i}.111.111-1`, 300], ["Banco Inventado", 380], [`$ ${monto().toLocaleString("es-CL")}`, 555, true]]);
  } else if (tipo === "tarjeta_credito") {
    t("Estado de Cuenta Tarjeta de Crédito", 40, 50, 12); t("Titular: PERSONA FICTICIA", 40, 66);
    t("Cupo total $ 3.000.000", 40, 84); t("Cupo utilizado $ 1.200.000", 220, 84); t("Cupo disponible $ 1.800.000", 400, 84);
    t(`Fecha de facturación: ${fecha(2)}`, 40, 100); t("Pago mínimo $ 85.000", 300, 100); t("Monto total facturado $ 640.000", 40, 114);
    tabla(140, [["Fecha", 40], ["Descripción", 110], ["Cuotas", 330], ["Cargos", 400], ["Abonos", 460], ["Saldo", 520]],
      (i) => [[fecha(i), 40], [`Compra comercio ficticio ${i + 1}`, 110], [`${1 + (i % 3)}/3`, 330], [`$ ${monto().toLocaleString("es-CL")}`, 440, true], ["$ 0", 495, true], [`$ ${monto().toLocaleString("es-CL")}`, 555, true]]);
  } else if (tipo === "rcv_libro_compras") {
    t("Registro de Compras y Ventas", 40, 50, 12); t("Detalle de Compras - Periodo 2026-09", 40, 66); t("RUT contribuyente: 76.222.222-2", 40, 80);
    tabla(110, [["Fecha Docto", 40], ["Tipo Doc", 110], ["Folio", 170], ["RUT Proveedor", 220], ["Neto", 380], ["IVA", 450], ["Total", 520]],
      (i) => [[fecha(i), 40], ["33", 120], [String(5000 + i), 170], [`7${i}.333.333-3`, 220], [`$ ${monto().toLocaleString("es-CL")}`, 420, true], [`$ ${monto().toLocaleString("es-CL")}`, 490, true], [`$ ${monto().toLocaleString("es-CL")}`, 555, true]]);
  } else if (tipo === "estado_cuenta_cliente" || tipo === "cartola_linea_credito") {
    // Parecen cartola: Saldo anterior, tabla Fecha/…/Cargos/Abonos/Saldo con saldo corrido.
    if (tipo === "estado_cuenta_cliente") { t("Estado de cuenta del cliente", 40, 50, 12); t("N° cuenta cliente 4455-1", 40, 66); }
    else { t("Cartola Línea de Crédito", 40, 50, 12); t("Cupo aprobado $ 3.000.000", 40, 66); }
    t("Saldo anterior", 40, 82); t("$ 1.000.000", 140, 82);
    let saldo = 1_000_000;
    tabla(110, [["Fecha", 40], ["Documento", 110], ["Cargos", 330], ["Abonos", 400], ["Saldo", 470]], (i) => {
      const m = monto(); const c = i % 3 !== 0; saldo += c ? -m : m;
      return [[fecha(i), 40], [tipo === "estado_cuenta_cliente" ? `Factura Electrónica ${4000 + i}` : `Giro línea ${i + 1}`, 110], [c ? `$ ${m.toLocaleString("es-CL")}` : "", 370, true], [c ? "" : `$ ${m.toLocaleString("es-CL")}`, 440, true], [`$ ${saldo.toLocaleString("es-CL")}`, 520, true]];
    });
  } else {
    t("LIQUIDACION DE SUELDO", 40, 50, 12); t("Trabajador: PERSONA FICTICIA", 40, 66); t("Periodo: septiembre 2026", 40, 80);
    const y = tabla(110, [["Fecha", 40], ["Concepto", 110], ["Haberes", 400], ["Descuentos", 470], ["Saldo", 530]],
      (i) => [[fecha(i), 40], [i % 2 ? "Descuento AFP" : "Sueldo base", 110], [`$ ${monto().toLocaleString("es-CL")}`, 450, true], [`$ ${monto().toLocaleString("es-CL")}`, 515, true], [`$ ${monto().toLocaleString("es-CL")}`, 560, true]]);
    t("Total Haberes $ 1.500.000", 40, y + 20); t("Total Descuentos $ 300.000", 220, y + 20); t("Líquido a Pagar $ 1.200.000", 400, y + 20);
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
