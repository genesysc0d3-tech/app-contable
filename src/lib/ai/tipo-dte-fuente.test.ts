/**
 * Fase 1 medición — explicarTipoDte replica la precedencia del processor (el cable
 * de auto-clasificación del tipo_dte en el insert de propuestas) y NOMBRA la rama.
 * La referencia de abajo es copia LITERAL de processor.ts (tipoDteAuto +
 * tipoDtePersist): si alguien cambia la decisión, la equivalencia se pone roja y
 * hay que actualizar ambas (o la medición mentiría).
 */
import { describe, expect, it } from "vitest";
import { decidirTipoDteAuto, decidirTipoDteAutoConMotivo, type ClasificacionResult, type DocumentoHint } from "@/lib/sii/clasificador-tipo";
import { explicarTipoDte, fuenteTipoDteAlNacer, FUENTES_TIPO_DTE } from "./tipo-dte-fuente";

function c(tipo: 39 | 41 | null, confianza: number, glosa: "afecta" | "neutral" = "neutral", peso = 0.35): ClasificacionResult {
  const n = { veredicto: "neutral" as const, peso: 0, razon: "" };
  return { tipo_dte: tipo, sugerencia: tipo === 39 ? "afecta" : "exenta", confianza, razones: [], angulos: { glosa: { veredicto: glosa, peso, razon: "" }, giro: n, patron: n } };
}

/** Copia literal de processor.ts (precedencia del tipo_dte al nacer). */
function referenciaProcessor(v: {
  puedePersistirTipo: boolean; esVentaCandidata: boolean; exentoPorCategoria: boolean;
  reglaTipoDte: unknown; exentoFinal: boolean; empExento: boolean;
  clasifTipo: ClasificacionResult; docHint: DocumentoHint; tipoContribuyente: string | null;
}): 39 | 41 | null {
  const tipoDteAuto: 39 | 41 | null =
    !v.esVentaCandidata ? null
      : decidirTipoDteAuto(v.clasifTipo, { docHint: v.docHint, tipoContribuyente: v.tipoContribuyente });
  const tipoDtePersist: 39 | 41 | null =
    !v.puedePersistirTipo ? null
      : v.exentoPorCategoria ? 41
      : v.reglaTipoDte === 39 || v.reglaTipoDte === 41
        ? (v.exentoFinal || v.empExento ? 41 : v.reglaTipoDte)
        : tipoDteAuto;
  return tipoDtePersist;
}

describe("explicarTipoDte — una fuente por rama", () => {
  const base = { puedePersistirTipo: true, esVentaCandidata: true, exentoPorCategoria: false, reglaTipoDte: undefined, emisorExento: false, auto: null };
  it("salida / no_boletar", () => expect(explicarTipoDte({ ...base, puedePersistirTipo: false, reglaTipoDte: 39 })).toEqual({ tipoDte: null, fuente: "salida_o_no_boletar" }));
  it("categoría exenta gana a la regla 39", () => expect(explicarTipoDte({ ...base, exentoPorCategoria: true, reglaTipoDte: 39 })).toEqual({ tipoDte: 41, fuente: "categoria_exenta" }));
  it("regla", () => expect(explicarTipoDte({ ...base, reglaTipoDte: 39 })).toEqual({ tipoDte: 39, fuente: "regla" }));
  it("regla 41 con emisor exento sigue siendo regla", () => expect(explicarTipoDte({ ...base, reglaTipoDte: 41, emisorExento: true })).toEqual({ tipoDte: 41, fuente: "regla" }));
  it("regla 39 forzada a 41 por emisor exento", () => expect(explicarTipoDte({ ...base, reglaTipoDte: 39, emisorExento: true })).toEqual({ tipoDte: 41, fuente: "regla_forzada_exenta" }));
  it("no es venta candidata", () => expect(explicarTipoDte({ ...base, esVentaCandidata: false })).toEqual({ tipoDte: null, fuente: "no_venta" }));
  it("auto con su motivo", () => expect(explicarTipoDte({ ...base, auto: { tipo: 41, motivo: "glosa_exenta" } })).toEqual({ tipoDte: 41, fuente: "auto_glosa_exenta" }));
});

describe("equivalencia con la decisión del processor (exhaustiva)", () => {
  it("mismo tipo en todas las combinaciones, y la fuente nunca es 'desconocido'", () => {
    let n = 0;
    for (const puedePersistirTipo of [true, false])
      for (const esVenta of [true, false])
        for (const exentoPorCategoria of [true, false])
          for (const reglaTipoDte of [undefined, null, 39, 41, 33])
            for (const exentoFinal of [true, false])
              for (const empExento of [true, false])
                for (const tipo of [39, 41, null] as const)
                  for (const conf of [0.5, 0.9])
                    for (const glosa of ["afecta", "neutral"] as const)
                      for (const docHint of [null, "servicios", "p2p_cripto"] as DocumentoHint[])
                        for (const tc of [null, "auto", "afecto", "exento"]) {
                          const esVentaCandidata = puedePersistirTipo && esVenta;
                          const clasifTipo = c(tipo, conf, glosa, 0.8);
                          const esperado = referenciaProcessor({ puedePersistirTipo, esVentaCandidata, exentoPorCategoria, reglaTipoDte, exentoFinal, empExento, clasifTipo, docHint, tipoContribuyente: tc });
                          const auto = esVentaCandidata ? decidirTipoDteAutoConMotivo(clasifTipo, { docHint, tipoContribuyente: tc }) : null;
                          const r = explicarTipoDte({ puedePersistirTipo, esVentaCandidata, exentoPorCategoria, reglaTipoDte, emisorExento: exentoFinal || empExento, auto });
                          expect(r.tipoDte).toBe(esperado);
                          const f = fuenteTipoDteAlNacer({ puedePersistirTipo, esVentaCandidata, exentoPorCategoria, reglaTipoDte, emisorExento: exentoFinal || empExento, clasif: clasifTipo, docHint, tipoContribuyente: tc, tipoDtePersistido: esperado });
                          expect(f).not.toBe("desconocido");
                          expect(FUENTES_TIPO_DTE).toContain(f);
                          n++;
                        }
    expect(n).toBeGreaterThan(10000);
  });

  it("si lo persistido NO calza con la explicación → 'desconocido' (no miente)", () => {
    const f = fuenteTipoDteAlNacer({
      puedePersistirTipo: true, esVentaCandidata: true, exentoPorCategoria: false, reglaTipoDte: 39,
      emisorExento: false, clasif: c(39, 0.9), docHint: null, tipoContribuyente: "auto", tipoDtePersistido: 41,
    });
    expect(f).toBe("desconocido");
  });
});
