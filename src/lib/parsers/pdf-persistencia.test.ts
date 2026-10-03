import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Hallazgos de la revisión (2026-10-02): (b) un PDF nunca persiste un formato
 * aprendido salvo que quede SELLADO por el banco; (c) un PDF nunca lanza
 * PlantillaFacturasEnCartolaError (null → flujo anterior).
 */
const guardados: unknown[] = [];
vi.mock("./adapter-store", () => ({
  getAdapterByFingerprint: async () => null,
  getAdaptersConfirmadosEmpresa: async () => [],
  confirmarAdapter: async () => true,
  saveAdapter: async (a: unknown) => { guardados.push(a); return "adapter-test"; },
  promoverMapaGlobalSiHayConsenso: async () => false,
  incrementAdapterSuccess: async () => {},
  decrementAdapterConfianza: async () => {},
  logParserEvent: async () => {},
}));
vi.mock("../ops/events", () => ({ recordOpsEvent: async () => {} }));
beforeEach(() => { guardados.length = 0; });

/** Cartola PDF SIN formato conocido (títulos propios), con o sin saldo que cuadre. */
async function cartolaNoConocida(o: { cuadra: boolean; titulos?: string[] }): Promise<Uint8Array> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  doc.setFontSize(8);
  doc.text("Cartola cuenta vista", 40, 40);
  doc.text("Saldo anterior", 40, 54);
  doc.text("$ 1.000.000", 140, 54);
  const tit = o.titulos ?? ["Fecha", "Detalle movimiento", "Cargos", "Abonos", "Saldo"];
  const xs = tit.length > 5 ? [40, 95, 160, 330, 395, 460, 545] : [40, 110, 330, 400, 470];
  tit.forEach((s, i) => doc.text(s, xs[i], 80));
  let saldo = 1_000_000;
  for (let i = 0; i < 14; i++) {
    const m = 10_000 + i * 1_370; const sal = i % 3 === 0;
    saldo += sal ? -m : m;
    const y = 94 + i * 13;
    const fila = [`${String(1 + i).padStart(2, "0")}/09/2026`, `Movimiento ficticio ${i}`, sal ? `$ ${m.toLocaleString("es-CL")}` : "", sal ? "" : `$ ${m.toLocaleString("es-CL")}`, `$ ${(o.cuadra || i !== 7 ? saldo : saldo + 1).toLocaleString("es-CL")}`];
    if (tit.length > 5) fila.splice(1, 0, `7${i}.111.111-1`);
    fila.forEach((s, k) => s && doc.text(s, xs[k], y));
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

describe("un PDF no enseña formatos sin sello", () => {
  it("cartola PDF no conocida SIN sello, con empresa → no se guarda ningún adaptador", async () => {
    const { parsePdfCartola } = await import("../parsers");
    const r = await parsePdfCartola(await cartolaNoConocida({ cuadra: false }), { empresa_id: "emp-test", documento_id: "doc-1" });
    expect(r).not.toBeNull();
    expect(r!.censo?.verificacion?.tipo).toBe("sin_comprobar");
    expect(guardados).toHaveLength(0);
  });
  it("la misma cartola SELLADA por saldo → sí se guarda (confirmado por saldo)", async () => {
    const { parsePdfCartola } = await import("../parsers");
    const r = await parsePdfCartola(await cartolaNoConocida({ cuadra: true }), { empresa_id: "emp-test", documento_id: "doc-1" });
    expect(r!.censo?.verificacion?.tipo).toBe("saldo");
    expect(guardados).toHaveLength(1);
  });
});

describe("plantilla de facturas dentro de un PDF", () => {
  it("nunca lanza PlantillaFacturasEnCartolaError: null y sigue el flujo anterior", async () => {
    const { parsePdfCartola } = await import("../parsers");
    const pdf = await cartolaNoConocida({ cuadra: true, titulos: ["Fecha", "RUT", "Descripción", "Cargos", "Abonos", "Saldo", "Total"] });
    let motivo = "";
    await expect(parsePdfCartola(pdf, { diagnostico: (d) => { motivo = d.motivo; } })).resolves.toBeNull();
    expect(motivo).toBe("plantilla_facturas");
  });
});
