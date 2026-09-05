import { describe, it, expect } from "vitest";
import { normalizarTipoPorEmisor, esVentaExentaEmisor } from "./tipo-emisor";

describe("normalizarTipoPorEmisor", () => {
  it("empresa exenta: boleta afecta -> exenta genérica", () => {
    expect(normalizarTipoPorEmisor("boleta", { tipo_contribuyente: "exento" })).toBe("exenta");
  });

  it("empresa exenta: factura / factura_afecta -> factura_exenta", () => {
    expect(normalizarTipoPorEmisor("factura", { tipo_contribuyente: "exento" })).toBe("factura_exenta");
    expect(normalizarTipoPorEmisor("factura_afecta", { tipo_contribuyente: "exento" })).toBe("factura_exenta");
  });

  it("empresa afecta: NO cambia (default histórico afecto)", () => {
    expect(normalizarTipoPorEmisor("boleta", { tipo_contribuyente: "afecto" })).toBe("boleta");
    expect(normalizarTipoPorEmisor("factura", { tipo_contribuyente: "afecto" })).toBe("factura");
  });

  it("empresa null / auto / desconocida: NO cambia (fallback seguro)", () => {
    expect(normalizarTipoPorEmisor("boleta", null)).toBe("boleta");
    expect(normalizarTipoPorEmisor("boleta", null)).toBe("boleta");
    expect(normalizarTipoPorEmisor("boleta", { tipo_contribuyente: "auto" })).toBe("boleta");
  });

  it("empresa exenta: NO toca no-ventas ni tipos ya exentos", () => {
    expect(normalizarTipoPorEmisor("gasto_egreso", { tipo_contribuyente: "exento" })).toBe("gasto_egreso");
    expect(normalizarTipoPorEmisor("no_comercial", { tipo_contribuyente: "exento" })).toBe("no_comercial");
    expect(normalizarTipoPorEmisor("boleta_honorarios", { tipo_contribuyente: "exento" })).toBe("boleta_honorarios");
    expect(normalizarTipoPorEmisor("compraventa_crypto", { tipo_contribuyente: "exento" })).toBe("compraventa_crypto");
    expect(normalizarTipoPorEmisor("operacion_forex", { tipo_contribuyente: "exento" })).toBe("operacion_forex");
    expect(normalizarTipoPorEmisor("exenta", { tipo_contribuyente: "exento" })).toBe("exenta");
  });
});

describe("esVentaExentaEmisor", () => {
  it("true solo para venta afecta de un emisor exento (fuerza iva=0)", () => {
    expect(esVentaExentaEmisor("boleta", { tipo_contribuyente: "exento" })).toBe(true);
    expect(esVentaExentaEmisor("factura", { tipo_contribuyente: "exento" })).toBe(true);
    expect(esVentaExentaEmisor("factura_afecta", { tipo_contribuyente: "exento" })).toBe(true);
  });

  it("false para no-ventas, ya-exentos, o empresa no exenta", () => {
    expect(esVentaExentaEmisor("gasto_egreso", { tipo_contribuyente: "exento" })).toBe(false);
    expect(esVentaExentaEmisor("compraventa_crypto", { tipo_contribuyente: "exento" })).toBe(false);
    expect(esVentaExentaEmisor("boleta", { tipo_contribuyente: "afecto" })).toBe(false);
    expect(esVentaExentaEmisor("boleta", null)).toBe(false);
  });
});

/**
 * Defaults POR CARRIL (2026-09-04): la empresa mixta —boletas exentas por un
 * lado, facturas afectas por otro— ya no tiene que elegir una sola verdad.
 * Estos casos MUERDEN: si alguien vuelve a juzgar los dos mundos con
 * `tipo_contribuyente`, fallan.
 */
describe("defaults por carril", () => {
  const mixta = { tipo_contribuyente: "afecto", boletas_tipo_default: "exento", facturas_tipo_default: "afecto" };

  it("la boleta sigue su carril aunque el general diga afecto", () => {
    expect(normalizarTipoPorEmisor("boleta", mixta)).toBe("exenta");
    expect(esVentaExentaEmisor("boleta", mixta)).toBe(true);
  });

  it("la factura NO se contagia del carril de boletas", () => {
    expect(normalizarTipoPorEmisor("factura", mixta)).toBe("factura");
    expect(esVentaExentaEmisor("factura", mixta)).toBe(false);
  });

  it("y al revés: facturas exentas no vuelven exenta la boleta", () => {
    const alReves = { tipo_contribuyente: "afecto", boletas_tipo_default: "afecto", facturas_tipo_default: "exento" };
    expect(normalizarTipoPorEmisor("boleta", alReves)).toBe("boleta");
    expect(normalizarTipoPorEmisor("factura", alReves)).toBe("factura_exenta");
    expect(normalizarTipoPorEmisor("factura_afecta", alReves)).toBe("factura_exenta");
  });

  it("carril sin valor propio hereda el general (nada cambia para quien no lo tocó)", () => {
    const soloGeneral = { tipo_contribuyente: "exento", boletas_tipo_default: null, facturas_tipo_default: null };
    expect(normalizarTipoPorEmisor("boleta", soloGeneral)).toBe("exenta");
    expect(normalizarTipoPorEmisor("factura", soloGeneral)).toBe("factura_exenta");
  });
});
