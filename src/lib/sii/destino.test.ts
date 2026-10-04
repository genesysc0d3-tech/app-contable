import { describe, expect, it } from "vitest";
import {
  destino, esAfectoPorTipo, esExentoPorTipo, esVentaEmitible, TIPOS_EMITIBLES,
  TIPOS_POR_DECIDIR, TODOS_LOS_TIPOS, VERSION_REGLAS_TRIBUTARIAS,
} from "./destino";

describe("destino único — reglas tributarias", () => {
  it("boleta: boleta, exenta, P2P, cripto, forex", () => {
    for (const t of ["boleta", "exenta", "transferencia_p2p", "compraventa_crypto", "operacion_forex"]) {
      expect(destino(t)).toBe("boleta");
    }
  });
  it("factura: factura, factura_afecta, factura_exenta", () => {
    for (const t of ["factura", "factura_afecta", "factura_exenta"]) expect(destino(t)).toBe("factura");
  });
  it("no_es_venta: gastos, no comerciales, impuestos, honorarios (BHE va por sii.cl)…", () => {
    for (const t of ["gasto", "gasto_egreso", "no_comercial", "ignorar", "registro_crypto", "impuesto",
      "cotizacion_previsional", "remuneracion", "dividendo", "interes", "retencion", "donacion", "boleta_honorarios"]) {
      expect(destino(t)).toBe("no_es_venta");
    }
  });
  it("preguntar: arriendo y comisión (pendiente Matías)", () => {
    expect(destino("arriendo")).toBe("preguntar");
    expect(destino("comision")).toBe("preguntar");
    expect([...TIPOS_POR_DECIDIR].sort()).toEqual(["arriendo", "comision"]);
  });
  it("ante la duda (tipo desconocido / vacío) → preguntar, nunca adivinar", () => {
    for (const t of ["", null, undefined, "boleta afecta", "BOLETA"]) expect(destino(t)).toBe("preguntar");
  });
  it("TIPOS_EMITIBLES = destino boleta (misma lista que tenía la cola de Emitir)", () => {
    expect([...TIPOS_EMITIBLES].sort()).toEqual(["boleta", "compraventa_crypto", "exenta", "operacion_forex", "transferencia_p2p"]);
  });
  it("exento/afecto por tipo solo para ventas; arriendo/comisión no son ni uno ni otro", () => {
    expect(esExentoPorTipo("transferencia_p2p")).toBe(true);
    expect(esAfectoPorTipo("factura_afecta")).toBe(true);
    expect(esAfectoPorTipo("boleta")).toBe(true);
    for (const t of ["arriendo", "comision", "no_comercial", "gasto"]) {
      expect(esExentoPorTipo(t)).toBe(false);
      expect(esAfectoPorTipo(t)).toBe(false);
      expect(esVentaEmitible(t)).toBe(false);
    }
  });
  it("lleva versión", () => {
    expect(VERSION_REGLAS_TRIBUTARIAS).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(TODOS_LOS_TIPOS.length).toBe(23);
  });
});
