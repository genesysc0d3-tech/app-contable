import { describe, it, expect } from "vitest";
import { requirePaidModel } from "./model-guard";

describe("requirePaidModel", () => {
  it("acepta modelos de pago (Go)", () => {
    expect(requirePaidModel("minimax-m3", "test")).toBe("minimax-m3");
    expect(requirePaidModel("deepseek-v4-flash", "test")).toBe("deepseek-v4-flash");
  });

  it("rechaza modelos -free (entrenan con los datos)", () => {
    expect(() => requirePaidModel("deepseek-v4-flash-free", "test")).toThrow(/GRATIS/);
    expect(() => requirePaidModel("mimo-v2.5-free", "test")).toThrow(/GRATIS/);
  });

  it("rechaza modelos gratis conocidos sin sufijo -free", () => {
    expect(() => requirePaidModel("big-pickle", "test")).toThrow(/GRATIS/);
  });

  it("rechaza modelo vacío", () => {
    expect(() => requirePaidModel("", "test")).toThrow(/VACIO/);
  });
});
