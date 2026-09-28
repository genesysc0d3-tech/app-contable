import { describe, expect, it } from "vitest";
import { fechaParaEmitir, noSalioEsConfiable } from "./fecha-intento";

// 27-sep-2026 23:59:30 y 28-sep 00:00:05 hora Chile (UTC−3).
const antes = Date.parse("2026-09-28T02:59:30Z");
const despues = Date.parse("2026-09-28T03:00:05Z");

describe("fechaParaEmitir — por boleta, no la del modal", () => {
  it("dos boletas a ambos lados de las 00:00 Chile llevan fechas distintas", () => {
    expect(fechaParaEmitir(new Date(antes))).toBe("2026-09-27");
    expect(fechaParaEmitir(new Date(despues))).toBe("2026-09-28");
  });
});

describe("noSalioEsConfiable — guarda de medianoche", () => {
  it("todo el mismo día → se puede creer", () => {
    const t = Date.parse("2026-09-27T20:00:00Z");
    expect(noSalioEsConfiable({ fechaIntento: "2026-09-27", desdeMs: t, hastaMs: t + 60_000, ahoraMs: t + 120_000 })).toBe(true);
  });
  it("el intento cruzó la medianoche → NO (quedaría a medias, nunca re-emitible)", () => {
    expect(noSalioEsConfiable({ fechaIntento: "2026-09-27", desdeMs: antes, hastaMs: despues, ahoraMs: despues })).toBe(false);
  });
  it("se verifica al día siguiente → NO", () => {
    const t = Date.parse("2026-09-27T20:00:00Z");
    expect(noSalioEsConfiable({ fechaIntento: "2026-09-27", desdeMs: t, hastaMs: t, ahoraMs: Date.parse("2026-09-28T12:00:00Z") })).toBe(false);
  });
  it("la fecha del job no es la del intento (modal abierto ayer) → NO", () => {
    expect(noSalioEsConfiable({ fechaIntento: "2026-09-27", desdeMs: despues, hastaMs: despues, ahoraMs: despues })).toBe(false);
  });
});
