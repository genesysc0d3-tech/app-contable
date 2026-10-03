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
    const t = [...linea(752, ["Cuenta Corriente N° 0001234567", 40]), ...linea(740, ["Cartola", 40], ["Saldo anterior", 140]), ...tablaBancaria,
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

  // Vuelta 3 (2026-10-03).
  it("proveedor: «Saldo anterior» + Fecha/Detalle/Cargos/Abonos/Saldo + 70% «Factura N°» → no cartola", () => {
    const t = [...L(780, ["Distribuidora Ejemplo Ltda.", 40]), ...L(766, ["Saldo anterior", 40], ["$ 100.000", 140]),
      ...tabla(700, 10, (i) => (i % 10 < 7 ? `Factura N° ${5000 + i}` : `Pago recibido ${i}`), [["Fecha", 40], ["Detalle", 100], ["Cargos", 300], ["Abonos", 380], ["Saldo", 460]])];
    expect(tipo(t)).not.toBe("cartola");
  });
  it("proveedor con «Señores: … RUT» → no cartola", () => {
    const t = [...L(780, ["Señores: Comercial Ficticia SpA", 40], ["RUT: 76.123.456-0", 300]), ...L(766, ["Saldo anterior", 40], ["$ 100.000", 140]),
      ...tabla(700, 10, (i) => (i % 10 < 7 ? `Factura N° ${5000 + i}` : `Abono ${i}`), [["Fecha", 40], ["Detalle", 100], ["Cargos", 300], ["Abonos", 380], ["Saldo", 460]])];
    expect(tipo(t)).not.toBe("cartola");
  });
  it("«CARTOLA CUENTA CORRIENTE · LÍNEA DE CRÉDITO» en la misma línea del título → cartola", () => {
    expect(tipo([...L(780, ["CARTOLA CUENTA CORRIENTE", 40], ["LÍNEA DE CRÉDITO", 300]), ...L(766, ["Saldo anterior", 40], ["$ 100.000", 140]), ...tabla(700, 6)])).toBe("cartola");
  });
  it("«Cuenta Corriente Pyme con Línea de Crédito» como título → cartola", () => {
    expect(tipo([...L(780, ["Cuenta Corriente Pyme con Línea de Crédito", 40]), ...L(766, ["Saldo anterior", 40], ["$ 100.000", 140]), ...tabla(700, 6)])).toBe("cartola");
  });

  // Vuelta 4: tabla del revisor (movimientos/facturas, con y sin N° de cuenta).
  const conFacturas = (n: number, f: number) => tabla(700, n, (i) => (i < f ? `PAGO FACTURA N° ${7000 + i}` : `Transferencia ${i}`));
  const encabezadoSinTipo = (cuenta: string | null) => [...L(780, ["Movimientos", 40]), ...(cuenta ? L(772, [cuenta, 40]) : []), ...L(766, ["Saldo anterior", 40], ["$ 100.000", 140])];
  for (const [n, f] of [[3, 2], [4, 2], [10, 4], [20, 8], [20, 7]] as const) {
    it(`B2B ${n} movs / ${f} «PAGO FACTURA N°» con «Cuenta Corriente N°» → cartola`, () => {
      expect(tipo([...encabezadoSinTipo("Cuenta Corriente N° 0001234567"), ...conFacturas(n, f)])).toBe("cartola");
    });
    // Vuelta 6: un «N° de cuenta» sin tipo, «Saldo anterior» y los títulos
    // bancarios NO son marca propia de banco (un proveedor los trae igual): con
    // ≥20% de facturas en las glosas ya no se distingue → otro (la IA).
    it(`${n} movs / ${f} facturas con «N° de cuenta» sin tipo + saldo anterior + títulos bancarios → no cartola (sin marca propia)`, () => {
      expect(tipo([...encabezadoSinTipo("N° de cuenta 0001234567"), ...conFacturas(n, f)])).not.toBe("cartola");
    });
    it(`${n} movs / ${f} facturas SIN N° de cuenta → no cartola (sin marca propia)`, () => {
      expect(tipo([...hdr.filter((i) => i.str !== "CARTOLA CUENTA CORRIENTE"), ...L(780, ["Movimientos", 40]), ...conFacturas(n, f)])).not.toBe("cartola");
    });
  }
});

// Vuelta 6 (2026-10-03): el sello de una cartola PDF exige que sea BANCARIA de
// verdad. Riesgo residual de la revisión final: un estado de cuenta de PROVEEDOR
// ambiguo (40-59% «Factura N°», «Saldo anterior», Fecha/Cargo/Abono/Saldo, sin
// marca de banco) entraba al lector y salía sellado por saldo.
describe("vuelta 6: proveedor ambiguo y marca propia de banco", () => {
  const L = (y: number, ...c: [string, number][]): ItemPdf[] => c.map(([str, x]) => ({ str, x, y, w: str.length * 4, pagina: 1 }));
  /** Tabla con saldo corrido que CUADRA (Fecha/Detalle/Cargo/Abono/Saldo). */
  function tabla(n: number, f: number, glosaFactura = (i: number) => `Factura N° ${8000 + i}`) {
    const out: ItemPdf[] = [...L(700, ["Fecha", 40], ["Detalle", 100], ["Cargo", 300], ["Abono", 380], ["Saldo", 460])];
    let s = 100000;
    for (let i = 0; i < n; i++) {
      const m = 1000 + i * 37; const c = i % 2 === 0; s += c ? -m : m;
      out.push(...L(688 - 12 * i, [`${String(1 + (i % 28)).padStart(2, "0")}/09/2026`, 40], [i < f ? glosaFactura(i) : `Pago recibido ${i}`, 100], [`$ ${m.toLocaleString("es-CL")}`, c ? 300 : 380], [`$ ${s.toLocaleString("es-CL")}`, 460]));
    }
    return out;
  }
  const saldoAnterior = L(752, ["Saldo anterior", 40], ["$ 100.000", 140]);
  const proveedor = (n: number, f: number) => [...L(780, ["Distribuidora Ejemplo Ltda.", 40]), ...L(766, ["Estado de cuenta", 40]), ...saldoAnterior, ...tabla(n, f)];
  const ruta = (it: ItemPdf[]) => clasificarPdf(it);

  for (const [n, f] of [[10, 5], [20, 9]] as const) {
    it(`proveedor ambiguo ${n}/${f} «Factura N°» + «Saldo anterior», sin marca de banco → otro`, () => {
      expect(ruta(proveedor(n, f))).toMatchObject({ tipo: "otro", motivo: "senal_facturas_en_glosas", marca_banco: null });
    });
    it(`misma tabla ${n}/${f} CON «Banco X / Cuenta Corriente N°» → cartola`, () => {
      const r = ruta([...L(780, ["Banco Santander", 40]), ...L(766, ["Cuenta Corriente N° 0001234567", 40]), ...saldoAnterior, ...tabla(n, f)]);
      expect(r).toMatchObject({ tipo: "cartola", marca_banco: "n_cuenta_banco" });
    });
  }
  it("el nombre del banco SOLO en el encabezado es marca propia (BancoEstado, Mercado Pago, Tenpo, Coopeuch…)", () => {
    for (const banco of ["BancoEstado", "Banco de Chile", "Mercado Pago", "Tenpo", "Coopeuch", "Banco Security", "Global66", "MACH"]) {
      expect({ banco, r: ruta([...L(780, [banco, 40]), ...saldoAnterior, ...tabla(10, 5)]).marca_banco }).toEqual({ banco, r: "nombre_banco" });
    }
  });
  it("el nombre de un banco en el PIE (publicidad) o en una GLOSA no es marca → proveedor sigue siendo otro", () => {
    expect(ruta([...proveedor(10, 5), ...L(40, ["Paga con Mercado Pago o Banco de Chile", 40])]).tipo).toBe("otro");
    expect(ruta([...proveedor(10, 5).filter((i) => i.y !== 688), ...L(688, ["01/09/2026", 40], ["TRANSF A BANCO DE CHILE", 100], ["$ 1.000", 300], ["$ 99.000", 460])]).tipo).toBe("otro");
  });
  it("«Depositar en Banco de Chile, Cuenta Corriente N° …» (datos para pagarle al proveedor) no es marca → otro", () => {
    const it2 = [...L(790, ["Depositar en Banco de Chile Cuenta Corriente N° 0001234567 a nombre de Distribuidora Ejemplo", 40]), ...proveedor(10, 5)];
    expect(ruta(it2)).toMatchObject({ tipo: "otro", marca_banco: null });
  });
  it("«Banco Internacional» / «Security» genéricos: solo con «Banco»", () => {
    expect(ruta([...L(780, ["Seguridad Internacional Ltda.", 40]), ...saldoAnterior, ...tabla(10, 5)]).marca_banco).toBeNull();
  });
  it("cartola pyme con 40% «PAGO FACTURA» y marca de banco → cartola, y el lector la SELLA", async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" }); doc.setFontSize(8);
    doc.text("Banco Ejemplo - CARTOLA CUENTA CORRIENTE", 40, 40);
    doc.text("Cuenta Corriente N° 0001234567", 40, 54);
    doc.text("Saldo anterior", 40, 68); doc.text("$ 1.000.000", 140, 68);
    ["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"].forEach((x, i) => doc.text(x, [40, 110, 330, 400, 470][i], 94));
    let s = 1_000_000;
    for (let i = 0; i < 10; i++) {
      const m = 50_000 + i * 1_370; const c = i % 2 === 0; s += c ? -m : m;
      [`${String(1 + i).padStart(2, "0")}/09/2026`, i < 4 ? `PAGO FACTURA N° ${2000 + i}` : `Transferencia ${i}`, c ? `$ ${m.toLocaleString("es-CL")}` : "", c ? "" : `$ ${m.toLocaleString("es-CL")}`, `$ ${s.toLocaleString("es-CL")}`]
        .forEach((t, k) => t && doc.text(t, [40, 110, 330, 400, 470][k], 108 + i * 13));
    }
    let d: DiagnosticoPdf | null = null;
    const r = await parsePdfCartola(new Uint8Array(doc.output("arraybuffer")), { diagnostico: (x) => { d = x; } });
    expect(d).toMatchObject({ tipo: "cartola" });
    expect(d!.senales).toContain("marca:n_cuenta_banco");
    expect(r?.preExtracted?.length).toBe(10);
    expect(r?.censo?.verificacion?.tipo).toBe("saldo");
  });
  it("PDF SIN marca de banco que llega al lector (cuadra por saldo) → se lee, NO se sella", async () => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" }); doc.setFontSize(8);
    doc.text("Movimientos", 40, 40);
    doc.text("Saldo anterior", 40, 54); doc.text("$ 1.000.000", 140, 54);
    ["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"].forEach((x, i) => doc.text(x, [40, 110, 330, 400, 470][i], 80));
    let s = 1_000_000;
    for (let i = 0; i < 10; i++) {
      const m = 50_000 + i * 1_370; const c = i % 2 === 0; s += c ? -m : m;
      [`${String(1 + i).padStart(2, "0")}/09/2026`, `Transferencia ${i}`, c ? `$ ${m.toLocaleString("es-CL")}` : "", c ? "" : `$ ${m.toLocaleString("es-CL")}`, `$ ${s.toLocaleString("es-CL")}`]
        .forEach((t, k) => t && doc.text(t, [40, 110, 330, 400, 470][k], 94 + i * 13));
    }
    let d: DiagnosticoPdf | null = null;
    const r = await parsePdfCartola(new Uint8Array(doc.output("arraybuffer")), { diagnostico: (x) => { d = x; } });
    expect(d).toMatchObject({ tipo: "cartola" });
    expect(d!.senales).toContain("sin_marca_banco");
    expect(r?.preExtracted?.length).toBe(10);
    expect(r?.censo?.verificacion).toMatchObject({ tipo: "sin_comprobar", alerta: true });
  });
});

// Vuelta 6b (revisión adversarial de la vuelta 6): marcas falsas que sellaban
// proveedores, la cuenta corriente mercantil, marcas que faltaban y la UI.
// NOTA (M2): las fixtures de la vuelta 4 (encabezadoSinTipo / «Movimientos» +
// «Saldo anterior» sin N° de cuenta con tipo) se parecen al layout real
// «estado de cuenta desde/hasta» (el banco va en el LOGO, no en texto): no son
// "proveedores". Sin formato conocido ni marca de texto ahora van a la IA si
// traen ≥20% de facturas; el formato real calza como conocido y sigue sellando.
describe("vuelta 6b: marcas falsas, cuenta corriente mercantil y marcas que faltaban", () => {
  const L = (y: number, ...c: [string, number][]): ItemPdf[] => c.map(([str, x]) => ({ str, x, y, w: str.length * 4, pagina: 1 }));
  function tabla(n: number, f: number) {
    const out: ItemPdf[] = [...L(700, ["Fecha", 40], ["Detalle", 100], ["Cargo", 300], ["Abono", 380], ["Saldo", 460])];
    let s = 100000;
    for (let i = 0; i < n; i++) {
      const m = 1000 + i * 37; const c = i % 2 === 0; s += c ? -m : m;
      out.push(...L(688 - 12 * i, [`${String(1 + (i % 28)).padStart(2, "0")}/09/2026`, 40], [i < f ? `Factura N° ${8000 + i}` : `Pago recibido ${i}`, 100], [`$ ${m.toLocaleString("es-CL")}`, c ? 300 : 380], [`$ ${s.toLocaleString("es-CL")}`, 460]));
    }
    return out;
  }
  /** Encabezado en líneas (de arriba hacia abajo) + «Saldo anterior» + tabla n/f. */
  const doc = (enc: string[], n = 10, f = 5, pie: string[] = []) => [
    ...enc.flatMap((t, k) => L(790 - 10 * k, [t, 40])), ...L(726, ["Saldo anterior", 40], ["$ 100.000", 140]), ...tabla(n, f),
    ...pie.flatMap((t, k) => L(60 - 10 * k, [t, 40])),
  ];
  const ruta = (it: ItemPdf[]) => clasificarPdf(it);

  /** PDF real que CUADRA por saldo (sentido banco), con encabezado y pie dados: lo que sellaba. */
  async function pdfQueCuadra(enc: string[], pie: string[] = []) {
    const { jsPDF } = await import("jspdf");
    const d = new jsPDF({ unit: "pt", format: "a4" }); d.setFontSize(8);
    enc.forEach((t, k) => d.text(t, 40, 30 + k * 12));
    const y0 = 30 + enc.length * 12;
    d.text("Saldo anterior", 40, y0 + 4); d.text("$ 1.000.000", 140, y0 + 4);
    ["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"].forEach((x, i) => d.text(x, [40, 110, 330, 400, 470][i], y0 + 30));
    let s = 1_000_000;
    for (let i = 0; i < 10; i++) {
      const m = 50_000 + i * 1_370; const c = i % 2 === 0; s += c ? -m : m;
      [`${String(1 + i).padStart(2, "0")}/09/2026`, `Movimiento ${i}`, c ? `$ ${m.toLocaleString("es-CL")}` : "", c ? "" : `$ ${m.toLocaleString("es-CL")}`, `$ ${s.toLocaleString("es-CL")}`]
        .forEach((t, k) => t && d.text(t, [40, 110, 330, 400, 470][k], y0 + 44 + i * 13));
    }
    pie.forEach((t, k) => d.text(t, 40, 780 + k * 12));
    let diag: DiagnosticoPdf | null = null;
    const r = await parsePdfCartola(new Uint8Array(d.output("arraybuffer")), { diagnostico: (x) => { diag = x; } });
    return { r, d: diag as DiagnosticoPdf | null };
  }

  // A1: los 3 casos que SELLABAN (PDF real que cuadra) → ya no sellan.
  const sellaban: [string, string[], string[]][] = [
    ["instrucción de pago en BLOQUE («Datos para transferencia:» / «Banco Santander» / «Cuenta Corriente N°»)", ["Distribuidora Ejemplo Ltda.", "Datos para transferencia:", "Banco Santander", "Cuenta Corriente N° 0001234567"], []],
    ["cuenta corriente solo en el PIE", ["Distribuidora Ejemplo Ltda."], ["Cuenta Corriente N° 0001234567"]],
    ["razón social con nombre de banco («INVERSIONES SANTANDER LTDA.»)", ["INVERSIONES SANTANDER LTDA."], []],
  ];
  for (const [caso, enc, pie] of sellaban) {
    it(`A1 sellaba: ${caso} → sin marca, se lee pero NO sella`, async () => {
      const { r, d } = await pdfQueCuadra(enc, pie);
      expect(d?.marca_banco ?? null).toBeNull();
      if (r) expect(r.censo?.verificacion?.tipo).not.toMatch(/^(saldo|total_banco)$/);
    });
  }
  // A1: los 3 de solo clasificación (proveedor 10/5) → otro.
  const clasificaban: [string, string[]][] = [
    ["«MACH Ingeniería SpA»", ["MACH Ingeniería SpA", "Estado de cuenta"]],
    ["«Transferir a:» y el banco en la línea siguiente", ["Comercial Ejemplo", "Transferir a:", "Banco de Chile"]],
    ["«Su banco: BCI»", ["Comercial Ejemplo", "Su banco: BCI"]],
  ];
  for (const [caso, enc] of clasificaban) {
    it(`A1 clasificaba como cartola: ${caso} + 50% facturas → otro`, () => {
      expect(ruta(doc(enc))).toMatchObject({ tipo: "otro", marca_banco: null });
    });
  }
  it("A1: «Banco: Santander» (dato de pago) no es marca", () => {
    expect(ruta(doc(["Comercial Ejemplo", "Banco: Santander"])).marca_banco).toBeNull();
  });
  it("A1: la razón social del propio banco («Banco Santander-Chile S.A.») sí es marca", () => {
    expect(ruta(doc(["Banco Santander-Chile S.A."])).marca_banco).toBe("nombre_banco");
  });

  it("M3 «ESTADO DE CUENTA CORRIENTE» + «Señores: …» (cuenta mercantil) → no es título de cartola y NO sella", async () => {
    expect(ruta(doc(["ESTADO DE CUENTA CORRIENTE", "Señores: Comercial Ejemplo SpA"])).marca_banco).toBeNull();
    const { r, d } = await pdfQueCuadra(["ESTADO DE CUENTA CORRIENTE", "Señores: Comercial Ejemplo SpA"]);
    expect(d?.marca_banco ?? null).toBeNull();
    if (r) expect(r.censo?.verificacion?.tipo).not.toMatch(/^(saldo|total_banco)$/);
  });
  it("M3: «CARTOLA CUENTA CORRIENTE» sigue siendo título aunque diga «Cliente:»", () => {
    expect(ruta(doc(["CARTOLA CUENTA CORRIENTE", "Cliente: Comercial Ejemplo SpA"])).marca_banco).toBe("titulo_cartola");
  });

  for (const [enc, marca] of [
    [["Cta. Cte. N° 12345678"], "n_cuenta_banco"], [["Cta Cte 12345678"], "n_cuenta_banco"],
    [["Cuenta Corriente 0-000-12345-6"], "n_cuenta_banco"],
    [["Prex"], "nombre_banco"], [["Chek"], "nombre_banco"], [["CMR Falabella"], "nombre_banco"], [["Banco Falabella"], "nombre_banco"],
    // Rótulos de un recuadro de resumen NO son instrucción de pago.
    // (en la MISMA línea del recuadro que la cuenta, y en las líneas de arriba).
    [["Transferencias en línea $ 120.000", "Depósitos $ 40.000", "Pagos $ 10.000", "Cuenta Corriente N° 0001234567 · Transferencias en línea $ 120.000"], "n_cuenta_banco"],
  ] as [string[], string][]) {
    it(`M2 «${enc.join(" / ")}» → marca ${marca} y cartola`, () => {
      expect(ruta(doc(enc))).toMatchObject({ tipo: "cartola", marca_banco: marca });
    });
  }
  it("M2: «Falabella» suelto (una tienda) no es marca", () => {
    expect(ruta(doc(["Falabella Retail"])).marca_banco).toBeNull();
  });

  it("B2: una sola «Factura N°» en 5 movimientos no basta → sigue siendo cartola (sin sello)", () => {
    expect(ruta(doc(["Movimientos"], 5, 1)).tipo).toBe("cartola");
  });
  it("B2: en un estado de 2 movimientos, 1 factura (la mitad) sin marca → otro", () => {
    expect(ruta(doc(["Movimientos"], 2, 1)).tipo).toBe("otro");
  });
  it("B1: la marca es campo propio del diagnóstico y va PRIMERA en las señales (pdf_ruta guarda 12)", async () => {
    const { d } = await pdfQueCuadra(["Banco de Chile", "Cuenta Corriente N° 0001234567"]);
    expect(d?.marca_banco).toBe("n_cuenta_banco");
    expect(d?.senales[0]).toBe("marca:n_cuenta_banco");
    expect(ruta(doc(["Movimientos"])).senales[0]).toBe("sin_marca_banco");
  });
});
