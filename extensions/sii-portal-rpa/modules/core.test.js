import { describe, expect, it } from "vitest";
import { EXTENSION_VERSION, versionBajoObjetivo } from "./core.js";

describe("versionBajoObjetivo (gatillo del auto-update)", () => {
  it("detecta la brecha real y compara numéricamente, no como texto", () => {
    expect(versionBajoObjetivo("0.1.5", "0.1.6")).toBe(true);
    expect(versionBajoObjetivo("0.1.9", "0.1.10")).toBe(true); // como string "0.1.9" > "0.1.10"
    expect(versionBajoObjetivo("0.1.6", "0.1.6")).toBe(false);
    expect(versionBajoObjetivo("0.2.0", "0.1.9")).toBe(false);
  });

  it("sin dato o con dato raro NO gatilla (la meta es no llamar a Google de más)", () => {
    expect(versionBajoObjetivo(EXTENSION_VERSION, undefined)).toBe(false);
    expect(versionBajoObjetivo(EXTENSION_VERSION, null)).toBe(false);
    expect(versionBajoObjetivo(EXTENSION_VERSION, "")).toBe(false);
    expect(versionBajoObjetivo(EXTENSION_VERSION, "abc")).toBe(false);
    expect(versionBajoObjetivo(undefined, "9.9.9")).toBe(false);
  });

  it("la versión propia contra sí misma nunca gatilla (estado estable = silencio)", () => {
    expect(versionBajoObjetivo(EXTENSION_VERSION, EXTENSION_VERSION)).toBe(false);
  });
});
