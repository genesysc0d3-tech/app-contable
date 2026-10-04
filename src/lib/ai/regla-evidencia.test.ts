import { describe, expect, it } from "vitest";
import {
  aplicarCorreccion,
  avisoCorreccion,
  esCorreccionDeRegla,
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
  it("corregidas EN LA VENTANA ≥2 y ≥ confirmadas → en_disputa (también una firme); la historia vieja no cuenta", () => {
    expect(recalcularEstado(regla({ estado: "firme", corregidas_en_ventana: 2 }), { confirmadas: 2, confirmadasMiradas: 2 }).estado).toBe("en_disputa");
    expect(recalcularEstado(regla({ estado: "firme", corregidas_en_ventana: 2 }), { confirmadas: 3, confirmadasMiradas: 0 }).estado).toBe("firme");
    expect(recalcularEstado(regla({ estado: "firme", veces_corregida: 9, corregidas_en_ventana: 0 }), { confirmadas: 1, confirmadasMiradas: 0 }).estado).toBe("firme");
  });
});

describe("regla-evidencia: corrección (A1 — no empeorar lo que hoy aprende al tiro)", () => {
  const mirada = true, ciega = false;
  it("firme SIN evidencia + corrección → se da vuelta al tipo nuevo, a_prueba, ventana nueva", () => {
    expect(aplicarCorreccion(regla({ estado: "firme" }), { tipoNuevo: 39, confirmadas: 0, mirada: ciega }))
      .toMatchObject({ efecto: "se_da_vuelta", estado: "a_prueba", tipo_dte: 39, veces_corregida: 1, corregidas_en_ventana: 0, reiniciaVentana: true });
  });
  it("a_prueba sin evidencia → se da vuelta (y apaga la señal de marca)", () => {
    expect(aplicarCorreccion(regla({ tipo_dte: 39, aprendida_bajo_marca: true }), { tipoNuevo: 41, confirmadas: 0, mirada }))
      .toMatchObject({ efecto: "se_da_vuelta", estado: "a_prueba", tipo_dte: 41, aprendida_bajo_marca: false });
  });
  it("CON evidencia + corrección MIRADA → en_disputa, sin cambiar el tipo", () => {
    for (const estado of ["firme", "a_prueba"]) {
      expect(aplicarCorreccion(regla({ estado }), { tipoNuevo: 39, confirmadas: 2, mirada }))
        .toMatchObject({ efecto: "en_disputa", estado: "en_disputa", tipo_dte: 41, reiniciaVentana: true });
    }
  });
  it("CON evidencia + 1ª corrección A CIEGAS (lote > 25) → sigue firme con su tipo, suma la corrección; la 2ª en la ventana → en_disputa", () => {
    const una = aplicarCorreccion(regla({ estado: "firme", tipo_dte: 39 }), { tipoNuevo: 41, confirmadas: 5, mirada: ciega });
    expect(una).toMatchObject({ efecto: "suma", estado: "firme", tipo_dte: 39, veces_corregida: 1, corregidas_en_ventana: 1, reiniciaVentana: false });
    const dos = aplicarCorreccion(regla({ estado: "firme", tipo_dte: 39, veces_corregida: 1, corregidas_en_ventana: 1 }), { tipoNuevo: 41, confirmadas: 5, mirada: ciega });
    expect(dos).toMatchObject({ efecto: "en_disputa", estado: "en_disputa", tipo_dte: 39 });
  });
  it("B1: firme 39 con 5 cartolas corregida (mirada) → en_disputa; las 5 confirmaciones no la re-promueven", () => {
    const una = aplicarCorreccion(regla({ estado: "firme", tipo_dte: 39, veces_confirmada: 5 }), { tipoNuevo: 41, confirmadas: 5, mirada });
    expect(una.estado).toBe("en_disputa");
    expect(recalcularEstado(regla({ estado: "en_disputa", tipo_dte: 39 }), { confirmadas: 9, confirmadasMiradas: 9 }).estado).toBe("en_disputa");
  });
  it("en_disputa: la MISMA elección mirada 2 veces seguidas → sale con ese tipo (a_prueba, ventana nueva)", () => {
    const d = regla({ estado: "en_disputa", tipo_dte: 39, veces_corregida: 1 });
    const a = aplicarCorreccion(d, { tipoNuevo: 41, confirmadas: 0, mirada });
    expect(a).toMatchObject({ efecto: "suma", estado: "en_disputa", disputa_eleccion: 41, disputa_racha: 1 });
    const b = aplicarCorreccion(regla({ ...d, disputa_eleccion: 41, disputa_racha: 1 }), { tipoNuevo: 41, confirmadas: 0, mirada });
    expect(b).toMatchObject({ efecto: "sale_de_disputa", estado: "a_prueba", tipo_dte: 41, disputa_racha: 0, reiniciaVentana: true });
  });
  it("en_disputa: elecciones distintas reinician la racha; una a ciegas no la arma ni la rompe", () => {
    const d = regla({ estado: "en_disputa", tipo_dte: 39, disputa_eleccion: 41, disputa_racha: 1 });
    expect(aplicarCorreccion(d, { tipoNuevo: 39, confirmadas: 0, mirada })).toMatchObject({ estado: "en_disputa", disputa_eleccion: 39, disputa_racha: 1 });
    expect(aplicarCorreccion(d, { tipoNuevo: 41, confirmadas: 0, mirada: ciega })).toMatchObject({ estado: "en_disputa", disputa_eleccion: 41, disputa_racha: 1, efecto: "suma" });
  });
  it("mismo tipo, global, deshecha o huérfana → nada", () => {
    expect(aplicarCorreccion(regla(), { tipoNuevo: 41, confirmadas: 0, mirada }).efecto).toBe("ninguno");
    expect(aplicarCorreccion(regla({ empresa_id: null, estado: "firme" }), { tipoNuevo: 39, confirmadas: 0, mirada }).efecto).toBe("ninguno");
    expect(aplicarCorreccion(regla({ estado: "deshecha" }), { tipoNuevo: 39, confirmadas: 0, mirada }).efecto).toBe("ninguno");
    expect(aplicarCorreccion(regla({ estado: "huerfana" }), { tipoNuevo: 39, confirmadas: 0, mirada }).efecto).toBe("ninguno");
  });
  it("M2: corrige solo si la fila mostraba el tipo de la regla (no un tipo forzado/cambiado); en disputa cuenta cualquier elección", () => {
    expect(esCorreccionDeRegla({ estado: "firme", tipo_dte: 39 }, { tipoFila: 39, tipoNuevo: 41 })).toBe(true);
    expect(esCorreccionDeRegla({ estado: "firme", tipo_dte: 39 }, { tipoFila: 41, tipoNuevo: 41 })).toBe(false); // emisor exento forzó 41
    expect(esCorreccionDeRegla({ estado: "firme", tipo_dte: 39 }, { tipoFila: null, tipoNuevo: 41 })).toBe(false); // conflicto de marca / sin tipo
    expect(esCorreccionDeRegla({ estado: "en_disputa", tipo_dte: 39 }, { tipoFila: null, tipoNuevo: 41 })).toBe(true);
  });
  it("aviso en idioma de la clienta", () => {
    expect(avisoCorreccion("se_da_vuelta", "Juan Perez", 41)).toBe("Aprendí: desde ahora Juan Perez va como Exenta.");
    expect(avisoCorreccion("en_disputa", "Juan Perez", 39)).toBe("Ya no estoy seguro de Juan Perez: te lo voy a preguntar.");
    expect(avisoCorreccion("sale_de_disputa", null, 39)).toBe("Aprendí: desde ahora esa contraparte va como Afecta.");
    expect(avisoCorreccion("suma", "Juan Perez", 41)).toBeNull();
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
