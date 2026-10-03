import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parsePdfCartola } from "../parsers";
import { detectarFormatoConocido } from "./formatos-conocidos";
import { grillaDesdeItems, itemsDePdf } from "./pdf-grilla";
import { cartolaPdfSintetica, type OpcionesPdf } from "./testing/cartola-pdf-sintetica";

/**
 * Los 2 formatos PDF reales (2026-10-02) quedan como FORMATOS CONOCIDOS: huella
 * → mapa registrado (capa 1) → juez. Fixtures sintéticos con el mismo formato.
 */
beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-02T12:00:00-03:00")); });
afterAll(() => { vi.useRealTimers(); });

const ID = { itau: "itau-cartola-historica-pdf", estado: "estado-de-cuenta-desde-hasta-pdf" } as const;

async function leer(o: OpcionesPdf) {
  const c = await cartolaPdfSintetica(o);
  return { c, r: (await parsePdfCartola(c.pdf))! };
}

describe("entran por el camino «formato conocido»", () => {
  const casos: OpcionesPdf[] = [
    { formato: "itau", filas: 12, seed: 3 },
    { formato: "itau", filas: 40, seed: 11, glosaMultilinea: true },
    { formato: "itau", filas: 8, seed: 5 },
    { formato: "estado", filas: 120, seed: 21, anio: 2022 },
    { formato: "estado", filas: 3, seed: 886, anio: 2023, mes: 3 },
    { formato: "estado", filas: 12, seed: 1856, unSentido: "cargos" },
  ];
  for (const o of casos) {
    it(`${o.formato} ${o.filas} filas${o.unSentido ? " solo " + o.unSentido : ""}: capa 1, mapa conocido, exacta y sellada por el juez`, async () => {
      const { c, r } = await leer(o);
      expect(r.capa_usada).toBe(1);
      expect(r.censo?.mapa).toMatchObject({ formato_conocido: ID[o.formato], estado: "confirmado", nuevo: false });
      expect(r.censo?.mapa?.confirmado_por).toBe(r.censo?.verificacion?.tipo);
      expect(r.preExtracted!.map((m) => [m.fecha, m.monto, m.tipo_flujo === "entrada" ? "ENTRADA" : "SALIDA"]))
        .toEqual(c.verdad.map((v) => [v.fecha, v.monto, v.tipo]));
      expect(["saldo", "total_banco"]).toContain(r.censo?.verificacion?.tipo);
    });
  }
});

describe("formato conocido NO es sello", () => {
  for (const formato of ["itau", "estado"] as const) {
    it(`${formato} con un monto alterado: entra por conocido pero el juez no sella`, async () => {
      const { r } = await leer({ formato, filas: 20, seed: 31, montoAlterado: true });
      expect(r.capa_usada).toBe(1);
      expect(r.censo?.verificacion).toMatchObject({ tipo: "sin_comprobar", alerta: true });
    });
  }
  it("itau sin resumen y pocas filas: conocido, exacto, pero sin prueba → sin sello y se pide mirar (mapa provisorio)", async () => {
    const { r } = await leer({ formato: "itau", filas: 6, seed: 5, sinResumen: true });
    expect(r.capa_usada).toBe(1);
    expect(r.censo?.verificacion?.tipo).toBe("sin_comprobar");
    expect(r.censo?.mapa).toMatchObject({ estado: "provisorio", nuevo: true });
    const { revisarColumnas } = await import("../cartola/verificacion");
    expect(revisarColumnas({ verificacion: r.censo!.verificacion!, mapa: r.censo!.mapa! }).abrir).toBe(true);
  });
});

describe("huella incompleta → no es formato conocido (sigue la heurística)", () => {
  it("títulos cruzados (cargo↔abono) no calzan con la huella", async () => {
    const { r } = await leer({ formato: "estado", filas: 20, seed: 37, titulosCruzados: true });
    expect(r.capa_usada).not.toBe(1);
  });
  it("sin las marcas del banco arriba, los mismos títulos no bastan", async () => {
    const { c } = await leer({ formato: "estado", filas: 12, seed: 2 });
    const rows = grillaDesdeItems(await itemsDePdf(c.pdf));
    expect(detectarFormatoConocido(rows)?.formato.id).toBe(ID.estado);
    const h = rows.findIndex((r) => String(r[0]).toLowerCase() === "fecha");
    expect(detectarFormatoConocido(rows.slice(h))).toBeNull();
  });
  it("sin período explícito (Desde/Hasta) no se reconoce", async () => {
    const { c } = await leer({ formato: "estado", filas: 12, seed: 2 });
    const rows = grillaDesdeItems(await itemsDePdf(c.pdf)).map((r) => r.map((v) => (/^\d{2}-\d{2}-\d{4}$/.test(String(v)) && r[0] === "Desde" ? "" : v)));
    const sinPeriodo = rows.map((r) => (r[0] === "Desde" ? ["Desde", "", "Hasta", ""] : r));
    expect(detectarFormatoConocido(sinPeriodo)).toBeNull();
  });
});

describe("formatos conocidos derivados de las specs reales (Excel)", () => {
  it("cada formato registrado entra por «conocido» con SU spec, lee exacto y el juez decide el sello", async () => {
    const { leerSpecs, rendir } = await import("../../../scripts/corpus-cartolas/generador");
    const { parseExcelWithOrchestrator } = await import("./orchestrator");
    const { FORMATOS_DE_SPECS } = await import("./formatos-conocidos.specs");
    const specs = new Map(leerSpecs().map((s) => [s.id, s]));
    expect(FORMATOS_DE_SPECS.length).toBe(10);
    for (const f of FORMATOS_DE_SPECS) {
      const c = rendir(specs.get(f.id)!, 7);
      const { result: r } = await parseExcelWithOrchestrator(c.buf, {});
      expect({ id: f.id, conocido: r.censo?.mapa?.formato_conocido }).toEqual({ id: f.id, conocido: f.id });
      expect(r.capa_usada).toBe(1);
      const leido = (r.preExtracted ?? []).map((m) => `${m.fecha}|${m.monto}|${m.tipo_flujo === "entrada" ? "ENTRADA" : "SALIDA"}`).sort();
      expect({ id: f.id, leido }).toEqual({ id: f.id, leido: c.verdad.map((v) => `${v.fecha}|${v.monto}|${v.tipo}`).sort() });
    }
  });

  it("specs excluidas (títulos genéricos, caseras, editadas) NO entran por conocido", async () => {
    const { leerSpecs, rendir } = await import("../../../scripts/corpus-cartolas/generador");
    const { SPECS_EXCLUIDAS } = await import("./formatos-conocidos.specs");
    const XLSX = await import("xlsx");
    const { leerLibroCartola } = await import("./libro");
    const alias: Record<string, string> = { "mis-movimientos-solo-ingresos-con-saldo": "mis-movimientos-completa", "santander-movimientos-ctacte-completa": "santander-movimientos-ctacte" };
    for (const s of leerSpecs().filter((x) => SPECS_EXCLUIDAS[x.id])) {
      const wb = leerLibroCartola(rendir(s, 3).buf);
      for (const n of wb.SheetNames) {
        const d = detectarFormatoConocido(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" }) as never)?.formato.id ?? null;
        expect({ id: s.id, d }).toEqual({ id: s.id, d: alias[s.id] && d ? alias[s.id] : null });
      }
    }
  });

  it("columnas cargo↔abono intercambiadas (títulos en otro orden) no calzan con la huella", async () => {
    const { leerSpecs, rendir } = await import("../../../scripts/corpus-cartolas/generador");
    const XLSX = await import("xlsx");
    const { leerLibroCartola } = await import("./libro");
    const s = leerSpecs().find((x) => x.id === "bice-estado-de-cuenta")!;
    const i = s.columnas.findIndex((c) => c.rol === "cargo"), j = s.columnas.findIndex((c) => c.rol === "abono");
    const cols = [...s.columnas]; [cols[i], cols[j]] = [cols[j], cols[i]];
    const wb = leerLibroCartola(rendir({ ...s, columnas: cols }, 5).buf);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }) as never;
    expect(detectarFormatoConocido(rows)).toBeNull();
  });
});
