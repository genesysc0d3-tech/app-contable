import { describe, it, expect } from "vitest";
import { evaluarCorrelacion, type MovimientoCorrelacionable } from "./correlacion";

const banco = (over: Partial<MovimientoCorrelacionable> = {}): MovimientoCorrelacionable =>
  ({ id: "b1", fuente: "banco", montoClp: 100000, fecha: "2026-06-14", ...over });
const bin = (over: Partial<MovimientoCorrelacionable> = {}): MovimientoCorrelacionable =>
  ({ id: "x1", fuente: "binance", montoClp: 100000, fecha: "2026-06-14", ...over });

describe("evaluarCorrelacion", () => {
  it("sin candidatos → nueva", () => {
    expect(evaluarCorrelacion(banco(), []).accion).toBe("nueva");
  });

  it("NUNCA une la misma fuente (dos abonos del banco, mismo monto/día) → nueva", () => {
    expect(evaluarCorrelacion(banco({ id: "b1" }), [banco({ id: "b2" })]).accion).toBe("nueva");
  });

  it("único candidato de otra fuente, monto exacto, mismo día → unir", () => {
    expect(evaluarCorrelacion(banco(), [bin({ id: "x1" })])).toMatchObject({ accion: "unir", conId: "x1" });
  });

  it("dos candidatos exactos de otra fuente → revisar (ambiguo)", () => {
    const d = evaluarCorrelacion(banco(), [bin({ id: "x1" }), bin({ id: "x2" })]);
    expect(d.accion).toBe("revisar");
    if (d.accion === "revisar") expect(d.candidatos).toEqual(["x1", "x2"]);
  });

  it("código de operación coincide (único) → unir, aunque haya otro candidato exacto sin código", () => {
    const d = evaluarCorrelacion(
      banco({ codigoOperacion: "OP9" }),
      [bin({ id: "x1", codigoOperacion: "OP9" }), bin({ id: "x2" })],
    );
    expect(d).toMatchObject({ accion: "unir", conId: "x1" });
  });

  it("varios candidatos con el mismo código → revisar", () => {
    const d = evaluarCorrelacion(
      banco({ codigoOperacion: "OP9" }),
      [bin({ id: "x1", codigoOperacion: "OP9" }), bin({ id: "x2", codigoOperacion: "OP9" })],
    );
    expect(d.accion).toBe("revisar");
  });

  it("único candidato pero monto solo aproximado (banda por fee) → revisar (no une solo)", () => {
    const d = evaluarCorrelacion(banco({ montoClp: 100000 }), [bin({ id: "x1", montoClp: 99000 })], { toleranciaMonto: 2000 });
    expect(d.accion).toBe("revisar");
  });

  it("monto exacto pero distinto día → nueva", () => {
    expect(evaluarCorrelacion(banco({ fecha: "2026-06-14" }), [bin({ id: "x1", fecha: "2026-06-15" })]).accion).toBe("nueva");
  });

  it("con hora: dentro de la ventana → unir; fuera → nueva", () => {
    expect(evaluarCorrelacion(banco({ hora: "15:00" }), [bin({ id: "x1", hora: "15:10" })], { ventanaMinutos: 30 }).accion).toBe("unir");
    expect(evaluarCorrelacion(banco({ hora: "15:00" }), [bin({ id: "x1", hora: "16:00" })], { ventanaMinutos: 30 }).accion).toBe("nueva");
  });
});
