import { describe, expect, it } from "vitest";
import type { ClasificacionResult } from "@/lib/sii/clasificador-tipo";
import { ajustarPorConflicto, decidirEstadoInicial, decidirTipoDtePersistido, type DecidirTipoDteInput } from "./tipo-dte-persistido";
import { destinoPropuesta, FUENTE_CONFLICTO_MARCA } from "@/lib/sii/destino";

const neutral = { veredicto: "neutral" as const, peso: 0, razon: "" };
function clasif(p: Partial<ClasificacionResult> = {}): ClasificacionResult {
  return { tipo_dte: 41, sugerencia: "exenta", confianza: 0.6, razones: [], angulos: { glosa: neutral, giro: neutral, patron: neutral }, ...p };
}
function entrada(p: Partial<DecidirTipoDteInput> = {}): DecidirTipoDteInput {
  return {
    tipoFlujo: "entrada", tipoBase: "boleta", clasif: clasif(), docHint: null,
    tipoContribuyente: "auto", reglaTipoDte: null, emisorExento: false, ...p,
  };
}

describe("decidirTipoDtePersistido — marca P2P/forex de la cartola protege contra reglas 39", () => {
  it("regla 39 + cartola marcada P2P → sin tipo_dte (a revisar), conflicto", () => {
    const r = decidirTipoDtePersistido(entrada({ reglaTipoDte: 39, docHint: "p2p_cripto" }));
    expect(r.tipoDte).toBeNull();
    expect(r.conflictoMarcaCartola).toBe(true);
  });
  it("regla 39 + cartola marcada forex → sin tipo_dte", () => {
    expect(decidirTipoDtePersistido(entrada({ reglaTipoDte: 39, docHint: "forex_divisas" })).tipoDte).toBeNull();
  });
  it("regla 39 sin marca (o marca servicios) → la regla manda (39)", () => {
    expect(decidirTipoDtePersistido(entrada({ reglaTipoDte: 39 })).tipoDte).toBe(39);
    expect(decidirTipoDtePersistido(entrada({ reglaTipoDte: 39, docHint: "servicios" })).tipoDte).toBe(39);
  });
  it("regla 41 + cartola P2P → 41 (coincide, sin conflicto)", () => {
    const r = decidirTipoDtePersistido(entrada({ reglaTipoDte: 41, docHint: "p2p_cripto" }));
    expect(r).toMatchObject({ tipoDte: 41, conflictoMarcaCartola: false });
  });
  it("regla 39 con emisor exento → 41 (nunca 39)", () => {
    expect(decidirTipoDtePersistido(entrada({ reglaTipoDte: 39, emisorExento: true })).tipoDte).toBe(41);
  });
});

describe("decidirTipoDtePersistido — comportamiento previo conservado", () => {
  it("salida o no_boletar → null aunque la regla diga 41", () => {
    expect(decidirTipoDtePersistido(entrada({ tipoFlujo: "salida", reglaTipoDte: 41 })).tipoDte).toBeNull();
    expect(decidirTipoDtePersistido(entrada({ clasif: clasif({ sugerencia: "no_boletar", tipo_dte: null }), reglaTipoDte: 41 })).tipoDte).toBeNull();
  });
  it("categoría exenta por naturaleza → 41 aunque la regla diga 39", () => {
    expect(decidirTipoDtePersistido(entrada({ tipoBase: "transferencia_p2p", reglaTipoDte: 39 })).tipoDte).toBe(41);
  });
  it("sin regla: auto con hint por-cartola → 41", () => {
    const r = decidirTipoDtePersistido(entrada({ docHint: "p2p_cripto" }));
    expect(r.tipoDte).toBe(41);
    expect(r.tipoDteAuto).toBe(41);
  });
});

describe("decidirTipoDtePersistido — destino único", () => {
  it("arriendo/comisión (preguntar) nacen SIN tipo_dte, ni por auto ni por regla", () => {
    for (const tipoBase of ["arriendo", "comision"]) {
      expect(decidirTipoDtePersistido(entrada({ tipoBase, docHint: "p2p_cripto" })).tipoDte).toBeNull();
      expect(decidirTipoDtePersistido(entrada({ tipoBase, reglaTipoDte: 41 })).tipoDte).toBeNull();
      expect(decidirTipoDtePersistido(entrada({ tipoBase, emisorExento: true, tipoContribuyente: "exento" })).tipoDte).toBeNull();
    }
  });
  it("una no-venta no recibe tipo_dte aunque la regla lo traiga", () => {
    expect(decidirTipoDtePersistido(entrada({ tipoBase: "no_comercial", reglaTipoDte: 41 })).tipoDte).toBeNull();
  });
});

describe("decidirEstadoInicial — solo una VENTA nace «listo»", () => {
  const base = { confianza: 0.95, reglaId: "regla-global-sobregiro" };
  it("sobregiro / no_comercial / gasto de regla global con 0.95 → pendiente", () => {
    for (const tipoPropuesto of ["no_comercial", "gasto_egreso", "impuesto", "arriendo", "comision"]) {
      expect(decidirEstadoInicial({ ...base, tipoPropuesto })).toBe("pendiente");
    }
  });
  it("venta por regla con confianza alta → listo", () => {
    for (const tipoPropuesto of ["boleta", "exenta", "transferencia_p2p", "factura_afecta"]) {
      expect(decidirEstadoInicial({ ...base, tipoPropuesto })).toBe("listo");
    }
  });
  it("sin regla, bajo umbral o con conflicto de marca → pendiente", () => {
    expect(decidirEstadoInicial({ confianza: 0.95, reglaId: null, tipoPropuesto: "boleta" })).toBe("pendiente");
    expect(decidirEstadoInicial({ confianza: 0.84, reglaId: "r", tipoPropuesto: "boleta" })).toBe("pendiente");
    expect(decidirEstadoInicial({ ...base, tipoPropuesto: "boleta", conflictoMarcaCartola: true })).toBe("pendiente");
  });
});

describe("conflicto regla↔marca → la fila nace «¿?» DE HECHO (M1)", () => {
  it("confianza bajo el bulk (0.8) y fuente de conflicto; destinoPropuesta = preguntar", () => {
    const r = decidirTipoDtePersistido(entrada({ reglaTipoDte: 39, docHint: "p2p_cripto" }));
    const aj = ajustarPorConflicto(r.conflictoMarcaCartola, { confianza: 0.95, fuente: "regla_usuario" });
    expect(aj.confianza).toBeLessThan(0.8);
    expect(aj.fuente).toBe(FUENTE_CONFLICTO_MARCA);
    expect(destinoPropuesta({ tipo_propuesto: "boleta", tipo_dte: r.tipoDte, fuente_clasificacion: aj.fuente })).toBe("preguntar");
  });
  it("sin conflicto no cambia nada", () => {
    expect(ajustarPorConflicto(false, { confianza: 0.95, fuente: "regla_usuario" })).toEqual({ confianza: 0.95, fuente: "regla_usuario" });
  });
});
