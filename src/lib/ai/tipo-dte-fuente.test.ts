/**
 * Fase 1 medición — orig_tipo_dte_fuente sale de la PROPIA decisión
 * (decidirTipoDtePersistido → .fuente). Un caso por rama + barrido exhaustivo:
 * la fuente siempre es de la lista cerrada, nunca 'desconocido', y calza con el
 * tipo decidido (auto_* ⇒ tipo del auto, conflicto ⇒ null y marca, etc.).
 */
import { describe, expect, it } from "vitest";
import type { ClasificacionResult, DocumentoHint } from "@/lib/sii/clasificador-tipo";
import { decidirTipoDtePersistido, type DecidirTipoDteInput } from "./tipo-dte-persistido";
import { FUENTES_TIPO_DTE } from "./tipo-dte-fuente";

function c(tipo: 39 | 41 | null, confianza: number, glosa: "afecta" | "neutral" = "neutral", sugerencia?: ClasificacionResult["sugerencia"]): ClasificacionResult {
  const n = { veredicto: "neutral" as const, peso: 0, razon: "" };
  return {
    tipo_dte: tipo, sugerencia: sugerencia ?? (tipo === 39 ? "afecta" : "exenta"), confianza, razones: [],
    angulos: { glosa: { veredicto: glosa, peso: 0.8, razon: "" }, giro: n, patron: n },
  };
}
const base: DecidirTipoDteInput = {
  tipoFlujo: "entrada", tipoBase: "boleta", clasif: c(41, 0.9), docHint: null,
  tipoContribuyente: "auto", reglaTipoDte: null, emisorExento: false,
};
const fuente = (p: Partial<DecidirTipoDteInput>) => decidirTipoDtePersistido({ ...base, ...p });

describe("fuente por rama", () => {
  it("salida", () => expect(fuente({ tipoFlujo: "salida", reglaTipoDte: 41 })).toMatchObject({ tipoDte: null, fuente: "salida_o_no_boletar" }));
  it("no_boletar", () => expect(fuente({ clasif: c(null, 0.9, "neutral", "no_boletar") })).toMatchObject({ tipoDte: null, fuente: "salida_o_no_boletar" }));
  it("no es venta (gasto) aunque la regla traiga tipo", () => expect(fuente({ tipoBase: "gasto", reglaTipoDte: 39 })).toMatchObject({ tipoDte: null, fuente: "no_venta" }));
  it("categoría exenta gana a la regla 39", () => expect(fuente({ tipoBase: "exenta", reglaTipoDte: 39 })).toMatchObject({ tipoDte: 41, fuente: "categoria_exenta" }));
  it("regla", () => expect(fuente({ reglaTipoDte: 39 })).toMatchObject({ tipoDte: 39, fuente: "regla" }));
  it("regla 39 forzada a 41 por emisor exento", () => expect(fuente({ reglaTipoDte: 39, emisorExento: true })).toMatchObject({ tipoDte: 41, fuente: "regla_forzada_exenta" }));
  it("regla 41 con emisor exento sigue siendo regla", () => expect(fuente({ reglaTipoDte: 41, emisorExento: true })).toMatchObject({ tipoDte: 41, fuente: "regla" }));
  it("conflicto regla 39 ↔ marca P2P → fuente propia", () =>
    expect(fuente({ reglaTipoDte: 39, docHint: "p2p_cripto" })).toMatchObject({ tipoDte: null, conflictoMarcaCartola: true, fuente: "conflicto_marca_cartola" }));
  it("regla 39 confirmada en la marca → regla", () =>
    expect(fuente({ reglaTipoDte: 39, docHint: "p2p_cripto", reglaConfirmadaEnMarca: true })).toMatchObject({ tipoDte: 39, fuente: "regla" }));
  it("auto con su motivo", () => expect(fuente({})).toMatchObject({ tipoDte: 41, fuente: "auto_glosa_exenta" }));
  it("auto sin evidencia de afecta", () => expect(fuente({ clasif: c(39, 0.9) })).toMatchObject({ tipoDte: null, fuente: "auto_sin_evidencia_afecta" }));
});

describe("barrido exhaustivo: fuente coherente con la decisión", () => {
  it("siempre de la lista, nunca 'desconocido', y calza con el tipo", () => {
    let n = 0;
    for (const tipoFlujo of ["entrada", "salida"])
      for (const tipoBase of ["boleta", "exenta", "gasto", "factura_afecta", "arriendo", "no_comercial"])
        for (const reglaTipoDte of [null, undefined, 39, 41, 33])
          for (const emisorExento of [true, false])
            for (const reglaConfirmadaEnMarca of [true, false])
              for (const tipo of [39, 41, null] as const)
                for (const conf of [0.5, 0.9])
                  for (const glosa of ["afecta", "neutral"] as const)
                    for (const sug of [undefined, "no_boletar"] as const)
                      for (const docHint of [null, "servicios", "p2p_cripto", "forex_divisas"] as DocumentoHint[])
                        for (const tc of [null, "auto", "afecto", "exento"]) {
                          const r = decidirTipoDtePersistido({ tipoFlujo, tipoBase, clasif: c(tipo, conf, glosa, sug), docHint, tipoContribuyente: tc, reglaTipoDte, emisorExento, reglaConfirmadaEnMarca });
                          expect(FUENTES_TIPO_DTE).toContain(r.fuente);
                          expect(r.fuente).not.toBe("desconocido");
                          if (r.fuente.startsWith("auto_")) expect(r.tipoDte).toBe(r.tipoDteAuto);
                          expect(r.fuente === "conflicto_marca_cartola").toBe(r.conflictoMarcaCartola);
                          if (["salida_o_no_boletar", "no_venta", "conflicto_marca_cartola"].includes(r.fuente)) expect(r.tipoDte).toBeNull();
                          if (["categoria_exenta", "regla_forzada_exenta"].includes(r.fuente)) expect(r.tipoDte).toBe(41);
                          if (r.fuente === "regla") expect(r.tipoDte).toBe(emisorExento ? 41 : reglaTipoDte);
                          n++;
                        }
    expect(n).toBeGreaterThan(50000);
  });
});
