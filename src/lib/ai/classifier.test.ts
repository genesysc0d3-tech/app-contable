import { describe, expect, it } from "vitest";
import { ruleMatches, classifyWithRules, type ClasificacionRegla } from "./classifier";
import type { MovimientoExtraido } from "./types";

// Motor de reglas del sistema de aprendizaje (clasificacion_reglas). Funciones puras:
// dada una regla + un movimiento, ¿matchea? y ¿cómo arma la propuesta?
function mov(p: Partial<MovimientoExtraido>): MovimientoExtraido {
  return { fecha: "2026-06-08", descripcion: "", monto: 100000, tipo_flujo: "entrada", origen: "otro", ...p };
}
function regla(p: Partial<ClasificacionRegla>): ClasificacionRegla {
  return {
    id: "r1", empresa_id: null, nombre: "regla", patron: "", patron_tipo: "contains",
    tipo_flujo_match: null, tipo_propuesto: "compraventa_crypto",
    receptor_nombre_default: null, receptor_rut_default: null, confianza: 0.9, prioridad: 50, ...p,
  };
}

describe("ruleMatches", () => {
  it("contains es case-insensitive", () => {
    expect(ruleMatches(mov({ descripcion: "COMPRA USDT BINANCE" }), regla({ patron: "binance" }))).toBe(true);
    expect(ruleMatches(mov({ descripcion: "transf juan" }), regla({ patron: "BINANCE" }))).toBe(false);
  });

  it("starts_with mira solo el inicio", () => {
    expect(ruleMatches(mov({ descripcion: "TRANSF JUAN" }), regla({ patron: "transf", patron_tipo: "starts_with" }))).toBe(true);
    expect(ruleMatches(mov({ descripcion: "PAGO TRANSF" }), regla({ patron: "transf", patron_tipo: "starts_with" }))).toBe(false);
  });

  it("exact compara todo (case-insensitive)", () => {
    expect(ruleMatches(mov({ descripcion: "Arriendo" }), regla({ patron: "ARRIENDO", patron_tipo: "exact" }))).toBe(true);
    expect(ruleMatches(mov({ descripcion: "Arriendo depto" }), regla({ patron: "ARRIENDO", patron_tipo: "exact" }))).toBe(false);
  });

  it("regex con flag i; regex inválida devuelve false sin tirar", () => {
    expect(ruleMatches(mov({ descripcion: "venta USDT" }), regla({ patron: "usdt|btc", patron_tipo: "regex" }))).toBe(true);
    expect(ruleMatches(mov({ descripcion: "cualquier cosa" }), regla({ patron: "[", patron_tipo: "regex" }))).toBe(false);
  });

  it("respeta tipo_flujo_match (no matchea si la dirección difiere)", () => {
    const r = regla({ patron: "usdt", tipo_flujo_match: "entrada" });
    expect(ruleMatches(mov({ descripcion: "venta usdt", tipo_flujo: "entrada" }), r)).toBe(true);
    expect(ruleMatches(mov({ descripcion: "compra usdt", tipo_flujo: "salida" }), r)).toBe(false);
  });

  it("descripción vacía nunca matchea", () => {
    expect(ruleMatches(mov({ descripcion: "   " }), regla({ patron: "x" }))).toBe(false);
  });
});

describe("classifyWithRules", () => {
  it("gana la primera regla que matchea (orden = prioridad) y total = monto", () => {
    const reglas = [
      regla({ id: "r-prio", patron: "usdt", tipo_propuesto: "compraventa_crypto", prioridad: 50 }),
      regla({ id: "r-otra", patron: "usdt", tipo_propuesto: "operacion_forex", prioridad: 80 }),
    ];
    const res = classifyWithRules([mov({ descripcion: "venta USDT", monto: 500000 })], reglas);
    expect(res.clasificados).toHaveLength(1);
    expect(res.clasificados[0].regla_id).toBe("r-prio");
    expect(res.clasificados[0].propuesta.total).toBe(500000);
    expect(res.noClasificados).toHaveLength(0);
  });

  it("sin regla que matchee → noClasificados", () => {
    const res = classifyWithRules([mov({ descripcion: "algo raro" })], [regla({ patron: "usdt" })]);
    expect(res.clasificados).toHaveLength(0);
    expect(res.noClasificados).toHaveLength(1);
    expect(res.noClasificados[0].movimiento_index).toBe(0);
  });

  it("factura_afecta calcula IVA 19% (neto/iva); crypto sin IVA", () => {
    const afecta = classifyWithRules([mov({ descripcion: "factura x", monto: 119000 })], [regla({ patron: "factura", tipo_propuesto: "factura_afecta" })]);
    expect(afecta.clasificados[0].propuesta.monto_neto).toBe(100000);
    expect(afecta.clasificados[0].propuesta.iva).toBe(19000);
    const crypto = classifyWithRules([mov({ descripcion: "usdt", monto: 119000 })], [regla({ patron: "usdt", tipo_propuesto: "compraventa_crypto" })]);
    expect(crypto.clasificados[0].propuesta.monto_neto).toBe(119000);
    expect(crypto.clasificados[0].propuesta.iva).toBe(0);
  });

  it("fuente: empresa_id → regla_usuario; null → regla_global", () => {
    const usuario = classifyWithRules([mov({ descripcion: "usdt" })], [regla({ patron: "usdt", empresa_id: "emp1" })]);
    expect(usuario.clasificados[0].fuente).toBe("regla_usuario");
    const global = classifyWithRules([mov({ descripcion: "usdt" })], [regla({ patron: "usdt", empresa_id: null })]);
    expect(global.clasificados[0].fuente).toBe("regla_global");
  });

  it("receptor: usa el default; si no hay, lo infiere de 'TRANSF DE X'", () => {
    const conDefault = classifyWithRules([mov({ descripcion: "usdt" })], [regla({ patron: "usdt", receptor_nombre_default: "Cliente Fijo" })]);
    expect(conDefault.clasificados[0].propuesta.receptor_nombre).toBe("Cliente Fijo");
    const inferido = classifyWithRules([mov({ descripcion: "TRANSF DE JUAN PEREZ" })], [regla({ patron: "transf", receptor_nombre_default: null })]);
    expect(inferido.clasificados[0].propuesta.receptor_nombre).toBe("JUAN PEREZ");
  });
});
