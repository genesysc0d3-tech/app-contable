import { describe, it, expect } from "vitest";
import { normalizarTipoPorEmisor, esVentaExentaEmisor } from "./tipo-emisor";

describe("normalizarTipoPorEmisor", () => {
  it("empresa exenta: boleta afecta -> exenta genérica", () => {
    expect(normalizarTipoPorEmisor("boleta", "exento")).toBe("exenta");
  });

  it("empresa exenta: factura / factura_afecta -> factura_exenta", () => {
    expect(normalizarTipoPorEmisor("factura", "exento")).toBe("factura_exenta");
    expect(normalizarTipoPorEmisor("factura_afecta", "exento")).toBe("factura_exenta");
  });

  it("empresa afecta: NO cambia (default histórico afecto)", () => {
    expect(normalizarTipoPorEmisor("boleta", "afecto")).toBe("boleta");
    expect(normalizarTipoPorEmisor("factura", "afecto")).toBe("factura");
  });

  it("empresa null / auto / desconocida: NO cambia (fallback seguro)", () => {
    expect(normalizarTipoPorEmisor("boleta", null)).toBe("boleta");
    expect(normalizarTipoPorEmisor("boleta", undefined)).toBe("boleta");
    expect(normalizarTipoPorEmisor("boleta", "auto")).toBe("boleta");
  });

  it("empresa exenta: NO toca no-ventas ni tipos ya exentos", () => {
    expect(normalizarTipoPorEmisor("gasto_egreso", "exento")).toBe("gasto_egreso");
    expect(normalizarTipoPorEmisor("no_comercial", "exento")).toBe("no_comercial");
    expect(normalizarTipoPorEmisor("boleta_honorarios", "exento")).toBe("boleta_honorarios");
    expect(normalizarTipoPorEmisor("compraventa_crypto", "exento")).toBe("compraventa_crypto");
    expect(normalizarTipoPorEmisor("operacion_forex", "exento")).toBe("operacion_forex");
    expect(normalizarTipoPorEmisor("exenta", "exento")).toBe("exenta");
  });
});

describe("esVentaExentaEmisor", () => {
  it("true solo para venta afecta de un emisor exento (fuerza iva=0)", () => {
    expect(esVentaExentaEmisor("boleta", "exento")).toBe(true);
    expect(esVentaExentaEmisor("factura", "exento")).toBe(true);
    expect(esVentaExentaEmisor("factura_afecta", "exento")).toBe(true);
  });

  it("false para no-ventas, ya-exentos, o empresa no exenta", () => {
    expect(esVentaExentaEmisor("gasto_egreso", "exento")).toBe(false);
    expect(esVentaExentaEmisor("compraventa_crypto", "exento")).toBe(false);
    expect(esVentaExentaEmisor("boleta", "afecto")).toBe(false);
    expect(esVentaExentaEmisor("boleta", null)).toBe(false);
  });
});
