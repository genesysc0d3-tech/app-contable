import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { applyAdapter } from "./apply";
import { formulasSuma, sellarCartola } from "./juez-banco";
import type { AdapterConfig, DescarteFila, Row } from "./types";

// BATERÍA DE SELLOS FALSOS (2026-09-30, docs/pruebas-sellos-falsos-2026-09-30.md):
// se tomaron las cartolas que hoy salen selladas y se les aplicó un daño
// económico (scripts/corpus-cartolas/danos.ts). Cada test es un contraejemplo
// que la batería encontró: el sello SOBREVIVÍA con la lectura mala, con un
// testigo del banco en contra o con un archivo ambiguo. Regla del fundador: si
// hay duda, el sello baja y el cliente acomoda las columnas.

vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async () => null,
  getAdaptersConfirmadosEmpresa: async () => [],
  saveAdapter: async () => "adapter-test",
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  confirmarAdapter: async () => {},
  logParserEvent: async () => {},
}));
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));
beforeEach(() => { delete process.env.LECTOR_ESTRUCTURA_IA; });

type Celda = string | number | null;
const fch = (d: number) => `${String(d).padStart(2, "0")}/09/2026`;
const SELLOS = ["saldo", "total_banco", "cliente"];

async function parsear(buf: ArrayBuffer) {
  const { parseExcelWithOrchestrator } = await import("./orchestrator");
  return (await parseExcelWithOrchestrator(buf, {})).result;
}
function libro(filas: Celda[][], extra?: (ws: XLSX.WorkSheet) => void, otras: { nombre: string; filas: Celda[][] }[] = []): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(filas);
  extra?.(ws);
  XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
  for (const o of otras) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(o.filas), o.nombre);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Cartola con saldo inicial y 14 movimientos (números de Excel): hoy sale sellada "saldo". */
function cartolaConSaldo(opts: { tituloCargo?: string; tituloAbono?: string } = {}) {
  const movs: { dia: number; cargo: number; abono: number; saldo: number }[] = [];
  let s = 1_000_000;
  for (let i = 1; i <= 14; i++) {
    const esCargo = i % 3 === 0;
    const m = 10_000 + i * 1_370;
    s += esCargo ? -m : m;
    movs.push({ dia: i, cargo: esCargo ? m : 0, abono: esCargo ? 0 : m, saldo: s });
  }
  const filas: Celda[][] = [["Fecha", "Descripción", opts.tituloCargo ?? "Cargos", opts.tituloAbono ?? "Abonos", "Saldo"], [null, "SALDO INICIAL", null, null, 1_000_000]];
  for (const m of movs) filas.push([fch(m.dia), m.cargo ? `PAGO ${m.dia}` : `VENTA ${m.dia}`, m.cargo || null, m.abono || null, m.saldo]);
  return filas;
}

describe("línea base: la cartola limpia sí se sella", () => {
  it("saldo inicial + 14 filas que cuadran al peso → sello saldo", async () => {
    const r = await parsear(libro(cartolaConSaldo()));
    expect(r.verificacion?.tipo).toBe("saldo");
  });
});

describe("daño mas_un_peso / menos_un_peso: la tolerancia de ±$1 no puede tapar un peso cambiado", () => {
  it("un monto con +$1 (el saldo no se movió) ya no sella: montos enteros → cuadre EXACTO", async () => {
    const filas = cartolaConSaldo();
    filas[6][3] = (filas[6][3] as number) + 1; // un abono +$1, el saldo del banco queda igual
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
  });
  it("un total del resumen que difiere en $1 de lo leído ya no prueba nada", async () => {
    const filas = cartolaConSaldo().map((f) => [f[0], f[1], f[2], f[3]]); // sin saldo
    const cargos = filas.slice(2).reduce((s, f) => s + (Number(f[2]) || 0), 0);
    const abonos = filas.slice(2).reduce((s, f) => s + (Number(f[3]) || 0), 0);
    filas[1] = [null, null, null, null];
    filas.push([], [null, "Total cargos", cargos, null], [null, "Total abonos", null, abonos + 1]);
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
  });
  it("con montos con decimales (rendondeo real) la tolerancia de $1 se mantiene", async () => {
    const filas = cartolaConSaldo().map((f, i) => (i >= 2 && typeof f[3] === "number" ? [f[0], f[1], f[2], f[3] + 0.4, (f[4] as number) + 0.4] : f));
    // Los saldos siguientes arrastran el 0,4: se reconstruye el saldo con decimales.
    let s = 1_000_000;
    for (let i = 2; i < filas.length; i++) { s += (Number(filas[i][3]) || 0) - (Number(filas[i][2]) || 0); filas[i][4] = Math.round(s * 100) / 100; }
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("saldo");
  });
});

describe("daños fila oculta / AutoFiltro: una fila escondida con plata baja el sello y se muestra", () => {
  it("AutoFiltro que esconde 2 movimientos: sin sello, con alerta que nombra las filas", async () => {
    const buf = libro(cartolaConSaldo(), (ws) => {
      ws["!autofilter"] = { ref: "A1:E16" };
      ws["!rows"] = [];
      ws["!rows"][5] = { hidden: true };
      ws["!rows"][9] = { hidden: true };
    });
    const r = await parsear(buf);
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.alerta).toBe(true);
    expect(r.verificacion?.detalle).toMatch(/oculta/i);
    expect(r.censo?.filas_ocultas).toEqual([6, 10]);
  });
  it("columna oculta con plata: tampoco sella", async () => {
    const filas = cartolaConSaldo().map((f) => [...f, typeof f[3] === "number" ? 5_000 : null]);
    const r = await parsear(libro(filas, (ws) => { ws["!cols"] = []; ws["!cols"][5] = { hidden: true }; }));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
  });
  it("una fila oculta SIN plata (una nota) no molesta", async () => {
    const filas = cartolaConSaldo();
    filas.splice(8, 0, [null, "nota interna", null, null, null]);
    const r = await parsear(libro(filas, (ws) => { ws["!rows"] = []; ws["!rows"][8] = { hidden: true }; }));
    expect(r.verificacion?.tipo).toBe("saldo");
  });
});

describe("daño cruzar cargo↔abono: títulos que contradicen el mapa nunca sellan", () => {
  it("los títulos dicen Cargos/Abonos pero el saldo dice lo contrario: sin sello, alerta", async () => {
    const r = await parsear(libro(cartolaConSaldo({ tituloCargo: "Abonos", tituloAbono: "Cargos" })));
    expect(SELLOS).not.toContain(r.verificacion?.tipo);
    expect(r.verificacion?.alerta).toBe(true);
  });
  it("igual con títulos en inglés (Credit/Debit al revés)", async () => {
    const r = await parsear(libro(cartolaConSaldo({ tituloCargo: "Credit", tituloAbono: "Debit" })));
    expect(SELLOS).not.toContain(r.verificacion?.tipo);
  });
});

describe("fórmula =SUM: el valor cacheado tiene que ser el de sus celdas", () => {
  const cfg: AdapterConfig = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols",
    columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: -1 } };
  function hoja(cacheado: (sumaCeldas: number, leido: number) => number) {
    const filas: Celda[][] = [["Fecha", "Descripción", "Cargos", "Abonos"]];
    for (let i = 1; i <= 12; i++) filas.push([fch(i), `VENTA ${i}`, null, 10_000 * i]);
    filas.push([null, "Subtotal", null, 55_555]); // sin fecha: la lectura no la cuenta, la SUM de Excel sí
    const leido = filas.slice(1, 13).reduce((s, f) => s + (f[3] as number), 0);
    const ws = XLSX.utils.aoa_to_sheet([...filas, [null, "Total", null, null]]);
    ws["D15"] = { t: "n", v: cacheado(leido + 55_555, leido), f: "SUM(D2:D14)" };
    return { ws, rows: XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: "" }) };
  }
  it("formulasSuma recalcula desde las celdas fuente y marca la fórmula editada", () => {
    const { ws } = hoja((_s, leido) => leido);
    const [f] = formulasSuma(ws, XLSX.utils.decode_range, XLSX.utils.decode_cell);
    expect(f.recalculado).toBe(f.valor! + 55_555);
    expect(f.editada).toBe(true);
  });
  it("<v> cacheado ≠ recalculado (igual a lo leído): la fórmula no es testigo y se avisa", () => {
    const { ws, rows } = hoja((_s, leido) => leido);
    const formulas = formulasSuma(ws, XLSX.utils.decode_range, XLSX.utils.decode_cell);
    const descartes: DescarteFila[] = [];
    const lines = applyAdapter(rows, cfg, descartes, undefined, { filasFormula: new Set(formulas.map((f) => f.fila)) });
    const v = sellarCartola({ rows, cfg, lines, descartes, resumen: null, formulas });
    expect(v.tipo).toBe("sin_comprobar");
    expect(v.alerta).toBe(true);
    expect(v.detalle).toMatch(/editad/);
  });
});

describe("un solo rol por celda: un posible subtotal leído como movimiento no se sella", () => {
  it("plantilla massDTE con filas 'Total del día' (suma de las del día): sin sello cliente", async () => {
    const filas: Celda[][] = [["Fecha", "Glosa", "Monto", "Tipo", "RUT receptor", "Nombre receptor", "Medio de pago"]];
    for (let d = 1; d <= 6; d++) {
      const a = 10_000 + d * 100, b = 20_000 + d * 70;
      filas.push([fch(d), `Venta ${d}a`, a, "", "", "", ""], [fch(d), `Venta ${d}b`, b, "", "", "", ""], [fch(d), "Total del día", a + b, "", "", "", ""]);
    }
    const r = await parsear(libro(filas));
    expect(r.plantilla).toBe(true);
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.alerta).toBe(true);
    // …pero el popup "Revisa las columnas" NO se abre: las columnas de nuestra
    // plantilla son fijas, el problema es una FILA (se resuelve en Editar). Antes
    // el visor quedaba con el CTA para siempre: guardar columnas no la arregla
    // (la plantilla se lee antes del caché) — revisión adversarial 2026-09-30.
    const { revisarColumnas } = await import("@/lib/cartola/verificacion");
    expect(r.censo.mapa?.confirmado_por).toBe("plantilla");
    expect(revisarColumnas({ verificacion: r.censo.verificacion, mapa: r.censo.mapa }).abrir).toBe(false);
  });
  it("plantilla massDTE normal (sin subtotales) sigue con sello cliente", async () => {
    const filas: Celda[][] = [["Fecha", "Glosa", "Monto", "Tipo", "RUT receptor", "Nombre receptor", "Medio de pago"]];
    for (let d = 1; d <= 12; d++) filas.push([fch(d), `Venta ${d}`, 10_000 + d * 137, "", "", "", ""]);
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("cliente");
  });
});

describe("daño duplicar_mov: una fila repetida (mismo saldo) no se bota callada como 'subtotal'", () => {
  it("la fila duplicada de la única venta del día (saldo quieto) no es un subtotal legítimo: sin sello", async () => {
    // Día 5: un cargo y UNA venta; la venta aparece repetida con el mismo saldo.
    const filas = cartolaConSaldo();
    const k = filas.findIndex((f) => f[0] === fch(5));
    filas.splice(k, 0, [fch(5), "PAGO PREVIO", 3_000, null, (filas[k - 1][4] as number) - 3_000]);
    for (let i = k + 1; i < filas.length; i++) filas[i][4] = (filas[i][4] as number) - 3_000;
    filas.splice(k + 2, 0, [...filas[k + 1]]);
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
  });
  it("un subtotal de verdad (suma de 2+ movimientos del día, saldo quieto) sigue siendo subtotal", async () => {
    const filas = cartolaConSaldo();
    const k = filas.findIndex((f) => f[0] === fch(5));
    filas.splice(k, 0, [fch(5), "VENTA PREVIA", null, 3_000, (filas[k - 1][4] as number) + 3_000]);
    for (let i = k + 1; i < filas.length; i++) filas[i][4] = (filas[i][4] as number) + 3_000;
    filas.splice(k + 2, 0, [fch(5), "Movimientos del día", null, 3_000 + (filas[k + 1][3] as number), filas[k + 1][4]]);
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("saldo");
    expect(r.censo?.descartes?.some((d) => d.subtotal)).toBe(true);
  });
});

describe("unicidad: si otra lectura del mismo archivo también cuadra, no se sella", () => {
  it("dos juegos de columnas (pesos y dólares) que cierran cada uno su saldo: sin sello, alerta", async () => {
    const filas: Celda[][] = [["Fecha", "Descripción", "Cargos", "Abonos", "Saldo", "Cargos US$", "Abonos US$", "Saldo US$"], [null, "SALDO INICIAL", null, null, 1_000_000, null, null, 1_000]];
    let s = 1_000_000, u = 1_000;
    for (let i = 1; i <= 14; i++) {
      const esCargo = i % 3 === 0;
      const m = 10_000 + i * 1_370, mu = 10 + i;
      s += esCargo ? -m : m; u += esCargo ? -mu : mu;
      filas.push([fch(i), `MOV ${i}`, esCargo ? m : null, esCargo ? null : m, s, esCargo ? mu : null, esCargo ? null : mu, u]);
    }
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.detalle).toMatch(/otra (forma|lectura)/i);
  });
});

describe("vuelta 2 de la batería", () => {
  it("censo: fecha dd/mm/aa en la columna fecha y plata corrida a otra columna → no pasa callada", async () => {
    const filas: Celda[][] = [["Fecha", "Glosa", "Monto"]];
    for (let d = 1; d <= 12; d++) filas.push([`${String(d).padStart(2, "0")}/09/26`, `Venta ${d}`, 10_000 + d * 137]);
    filas[5][2] = null; filas[5][3] = 914_420; // una celda combinada corrió el monto a una columna sin título
    const r = await parsear(libro(filas));
    expect(r.verificacion?.detalle).toMatch(/no leyó|sin leer|mapa/);
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.alerta).toBe(true);
  });
  it("una fila leída como movimiento cuya glosa dice 'Total…' no deja sellar total_banco", async () => {
    const filas = cartolaConSaldo().map((f) => [f[0], f[1], f[2], f[3]]);
    filas[1] = [null, null, null, null];
    filas[8][1] = "Total del día";
    const c = filas.slice(2).reduce((s, f) => s + (Number(f[2]) || 0), 0);
    const a = filas.slice(2).reduce((s, f) => s + (Number(f[3]) || 0), 0);
    filas.push([], [null, "Total cargos", c, null], [null, "Total abonos", null, a]);
    const r = await parsear(libro(filas));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
  });
  it("movimientos a los dos lados de una fila de totales: sin sello", async () => {
    const filas: Celda[][] = [["Fecha", "Glosa", "Monto", "Tipo", "RUT receptor", "Nombre receptor", "Medio de pago"]];
    for (let d = 1; d <= 12; d++) filas.push([fch(d), `Venta ${d}`, 10_000 + d * 137, "", "", "", ""]);
    const total = filas.slice(1).reduce((s, f) => s + (f[2] as number), 0);
    filas.push([null, "TOTAL", total, "", "", "", ""], [fch(20), "Venta bajo el total", 77_000, "", "", "", ""]);
    // El total es una =SUM del bloque (recalculada): no contradice, pero la venta de abajo queda fuera.
    const r = await parsear(libro(filas, (ws) => { ws["C14"] = { t: "n", v: total, f: "SUM(C2:C13)" }; }));
    expect(r.verificacion?.detalle).toMatch(/total/i);
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
  });
});

describe("resumen del banco en OTRA hoja del libro", () => {
  const plantilla = (): Celda[][] => {
    const filas: Celda[][] = [["Fecha", "Glosa", "Monto"]];
    for (let d = 1; d <= 12; d++) filas.push([fch(d), `Venta ${d}`, 10_000 + d * 137]);
    return filas;
  };
  const total = plantilla().slice(1).reduce((s, f) => s + (f[2] as number), 0);
  it("una hoja 'Resumen' cuyo total de abonos no calza con lo leído: sin sello, alerta", async () => {
    const r = await parsear(libro(plantilla(), undefined, [{ nombre: "Resumen", filas: [["Total Abonos", `$ ${(total + 7_750).toLocaleString("es-CL")}`]] }]));
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.alerta).toBe(true);
  });
  it("si calza, la plantilla sigue con sello cliente", async () => {
    const r = await parsear(libro(plantilla(), undefined, [{ nombre: "Resumen", filas: [["Total Abonos", `$ ${total.toLocaleString("es-CL")}`]] }]));
    expect(r.verificacion?.tipo).toBe("cliente");
  });
});

describe("un monto corrido a la columna FECHA no desaparece callado", () => {
  it("fecha serial de Excel reemplazada por un monto (50.920 = año 2039) y sin monto: sin sello", async () => {
    const filas: Celda[][] = [["Glosa", "Monto", "Fecha"]];
    for (let d = 1; d <= 12; d++) filas.push([`Venta ${d}`, 10_000 + d * 137, 46_265 + d]);
    filas[6] = ["Venta 6", null, 50_920];
    const r = await parsear(libro(filas, (ws) => { for (let i = 2; i <= 13; i++) if (ws[`C${i}`]) ws[`C${i}`].z = "dd/mm/yyyy"; }));
    expect(r.plantilla).toBe(true);
    expect(r.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.verificacion?.alerta).toBe(true);
  });
});
