import { describe, expect, it } from "vitest";
import { calcularCuadre, cuadreParaOps } from "./cuadre";
import type { CensoCartola } from "@/lib/parsers/types";

const censo = (over: Partial<CensoCartola> = {}): CensoCartola => ({
  hoja: "Hoja 1", filas_con_monto: 3, leidas: 3, descartes: [], otras_hojas_con_datos: [], ...over,
});
const fila = (excel_row: number, monto: number, tipo_flujo = "entrada") =>
  ({ excel_row, fecha: "2026-09-04", monto, tipo_flujo, descripcion: `glosa ${excel_row}` });

describe("cuadre de cartola", () => {
  it("todo guardado y confirmado por la DB → cuadra", () => {
    const c = calcularCuadre({
      censo: censo(), leidas: [fila(2, 100), fila(3, 200), fila(4, 50, "salida")],
      filasGuardadas: [2, 3, 4], filasDuplicadas: [], db: { movimientos: 3, propuestas: 3 },
    });
    expect(c.ok).toBe(true);
    expect(c.abonos).toBe(300);
    expect(c.cargos).toBe(50);
  });

  it("caso LC: 2 filas leídas que no se guardaron → pérdida con fila y monto", () => {
    const c = calcularCuadre({
      censo: censo({ filas_con_monto: 4, leidas: 4 }),
      leidas: [fila(2, 100), fila(320, 80000), fila(439, 170000), fila(5, 10)],
      filasGuardadas: [2, 5], filasDuplicadas: [], db: { movimientos: 2, propuestas: 2 },
    });
    expect(c.ok).toBe(false);
    expect(c.perdidas.map((p) => p.excel_row)).toEqual([320, 439]);
    expect(c.monto_perdido).toBe(250000);
  });

  it("fila con plata que el lector descartó sin ser totales → pérdida; totales → no", () => {
    const c = calcularCuadre({
      censo: censo({
        filas_con_monto: 4,
        descartes: [
          { excel_row: 9, motivo: "sin_fecha", legitimo: false, fecha: null, monto: 5000, tipo_flujo: "entrada", descripcion: "x" },
          { excel_row: 10, motivo: "resumen", legitimo: true, fecha: null, monto: 999999, tipo_flujo: null, descripcion: "Total" },
        ],
      }),
      leidas: [fila(2, 100), fila(3, 200)], filasGuardadas: [2, 3], filasDuplicadas: [], db: { movimientos: 2, propuestas: 2 },
    });
    expect(c.ok).toBe(false);
    expect(c.perdidas).toHaveLength(1);
    expect(c.perdidas[0]).toMatchObject({ excel_row: 9, motivo: "sin_fecha", monto: 5000 });
    expect(c.descartes_legitimos).toBe(1);
  });

  it("duplicados que el cliente ya ve no cuentan como pérdida", () => {
    const c = calcularCuadre({
      censo: censo(), leidas: [fila(2, 100), fila(3, 100)],
      filasGuardadas: [2], filasDuplicadas: [3], db: { movimientos: 1, propuestas: 1 },
    });
    expect(c.ok).toBe(true);
    expect(c.duplicadas).toBe(1);
  });

  it("la DB no confirma (movimiento sin propuesta, o sobrantes) → no cuadra", () => {
    const base = { censo: censo(), leidas: [fila(2, 100)], filasGuardadas: [2], filasDuplicadas: [] };
    expect(calcularCuadre({ ...base, db: { movimientos: 1, propuestas: 0 } }).ok).toBe(false);
    expect(calcularCuadre({ ...base, db: { movimientos: 2, propuestas: 2 } }).ok).toBe(false);
  });

  it("otra hoja con movimientos sin leer → aviso, no descuadre", () => {
    const c = calcularCuadre({
      censo: censo({ otras_hojas_con_datos: ["Agosto"] }), leidas: [fila(2, 100)],
      filasGuardadas: [2], filasDuplicadas: [], db: { movimientos: 1, propuestas: 1 },
    });
    expect(c.ok).toBe(true);
    expect(c.otras_hojas_con_datos).toEqual(["Agosto"]);
  });

  it("lo que va a ops no lleva la glosa (PII de terceros)", () => {
    const c = calcularCuadre({
      censo: censo(), leidas: [fila(2, 100)], filasGuardadas: [], filasDuplicadas: [], db: { movimientos: 0, propuestas: 0 },
    });
    expect(JSON.stringify(cuadreParaOps(c))).not.toContain("glosa");
  });
});
