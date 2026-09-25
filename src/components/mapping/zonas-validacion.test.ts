import { describe, expect, it } from "vitest";
import { mensajeValidacionZonas } from "./zonas-validacion";

describe("validación de zonas del mapeador", () => {
  it("la fecha en la PRIMERA columna (índice 0) cuenta como asignada (incidente LC 2026-09-25)", () => {
    expect(mensajeValidacionZonas({ fecha: 0, descripcion: 3 })).toBeNull();
    expect(mensajeValidacionZonas({ fecha: 3, descripcion: 0 })).toBeNull();
  });
  it("sin fecha → obligatoria; sin descripción → obligatoria", () => {
    expect(mensajeValidacionZonas({ descripcion: 1 })).toBe("Fecha es obligatoria");
    expect(mensajeValidacionZonas({ fecha: 1 })).toBe("Descripción / Glosa es obligatoria");
    expect(mensajeValidacionZonas({})).toBe("Fecha es obligatoria");
  });
});
