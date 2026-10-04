import { describe, expect, it } from "vitest";
import {
  aplicarCorreccion,
  esDecisionMirada,
  estadoEnPalabras,
  nombreReglaAprendida,
  recalcularEstado,
  type ReglaConHistorial,
} from "./regla-evidencia";

const regla = (o: Partial<ReglaConHistorial> = {}): ReglaConHistorial => ({
  empresa_id: "emp",
  estado: "a_prueba",
  tipo_dte: 41,
  veces_confirmada: 0,
  veces_corregida: 0,
  aprendida_bajo_marca: false,
  ...o,
});

describe("regla-evidencia: a_prueba → firme por cartolas distintas", () => {
  it("2 confirmaciones con al menos una mirada → firme", () => {
    expect(recalcularEstado(regla(), { confirmadas: 2, confirmadasMiradas: 1 })).toMatchObject({ estado: "firme", veces_confirmada: 2, cambio: true });
  });
  it("2 confirmaciones a ciegas no bastan; 3 sí", () => {
    expect(recalcularEstado(regla(), { confirmadas: 2, confirmadasMiradas: 0 }).estado).toBe("a_prueba");
    expect(recalcularEstado(regla(), { confirmadas: 3, confirmadasMiradas: 0 }).estado).toBe("firme");
  });
  it("1 confirmación mirada sigue a prueba (un lote de 300 cuenta 1)", () => {
    expect(recalcularEstado(regla(), { confirmadas: 1, confirmadasMiradas: 1 })).toMatchObject({ estado: "a_prueba", veces_confirmada: 1 });
  });
  it("una firme NUNCA baja por falta de confirmaciones (reglas existentes)", () => {
    expect(recalcularEstado(regla({ estado: "firme" }), { confirmadas: 0, confirmadasMiradas: 0 })).toMatchObject({ estado: "firme", cambio: false });
  });
  it("las globales siempre firmes y su contador no se toca", () => {
    expect(recalcularEstado(regla({ empresa_id: null, estado: "firme", veces_confirmada: 7 }), { confirmadas: 0, confirmadasMiradas: 0 }))
      .toMatchObject({ estado: "firme", veces_confirmada: 7, cambio: false });
  });
  it("deshecha / huérfana / en disputa no se mueven solas", () => {
    for (const e of ["deshecha", "huerfana", "en_disputa"]) {
      expect(recalcularEstado(regla({ estado: e }), { confirmadas: 9, confirmadasMiradas: 9 }).estado).toBe(e);
    }
  });
  it("corregidas ≥2 y ≥ confirmadas → en_disputa (también una firme)", () => {
    expect(recalcularEstado(regla({ estado: "firme", veces_corregida: 2 }), { confirmadas: 2, confirmadasMiradas: 2 }).estado).toBe("en_disputa");
    expect(recalcularEstado(regla({ estado: "firme", veces_corregida: 2 }), { confirmadas: 3, confirmadasMiradas: 0 }).estado).toBe("firme");
  });
});

describe("regla-evidencia: corrección baja de nivel, no pisa", () => {
  it("firme → a_prueba sin cambiar el tipo", () => {
    expect(aplicarCorreccion(regla({ estado: "firme" }), { tipoNuevo: 39, confirmadas: 5 }))
      .toMatchObject({ efecto: "baja_a_prueba", estado: "a_prueba", tipo_dte: 41, veces_corregida: 1 });
  });
  it("a_prueba sin confirmaciones → se da vuelta al tipo nuevo (y apaga la señal de marca)", () => {
    expect(aplicarCorreccion(regla({ tipo_dte: 39, aprendida_bajo_marca: true }), { tipoNuevo: 41, confirmadas: 0 }))
      .toMatchObject({ efecto: "se_da_vuelta", estado: "a_prueba", tipo_dte: 41, veces_corregida: 1, aprendida_bajo_marca: false });
  });
  it("a_prueba con ≥1 confirmación → en_disputa, sin cambiar el tipo", () => {
    expect(aplicarCorreccion(regla(), { tipoNuevo: 39, confirmadas: 1 }))
      .toMatchObject({ efecto: "en_disputa", estado: "en_disputa", tipo_dte: 41 });
  });
  it("dos vueltas seguidas → en_disputa (corregidas 2 ≥ confirmadas 0)", () => {
    const una = aplicarCorreccion(regla(), { tipoNuevo: 39, confirmadas: 0 });
    const dos = aplicarCorreccion(regla({ estado: una.estado, tipo_dte: una.tipo_dte, veces_corregida: una.veces_corregida }), { tipoNuevo: 41, confirmadas: 0 });
    expect(dos).toMatchObject({ estado: "en_disputa", tipo_dte: 39, veces_corregida: 2 });
  });
  it("una firme corregida dos veces con pocas confirmaciones → en_disputa", () => {
    expect(aplicarCorreccion(regla({ estado: "firme", veces_corregida: 1 }), { tipoNuevo: 39, confirmadas: 2 }).estado).toBe("en_disputa");
  });
  it("mismo tipo, global, deshecha o huérfana → nada", () => {
    expect(aplicarCorreccion(regla(), { tipoNuevo: 41, confirmadas: 0 }).efecto).toBe("ninguno");
    expect(aplicarCorreccion(regla({ empresa_id: null, estado: "firme" }), { tipoNuevo: 39, confirmadas: 0 }).efecto).toBe("ninguno");
    expect(aplicarCorreccion(regla({ estado: "deshecha" }), { tipoNuevo: 39, confirmadas: 0 }).efecto).toBe("ninguno");
    expect(aplicarCorreccion(regla({ estado: "huerfana" }), { tipoNuevo: 39, confirmadas: 0 }).efecto).toBe("ninguno");
  });
});

describe("regla-evidencia: canal mirado, nombres y palabras", () => {
  it("check_fila/check_detalle siempre; lote humano solo si ≤25; propagación nunca", () => {
    expect(esDecisionMirada({ canal: "check_fila" })).toBe(true);
    expect(esDecisionMirada({ canal: "check_detalle", lote_n: 300 })).toBe(true);
    expect(esDecisionMirada({ canal: "check_lote", lote_n: 25 })).toBe(true);
    expect(esDecisionMirada({ canal: "check_lote", lote_n: 26 })).toBe(false);
    expect(esDecisionMirada({ canal: "aprobar_cartola", lote_n: 300 })).toBe(false);
    expect(esDecisionMirada({ canal: "propagacion", lote_n: 1 })).toBe(false);
  });
  it("el nombre de la regla nunca lleva al tercero", () => {
    expect(nombreReglaAprendida(41)).toBe("Contraparte aprendida · Exenta");
    expect(nombreReglaAprendida(39)).toBe("Contraparte aprendida · Afecta");
  });
  it("estado en palabras de la clienta", () => {
    expect(estadoEnPalabras("a_prueba")).toBe("Aprendiendo");
    expect(estadoEnPalabras("firme")).toBe("Segura");
    expect(estadoEnPalabras("en_disputa")).toBe("No estoy seguro");
  });
});
