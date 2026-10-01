import { describe, expect, it } from "vitest";
import { MARGEN_POPUP_TRAS_LIBERAR_MS, motivoEsperaAviso } from "./espera";

// M2: además del momento seguro general (emisión, subida, popup/modal abierto,
// alguien escribiendo), el popup urgente espera las escrituras en vuelo, un margen
// tras soltarse un bloqueo (el resultado de la emisión se lee en paz) y a que no
// haya un toast de la app a la vista.

const libre = { base: null, escriturasEnVuelo: 0, msDesdeLiberacion: Infinity, toastDeLaApp: false };

describe("motivoEsperaAviso", () => {
  it("el motivo general manda para todos", () => {
    expect(motivoEsperaAviso("toast", { ...libre, base: "subida" })).toBe("subida");
    expect(motivoEsperaAviso("tarjeta", { ...libre, base: "popup_abierto" })).toBe("popup_abierto");
    expect(motivoEsperaAviso("popup", { ...libre, base: "emision_lote" })).toBe("emision_lote");
  });
  it("popup: espera escrituras en vuelo, margen tras liberar y el toast del resultado", () => {
    expect(motivoEsperaAviso("popup", { ...libre, escriturasEnVuelo: 1 })).toBe("pedido_en_vuelo");
    expect(motivoEsperaAviso("popup", { ...libre, msDesdeLiberacion: 2_000 })).toBe("margen_tras_liberar");
    expect(motivoEsperaAviso("popup", { ...libre, msDesdeLiberacion: MARGEN_POPUP_TRAS_LIBERAR_MS })).toBe(null);
    expect(motivoEsperaAviso("popup", { ...libre, toastDeLaApp: true })).toBe("toast_de_la_app");
    expect(motivoEsperaAviso("popup", libre)).toBe(null);
  });
  it("toast/tarjeta no esperan el margen ni las escrituras (no tapan nada: van bajo los modales)", () => {
    expect(motivoEsperaAviso("toast", { ...libre, msDesdeLiberacion: 1_000, escriturasEnVuelo: 2 })).toBe(null);
    expect(motivoEsperaAviso("tarjeta", { ...libre, msDesdeLiberacion: 1_000, escriturasEnVuelo: 2, toastDeLaApp: true })).toBe(null);
  });
  it("N3: el toast de aviso espera si hay un toast de la app a la vista (no se superponen)", () => {
    expect(motivoEsperaAviso("toast", { ...libre, toastDeLaApp: true })).toBe("toast_de_la_app");
  });
  it("margen entre 10 y 15 s", () => {
    expect(MARGEN_POPUP_TRAS_LIBERAR_MS).toBeGreaterThanOrEqual(10_000);
    expect(MARGEN_POPUP_TRAS_LIBERAR_MS).toBeLessThanOrEqual(15_000);
  });
});
