import { describe, expect, it } from "vitest";
import { isoAHoraChile, horaChileAIso } from "./fechas";

// El formulario de /dev trabaja en hora de Chile SIEMPRE (no la del navegador ni
// la del server): mismo texto en SSR y en el cliente, y lo que escribe el operador
// es lo que ve la clienta.
describe("hora de Chile ↔ ISO", () => {
  it("invierno (UTC-4) y verano (UTC-3)", () => {
    expect(isoAHoraChile("2026-07-01T16:00:00.000Z")).toBe("2026-07-01T12:00");
    expect(isoAHoraChile("2026-12-01T15:00:00.000Z")).toBe("2026-12-01T12:00");
    expect(horaChileAIso("2026-07-01T12:00")).toBe("2026-07-01T16:00:00.000Z");
    expect(horaChileAIso("2026-12-01T12:00")).toBe("2026-12-01T15:00:00.000Z");
  });
  it("ida y vuelta, y basura = vacío", () => {
    const iso = "2026-10-01T18:30:00.000Z";
    expect(horaChileAIso(isoAHoraChile(iso))).toBe(iso);
    expect(horaChileAIso("")).toBe("");
    expect(isoAHoraChile("nada")).toBe("");
  });
});
