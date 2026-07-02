import { describe, expect, it } from "vitest";
import { computeFingerprint } from "./fingerprint";
import type { Row } from "./types";

describe("computeFingerprint — huella estructural de una planilla", () => {
  it("es determinista y devuelve 16 chars hex", () => {
    const rows: Row[] = [["Fecha", "Glosa"], ["14/06/2026", "Pago"]];
    const fp = computeFingerprint(rows);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(computeFingerprint(rows)).toBe(fp);
  });

  it("MISMA estructura con valores distintos → MISMA huella (no filtra datos)", () => {
    // Cada celda conserva su "tipo" (texto corto / fecha / número); solo
    // cambian los valores. La huella debe coincidir.
    const a: Row[] = [
      ["Fecha", "Glosa", "Monto"],
      ["14/06/2026", "Pago arriendo", "100000"],
      ["15/06/2026", "Giro cajero", "50000"],
    ];
    const b: Row[] = [
      ["Date", "Memo", "Amt"],
      ["01/01/2020", "Venta web", "7"],
      ["28/02/2021", "Cobro", "9"],
    ];
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
  });

  it("formatos de fecha distintos pero ambos fechas → MISMA huella (estructural, no textual)", () => {
    expect(computeFingerprint([["14/06/2026", "x"]])).toBe(
      computeFingerprint([["2026-06-14", "x"]]),
    );
  });

  it("estructura distinta (otra cantidad de columnas) → huella distinta", () => {
    const tresCols: Row[] = [["Fecha", "Glosa", "Monto"], ["14/06/2026", "Pago", "100000"]];
    const cuatroCols: Row[] = [
      ["Fecha", "Glosa", "Cargo", "Abono"],
      ["14/06/2026", "Pago", "", "100000"],
    ];
    expect(computeFingerprint(tresCols)).not.toBe(computeFingerprint(cuatroCols));
  });

  it("tipos de celda distintos (número vs texto) → huella distinta", () => {
    expect(computeFingerprint([["123"]])).not.toBe(computeFingerprint([["abc"]]));
  });

  it("celda vacía y celda solo-espacios colapsan al mismo tipo", () => {
    expect(computeFingerprint([["", "x"]])).toBe(computeFingerprint([["   ", "x"]]));
  });

  it("solo considera las primeras 20 filas (las posteriores no cambian la huella)", () => {
    const first20: Row[] = Array.from({ length: 20 }, () => ["12/06/2026", "mov", "100"]);
    const fp = computeFingerprint(first20);
    const withTail: Row[] = [
      ...first20,
      ["99/99/9999", "zzzzzzzzzzzzzzzzzzzzzzzzz", "999999999"], // fila 21, ignorada
    ];
    expect(computeFingerprint(withTail)).toBe(fp);

    // cambiar una de las primeras 20 SÍ altera la huella
    const changed = first20.map((r, i) => (i === 19 ? [...r, "extra"] : r));
    expect(computeFingerprint(changed)).not.toBe(fp);
  });
});
