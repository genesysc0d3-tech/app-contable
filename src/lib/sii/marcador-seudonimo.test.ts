import { describe, it, expect } from "vitest";
import { validarBoleta } from "./validation";

// Un marcador de seudonimización que llega hasta la emisión significa que el
// ciclo tokenizar → clasificar → re-pegar identidad se rompió en algún punto.
// La boleta al SII es irreversible y no hay Nota de Crédito: acá se aborta.

const base = {
  tipo_dte: 41 as const,
  detalles: [{ nombre: "Venta de servicios", monto: 50_000 }],
  monto_total: 50_000,
};

const tieneMarcador = (r: ReturnType<typeof validarBoleta>) =>
  r.errors.some((e) => e.code === "MARCADOR_SEUDONIMO_SIN_RESOLVER");

describe("candado de marcadores en la emisión", () => {
  it("deja pasar una boleta normal", () => {
    const r = validarBoleta(base);
    expect(tieneMarcador(r)).toBe(false);
  });

  it("aborta si el token quedó como nombre del receptor", () => {
    const r = validarBoleta({ ...base, receptor_razon_social: "PER_3" });
    expect(tieneMarcador(r)).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("aborta si el token quedó embebido, no solo solo", () => {
    const r = validarBoleta({ ...base, receptor_razon_social: "Transf de PER_12" });
    expect(tieneMarcador(r)).toBe(true);
  });

  it("aborta si el token se coló como RUT — el caso que módulo 11 no caza", () => {
    const r = validarBoleta({ ...base, receptor_rut: "PER_1" });
    expect(tieneMarcador(r)).toBe(true);
  });

  it("aborta si un monto quedó enmascarado en la glosa impresa", () => {
    const r = validarBoleta({
      ...base,
      detalles: [{ nombre: "Transferencia por [NUM]", monto: 50_000 }],
    });
    expect(tieneMarcador(r)).toBe(true);
  });

  it("aborta si el marcador viene en la dirección o la comuna", () => {
    expect(tieneMarcador(validarBoleta({ ...base, receptor_direccion: "PER_2" }))).toBe(true);
    expect(tieneMarcador(validarBoleta({ ...base, receptor_comuna: "PER_9" }))).toBe(true);
  });

  it("no confunde texto legítimo que se le parece", () => {
    const r = validarBoleta({
      ...base,
      receptor_razon_social: "SUPERMERCADO PEREZ",
      detalles: [{ nombre: "Venta PER-2024 lote 5", monto: 50_000 }],
    });
    expect(tieneMarcador(r)).toBe(false);
  });
});
