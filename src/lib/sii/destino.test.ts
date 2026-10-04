import { describe, expect, it } from "vitest";
import {
  destino, destinoPropuesta, FUENTE_CONFLICTO_MARCA, motivoNoEmitible, PG_OR_ES_POR_DECIDIR, PG_OR_SIN_CONFLICTO_MARCA, PG_TIPOS_POR_DECIDIR, TIPOS_VENTA,
  esAfectoPorTipo, esExentoPorTipo, esVentaEmitible, TIPOS_EMITIBLES,
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

describe("destinoPropuesta / motivoNoEmitible — la fila, no solo el tipo", () => {
  const conflicto = { tipo_propuesto: "boleta", tipo_dte: null, fuente_clasificacion: FUENTE_CONFLICTO_MARCA };
  it("conflicto regla↔marca sin decisión → preguntar; con tipo_dte (decisión humana) → boleta", () => {
    expect(destinoPropuesta(conflicto)).toBe("preguntar");
    expect(destinoPropuesta({ ...conflicto, tipo_dte: 39 })).toBe("boleta");
    expect(destinoPropuesta({ ...conflicto, tipo_propuesto: "exenta", tipo_dte: 41 })).toBe("boleta");
  });
  it("arriendo con un 41 viejo del cable automático sigue «¿?» (no fue una persona)", () => {
    expect(destinoPropuesta({ tipo_propuesto: "arriendo", tipo_dte: 41, fuente_clasificacion: "regla_global" })).toBe("preguntar");
  });
  it("motivoNoEmitible: «¿?» y no-ventas nunca se emiten; ventas sí", () => {
    expect(motivoNoEmitible(conflicto)?.code).toBe("TIPO_POR_DECIDIR");
    expect(motivoNoEmitible({ tipo_propuesto: "arriendo" })?.code).toBe("TIPO_POR_DECIDIR");
    expect(motivoNoEmitible({ tipo_propuesto: "no_comercial", tipo_dte: 41 })?.code).toBe("NO_ES_VENTA");
    expect(motivoNoEmitible({ tipo_propuesto: "gasto_egreso" })?.code).toBe("NO_ES_VENTA");
    expect(motivoNoEmitible({ tipo_propuesto: "transferencia_p2p", tipo_dte: 41 })).toBeNull();
    expect(motivoNoEmitible({ tipo_propuesto: "factura_afecta", tipo_dte: 33 })).toBeNull();
  });
  it("los filtros PostgREST describen lo mismo que destinoPropuesta", () => {
    expect(PG_TIPOS_POR_DECIDIR).toBe("(arriendo,comision)");
    expect(PG_OR_SIN_CONFLICTO_MARCA).toContain(`fuente_clasificacion.neq.${FUENTE_CONFLICTO_MARCA}`);
    expect(PG_OR_ES_POR_DECIDIR).toContain(`and(fuente_clasificacion.eq.${FUENTE_CONFLICTO_MARCA},tipo_dte.is.null)`);
  });
  it("TIPOS_VENTA = boleta + factura", () => {
    expect(TIPOS_VENTA).toHaveLength(8);
    for (const t of TIPOS_VENTA) expect(["boleta", "factura"]).toContain(destino(t));
  });
});
