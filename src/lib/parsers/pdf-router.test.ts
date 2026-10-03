import { describe, expect, it } from "vitest";
import { parsePdfCartola, type DiagnosticoPdf } from "../parsers";
import { clasificarPdf } from "./pdf-router";
import { itemsDePdf, type ItemPdf } from "./pdf-grilla";
import {
  cartolaPdfSintetica, ESPERADO_NEGATIVO, negativoPdfSintetico, TIPOS_NEGATIVOS, type OpcionesPdf,
} from "./testing/cartola-pdf-sintetica";

/** Router de PDF (2026-10-02): solo "cartola" entra al lector; la duda, nunca. */

describe("negativos: PDFs con tablas de fecha+monto que NO son cartola", () => {
  for (const tipo of TIPOS_NEGATIVOS) {
    it(`${tipo} → ${ESPERADO_NEGATIVO[tipo]}, nunca al lector`, async () => {
      for (const seed of [1, 2, 3]) {
        const pdf = await negativoPdfSintetico(tipo, seed, 6 + seed * 3);
        const ruta = clasificarPdf(await itemsDePdf(pdf));
        expect({ tipo, seed, r: ruta.tipo }).toEqual({ tipo, seed, r: ESPERADO_NEGATIVO[tipo] });
        let d: DiagnosticoPdf | null = null;
        expect(await parsePdfCartola(pdf, { diagnostico: (x) => { d = x; } })).toBeNull();
        expect(d!.tipo).not.toBe("cartola");
      }
    });
  }
});

describe("cartolas sintéticas → todas al lector", () => {
  const casos: OpcionesPdf[] = [
    { formato: "itau", filas: 12, seed: 3 }, { formato: "itau", filas: 3, seed: 9, sinResumen: true },
    { formato: "estado", filas: 60, seed: 4 }, { formato: "estado", filas: 2, seed: 7 },
    // Títulos cruzados: no es formato conocido, pero sí cartola (y el juez no la sella).
    { formato: "itau", filas: 20, seed: 37, titulosCruzados: true }, { formato: "estado", filas: 20, seed: 37, titulosCruzados: true },
  ];
  for (const o of casos) {
    it(`${o.formato} ${o.filas} filas${o.titulosCruzados ? " títulos cruzados" : ""} → cartola`, async () => {
      const ruta = clasificarPdf(await itemsDePdf((await cartolaPdfSintetica(o)).pdf));
      expect(ruta.tipo).toBe("cartola");
      expect(ruta.motivo).toBe(o.titulosCruzados ? "senales_cartola" : "formato_conocido");
    });
  }
});

describe("reglas del router (unidad)", () => {
  const linea = (y: number, ...celdas: [string, number][]): ItemPdf[] => celdas.map(([str, x]) => ({ str, x, y, w: str.length * 4, pagina: 1 }));
  const tablaBancaria = [
    ...linea(700, ["Fecha", 40], ["Descripción", 100], ["Cargos", 300], ["Abonos", 380], ["Saldo", 460]),
    ...linea(688, ["01/09/2026", 40], ["Pago", 100], ["$ 1.000", 300], ["$ 9.000", 460]),
    ...linea(676, ["02/09/2026", 40], ["Abono", 100], ["$ 500", 380], ["$ 9.500", 460]),
  ];
  it("tabla bancaria sin ninguna otra marca de cartola → otro (no se adivina)", () => {
    expect(clasificarPdf(tablaBancaria)).toMatchObject({ tipo: "otro", motivo: "sin_marcas_fuertes_de_cartola" });
  });
  it("+ «Saldo anterior» en el encabezado → cartola", () => {
    expect(clasificarPdf([...linea(740, ["Saldo anterior", 40], ["$ 10.000", 140]), ...tablaBancaria]).tipo).toBe("cartola");
  });
  it("+ marca de cartola Y de tarjeta → prioriza la no-cartola", () => {
    expect(clasificarPdf([...linea(750, ["Pago mínimo $ 5.000", 40]), ...linea(740, ["Saldo anterior", 40]), ...tablaBancaria]).tipo).toBe("tarjeta");
  });
  it("señales de dos tipos no-cartola → otro", () => {
    expect(clasificarPdf([...linea(750, ["Factura electrónica", 40]), ...linea(740, ["Pago mínimo", 40]), ...tablaBancaria]))
      .toMatchObject({ tipo: "otro", motivo: "senales_de_varios_tipos" });
  });
  it("una glosa «PAGO FACTURA» o «TRANSFERENCIA A» dentro de la tabla NO es señal de factura/comprobante", () => {
    const t = [...linea(740, ["Cartola", 40], ["Saldo anterior", 140]), ...tablaBancaria,
      ...linea(664, ["03/09/2026", 40], ["Pago factura electrónica 123 monto transferido", 100], ["$ 100", 300], ["$ 9.400", 460])];
    expect(clasificarPdf(t).tipo).toBe("cartola");
  });
});

describe("hallazgos de la revisión", () => {
  it("PDF con más páginas que MAX_PAGINAS → null sin leer nada (PDF real de MAX_PAGINAS+1 páginas)", async () => {
    const { MAX_PAGINAS, leerItemsPdf } = await import("./pdf-grilla");
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    for (let p = 0; p <= MAX_PAGINAS; p++) { if (p) doc.addPage(); doc.text(`Página ${p + 1}`, 40, 40); }
    const pdf = new Uint8Array(doc.output("arraybuffer"));
    expect(await leerItemsPdf(pdf)).toMatchObject({ items: [], paginas: MAX_PAGINAS + 1, truncado: true });
    let d: DiagnosticoPdf | null = null;
    expect(await parsePdfCartola(pdf, { diagnostico: (x) => { d = x; } })).toBeNull();
    expect(d).toMatchObject({ tipo: "otro", motivo: "demasiadas_paginas" });
  });
});

// Fixtures de la revisión adversarial 2026-10-02 (adv.test.ts / adv2.test.ts).
describe("revisión adversarial del router", () => {
  const L = (y: number, ...c: [string, number][]): ItemPdf[] => c.map(([str, x]) => ({ str, x, y, w: str.length * 4, pagina: 1 }));
  function tabla(y0: number, n: number, glosa = (i: number) => `Transferencia ${i}`, cab: [string, number][] = [["Fecha", 40], ["Descripción", 100], ["Cargos", 300], ["Abonos", 380], ["Saldo", 460]]) {
    const out: ItemPdf[] = [...L(y0, ...cab)];
    let s = 100000;
    for (let i = 0; i < n; i++) {
      const m = 1000 + i * 37; const c = i % 2 === 0; s += c ? -m : m;
      out.push(...L(y0 - 12 * (i + 1), [`0${1 + (i % 9)}/09/2026`, 40], [glosa(i), 100], [`$ ${m.toLocaleString("es-CL")}`, c ? 300 : 380], [`$ ${s.toLocaleString("es-CL")}`, 460]));
    }
    return out;
  }
  const hdr = [...L(780, ["CARTOLA CUENTA CORRIENTE", 40]), ...L(766, ["Saldo anterior", 40], ["$ 100.000", 140])];
  const tipo = (it: ItemPdf[]) => clasificarPdf(it).tipo;

  it("A cartola con su sección de línea de crédito (cupo utilizado/disponible) → cartola", () => {
    expect(tipo([...hdr, ...L(752, ["Línea de crédito", 40], ["Cupo utilizado", 160], ["Cupo disponible", 280]), ...tabla(700, 6)])).toBe("cartola");
  });
  it("B pie publicitario «Pague su Tarjeta de Crédito…» → cartola", () => {
    expect(tipo([...hdr, ...tabla(700, 6), ...L(40, ["Pague su Tarjeta de Crédito con cargo a su cuenta", 40])])).toBe("cartola");
  });
  it("C glosa partida «TARJETA DE CREDITO VISA» dentro de la tabla → cartola", () => {
    const t = tabla(700, 6, (i) => (i === 2 ? "PAGO AUTOMATICO" : `Transf ${i}`));
    expect(tipo([...hdr, ...t, ...L(700 - 12 * 3 - 6, ["TARJETA DE CREDITO VISA", 100])])).toBe("cartola");
  });
  it("C2 glosa partida «Destinatario: …» dentro de la tabla → cartola", () => {
    expect(tipo([...hdr, ...tabla(700, 6), ...L(700 - 12 * 3 - 6, ["Destinatario: Juan Perez", 100])])).toBe("cartola");
  });
  it("D encabezado apilado en 3 líneas («Monto cheques» / «o cargos») → cartola", () => {
    const it2: ItemPdf[] = [...hdr, ...L(712, ["Monto cheques", 300], ["Monto depósitos", 380]), ...L(704, ["Fecha", 40], ["Detalle", 100], ["Saldo", 460]), ...L(696, ["o cargos", 300], ["o abonos", 380])];
    for (let i = 0; i < 6; i++) it2.push(...L(680 - 12 * i, [`0${i + 1}/09`, 40], ["Pago", 100], [`1.${i}00`, i % 2 ? 300 : 380], [`9${i}.000`, 460]));
    expect(tipo(it2)).toBe("cartola");
  });
  it("D2 fecha solo en la 1ª fila del día + glosa «PAGO TARJETA DE CREDITO» → cartola", () => {
    const it2: ItemPdf[] = [...hdr, ...L(704, ["Fecha", 40], ["Detalle", 100], ["Cargos", 300], ["Abonos", 380], ["Saldo", 460])];
    for (let i = 0; i < 6; i++) it2.push(...L(680 - 12 * i, ...(i % 2 ? [] : [[`0${i + 1}/09/2026`, 40]] as [string, number][]), [i === 3 ? "PAGO TARJETA DE CREDITO" : "Pago", 100], [`1.${i}00`, 300], [`9${i}.000`, 460]));
    expect(tipo(it2)).toBe("cartola");
  });
  it("E fintech con una sola columna «Valor» con signo + Saldo → cartola", () => {
    const it2: ItemPdf[] = [...L(780, ["Resumen de cuenta", 40]), ...L(766, ["Saldo inicial", 40], ["$ 100.000", 140]), ...L(700, ["Fecha", 40], ["Descripción", 100], ["ID operación", 260], ["Valor", 380], ["Saldo", 460])];
    for (let i = 0; i < 6; i++) it2.push(...L(688 - 12 * i, [`0${i + 1}/09/2026`, 40], ["Pago QR", 100], [`12345${i}`, 260], [`-$ 1.${i}00`, 380], [`$ 9${i}.000`, 460]));
    expect(tipo(it2)).toBe("cartola");
  });
  it("F estado de cuenta corriente de un PROVEEDOR (facturas en las glosas) → no cartola", () => {
    expect(tipo([...L(780, ["ESTADO DE CUENTA CORRIENTE CLIENTE", 40]), ...L(766, ["Saldo anterior", 40], ["$ 100.000", 140]), ...tabla(700, 8, (i) => `Factura Electrónica N° ${1000 + i}`)])).not.toBe("cartola");
  });
  it("F2 cartola B2B con muchos «PAGO FACTURA 1234» y saldo anterior → cartola (vuelta 2)", () => {
    expect(tipo([...hdr, ...tabla(700, 8, (i) => (i % 3 ? `Pago Factura ${2000 + i}` : `Transferencia ${i}`))])).toBe("cartola");
  });
  it("F3 casi todas las glosas son facturas con N° y no hay saldo del banco → no cartola", () => {
    expect(tipo([...L(780, ["Movimientos", 40]), ...L(766, ["Cuenta Corriente N° 123456", 40]), ...tabla(700, 8, (i) => `Factura Electrónica N° ${3000 + i}`)])).not.toBe("cartola");
  });
  it("G estado de cuenta de línea de crédito (cupo autorizado) → no cartola", () => {
    expect(tipo([...L(780, ["Estado de cuenta Línea de Crédito", 40]), ...L(766, ["Cupo autorizado $ 2.000.000", 40]), ...L(752, ["Saldo anterior", 40], ["$ 100.000", 140]), ...tabla(700, 8, (i) => `Traspaso a cuenta corriente ${i}`)])).not.toBe("cartola");
  });
  it("H cartola de AFP → no cartola", () => {
    expect(tipo([...L(780, ["Cartola Cuatrimestral AFP", 40]), ...L(766, ["Saldo anterior", 40], ["$ 100.000", 140]), ...tabla(700, 8, (i) => `Cotización obligatoria ${i}`, [["Fecha", 40], ["Movimiento", 100], ["Cargos", 300], ["Abonos", 380], ["Saldo", 460]])])).not.toBe("cartola");
  });
  it("H2 crédito de consumo con «Período» → no cartola", () => {
    expect(tipo([...L(780, ["Estado de cuenta Crédito de Consumo", 40]), ...L(766, ["Período: 01/09/2026 al 30/09/2026", 40]), ...tabla(700, 8, (i) => `Cuota ${i}`)])).not.toBe("cartola");
  });
  it("H3 «Período» como única marca (sin saldo anterior ni N° de cuenta) → no cartola", () => {
    expect(tipo([...L(780, ["Movimientos", 40]), ...L(766, ["Período: 01/09/2026 al 30/09/2026", 40]), ...tabla(700, 8)])).not.toBe("cartola");
  });
  it("I tarjeta con etiquetas y valores en la misma línea que una fecha → tarjeta", () => {
    expect(tipo([...L(780, ["Estado de Cuenta", 40]), ...L(766, ["Fecha facturación", 40], ["15/09/2026", 140], ["Pago mínimo", 260], ["$ 85.000", 360]),
      ...L(752, ["Fecha vencimiento", 40], ["05/10/2026", 140], ["Monto facturado", 260], ["$ 640.000", 360]), ...L(738, ["Saldo anterior", 40], ["$ 100.000", 140]), ...tabla(700, 8, (i) => `Compra comercio ${i}`)])).toBe("tarjeta");
  });
  it("USD: cuenta en dólares → no cartola", () => {
    expect(tipo([...L(790, ["Moneda: Dólar USD", 40]), ...hdr, ...tabla(700, 6)])).not.toBe("cartola");
  });
  it("J proveedor como PDF real → nunca al lector", async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" }); doc.setFontSize(8);
    doc.text("ESTADO DE CUENTA CORRIENTE CLIENTE - Distribuidora Ejemplo", 40, 40);
    doc.text("Saldo anterior", 40, 54); doc.text("$ 1.000.000", 140, 54);
    ["Fecha", "Documento", "Cargos", "Abonos", "Saldo"].forEach((x, i) => doc.text(x, [40, 110, 330, 400, 470][i], 80));
    let s = 1_000_000;
    for (let i = 0; i < 14; i++) {
      const m = 50_000 + i * 1_370; const c = i % 3 !== 0; s += c ? m : -m;
      [`${String(1 + i).padStart(2, "0")}/09/2026`, c ? `Factura Electrónica ${2000 + i}` : `Pago recibido ${i}`, c ? `$ ${m.toLocaleString("es-CL")}` : "", c ? "" : `$ ${m.toLocaleString("es-CL")}`, `$ ${s.toLocaleString("es-CL")}`]
        .forEach((t, k) => t && doc.text(t, [40, 110, 330, 400, 470][k], 94 + i * 13));
    }
    let d: DiagnosticoPdf | null = null;
    expect(await parsePdfCartola(new Uint8Array(doc.output("arraybuffer")), { diagnostico: (x) => { d = x; } })).toBeNull();
    expect(d!.tipo).not.toBe("cartola");
  });

  // Vuelta 2 (2026-10-03): casos realistas que el router perdía o dejaba pasar.
  it("Pyme: «Línea de crédito · Cupo autorizado $ x» como DATO del encabezado → cartola", () => {
    expect(tipo([...hdr, ...L(752, ["Cuenta Corriente N° 0001234567", 40]), ...L(738, ["Línea de crédito", 40], ["Cupo autorizado $ 5.000.000", 160], ["Cupo total $ 5.000.000", 330]), ...tabla(700, 6)])).toBe("cartola");
  });
  for (const pie of ["Simule su Crédito de Consumo en bancoejemplo.cl", "Paga tus cotizaciones AFP desde tu cuenta", "Dólar observado $ 950,12"]) {
    it(`pie publicitario «${pie}» → cartola`, () => {
      expect(tipo([...hdr, ...tabla(700, 6), ...L(40, [pie, 40])])).toBe("cartola");
    });
  }
  it("glosa partida DESPUÉS del último movimiento de la página («TARJETA DE CREDITO VISA», «Destinatario: …») → cartola", () => {
    const t = tabla(700, 6);
    expect(tipo([...hdr, ...t, ...L(700 - 12 * 6 - 7, ["TARJETA DE CREDITO VISA", 100])])).toBe("cartola");
    expect(tipo([...hdr, ...t, ...L(700 - 12 * 6 - 7, ["Destinatario: Juan Perez", 100])])).toBe("cartola");
  });
  it("CuentaRUT N° (sin saldo anterior) → cartola", () => {
    expect(tipo([...L(780, ["Movimientos CuentaRUT", 40]), ...L(766, ["CuentaRUT N° 12345678", 40]), ...tabla(700, 6)])).toBe("cartola");
  });
  it("MACH «Cuenta Vista: 123456» (sin N°) → cartola", () => {
    expect(tipo([...L(780, ["Mis movimientos", 40]), ...L(766, ["Cuenta Vista: 77712345", 40]), ...tabla(700, 6)])).toBe("cartola");
  });
  it("«Estado de cuenta del cliente · N° cuenta cliente» → no cartola", () => {
    expect(tipo([...L(780, ["Estado de cuenta del cliente", 40]), ...L(766, ["N° cuenta cliente 4455", 40]), ...L(752, ["Saldo anterior", 40], ["$ 100.000", 140]), ...tabla(700, 8)])).not.toBe("cartola");
  });
  it("«Cartola Línea de Crédito · Cupo aprobado» → no cartola", () => {
    expect(tipo([...L(780, ["Cartola Línea de Crédito", 40]), ...L(766, ["Cupo aprobado $ 3.000.000", 40]), ...L(752, ["Saldo anterior", 40], ["$ 100.000", 140]), ...tabla(700, 8)])).not.toBe("cartola");
  });
  it("«N° cuenta» genérico solo (sin corriente/vista/RUT) no es marca fuerte", () => {
    expect(tipo([...L(780, ["Movimientos", 40]), ...L(766, ["N° cuenta 4455", 40]), ...tabla(700, 8)])).not.toBe("cartola");
  });
});
