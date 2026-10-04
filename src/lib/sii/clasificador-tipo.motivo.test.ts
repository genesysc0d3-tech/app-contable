/**
 * Fase 1 medición — decidirTipoDteAutoConMotivo: la MISMA decisión que
 * decidirTipoDteAuto, más el porqué (se graba como orig_tipo_dte_fuente =
 * auto_<motivo>). Muerde si alguien cambia una rama sin la otra.
 */
import { describe, expect, it } from "vitest";
import {
  decidirTipoDteAuto,
  decidirTipoDteAutoConMotivo,
  type ClasificacionResult,
  type DocumentoHint,
} from "./clasificador-tipo";

function c(tipo: 39 | 41 | null, confianza: number, glosa: "afecta" | "exenta" | "neutral" = "neutral", peso = 0.35): ClasificacionResult {
  const n = { veredicto: "neutral" as const, peso: 0, razon: "" };
  return {
    tipo_dte: tipo,
    sugerencia: tipo === 39 ? "afecta" : tipo === 41 ? "exenta" : "no_boletar",
    confianza,
    razones: [],
    angulos: { glosa: { veredicto: glosa, peso, razon: "" }, giro: n, patron: n },
  };
}

describe("decidirTipoDteAutoConMotivo — un motivo por rama", () => {
  const casos: Array<[string, ClasificacionResult, DocumentoHint, string | null, 39 | 41 | null, string]> = [
    ["emisor exento", c(39, 0.9), null, "exento", 41, "empresa_exenta"],
    ["sin hint y confianza baja", c(41, 0.6), null, "auto", null, "no_firme"],
    ["41 firme", c(41, 0.9), null, "auto", 41, "glosa_exenta"],
    ["41 por hint aunque confianza baja", c(41, 0.5), "p2p_cripto", "auto", 41, "glosa_exenta"],
    ["sin tipo", c(null, 0.95), null, "auto", null, "sin_tipo"],
    ["39 con emisor afecto", c(39, 0.9), null, "afecto", 39, "contribuyente_afecto"],
    ["39 con keyword real en la glosa", c(39, 0.9, "afecta", 0.8), null, "auto", 39, "glosa_afecta"],
    ["39 con hint servicios", c(39, 0.6), "servicios", "auto", 39, "hint_afecta"],
    ["39 con hint ventas", c(39, 0.6), "ventas", "auto", 39, "hint_afecta"],
    ["39 con default suave (peso 0,35)", c(39, 0.9, "afecta", 0.35), null, "auto", null, "sin_evidencia_afecta"],
  ];
  for (const [nombre, clasif, docHint, tc, tipo, motivo] of casos) {
    it(nombre, () => {
      expect(decidirTipoDteAutoConMotivo(clasif, { docHint, tipoContribuyente: tc })).toEqual({ tipo, motivo });
    });
  }
});

describe("decidirTipoDteAuto es el envoltorio exacto (.tipo)", () => {
  it("coincide en todas las combinaciones", () => {
    const hints: DocumentoHint[] = [null, "p2p_cripto", "forex_divisas", "servicios", "ventas", "mixto"];
    for (const tipo of [39, 41, null] as const)
      for (const conf of [0.3, 0.84, 0.85, 0.99])
        for (const glosa of ["afecta", "exenta", "neutral"] as const)
          for (const peso of [0.35, 0.7, 0.9])
            for (const docHint of hints)
              for (const tc of [null, "auto", "afecto", "exento"]) {
                const cl = c(tipo, conf, glosa, peso);
                const opts = { docHint, tipoContribuyente: tc };
                expect(decidirTipoDteAuto(cl, opts)).toBe(decidirTipoDteAutoConMotivo(cl, opts).tipo);
              }
  });
});
