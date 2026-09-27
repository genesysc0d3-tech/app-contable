import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { completarGlosaVacia } from "./processor";

// Incidente LC 2026-09-27: el BCI "Detallado" trae abonos sin nombre del pagador.
// El lector los leía bien (fecha + monto), pero el filtro de filas basura de la IA
// los botaba por descripción vacía: $250.000 que nunca llegaron a la mesa.
describe("abono real sin glosa", () => {
  const base = { fecha: "2026-09-04", monto: 170000, tipo_flujo: "entrada", origen: "cartola_preparseada" };

  it("una fila del lector sin glosa se guarda con una descripción explícita", () => {
    expect(completarGlosaVacia({ ...base, descripcion: "" }).descripcion).toBe("Abono sin glosa en la cartola");
    expect(completarGlosaVacia({ ...base, tipo_flujo: "salida", descripcion: null }).descripcion).toBe("Cargo sin glosa en la cartola");
  });

  it("una fila vacía que devolvió la IA sigue descartándose (totales, encabezados)", () => {
    expect(completarGlosaVacia({ ...base, origen: "ia", descripcion: "" }).descripcion).toBe("");
  });

  it("sin fecha o sin monto no se inventa un movimiento", () => {
    expect(completarGlosaVacia({ ...base, fecha: null, descripcion: "" }).descripcion).toBe("");
    expect(completarGlosaVacia({ ...base, monto: null, descripcion: "" }).descripcion).toBe("");
  });

  it("una glosa normal no se toca", () => {
    expect(completarGlosaVacia({ ...base, descripcion: "Transferencia de P. R." }).descripcion).toBe("Transferencia de P. R.");
  });
});
