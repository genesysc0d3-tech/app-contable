import { describe, it, expect } from "vitest";
import { guardTipoDteEmisor } from "./tipo-dte-emisor-guard";

describe("guardTipoDteEmisor — exento no puede emitir afecta (39)", () => {
  it("exento + afecta (39) → rechaza", () => {
    expect(guardTipoDteEmisor(39, "exento")).toEqual({ ok: false, code: "EMISOR_EXENTO_NO_AFECTA" });
  });

  it("exento + exenta (41) → pasa", () => {
    expect(guardTipoDteEmisor(41, "exento")).toEqual({ ok: true });
  });

  it("afecto + afecta (39) → pasa", () => {
    expect(guardTipoDteEmisor(39, "afecto")).toEqual({ ok: true });
  });

  it("auto NO es exento → afecta pasa", () => {
    expect(guardTipoDteEmisor(39, "auto")).toEqual({ ok: true });
  });

  it("null/vacío → pasa (no bloquea sin dato explícito de exención)", () => {
    expect(guardTipoDteEmisor(39, null)).toEqual({ ok: true });
    expect(guardTipoDteEmisor(39, undefined)).toEqual({ ok: true });
    expect(guardTipoDteEmisor(39, "   ")).toEqual({ ok: true });
  });

  it("normaliza mayúsculas/espacios", () => {
    expect(guardTipoDteEmisor(39, "  EXENTO ")).toEqual({ ok: false, code: "EMISOR_EXENTO_NO_AFECTA" });
    expect(guardTipoDteEmisor(41, "Exento")).toEqual({ ok: true });
  });
});
