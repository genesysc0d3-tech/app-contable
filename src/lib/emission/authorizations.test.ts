import { describe, expect, it, vi } from "vitest";

// `authorizations.ts` arranca con `import "server-only"`, que no resuelve fuera
// del runtime de Next. Lo stubbeamos para poder importar las funciones puras.
vi.mock("server-only", () => ({}));

const mod = await import("./authorizations");
const { cleanEmissionAuthorizationProvider, safeAuthorizationMetadata, CURRENT_EMISSION_AUTHORIZATION_VERSION } = mod;

describe("cleanEmissionAuthorizationProvider", () => {
  it("acepta solo los proveedores conocidos", () => {
    expect(cleanEmissionAuthorizationProvider("sii_local")).toBe("sii_local");
    expect(cleanEmissionAuthorizationProvider("simpleapi")).toBe("simpleapi");
  });

  it("rechaza cualquier otro valor con null", () => {
    expect(cleanEmissionAuthorizationProvider("mock")).toBeNull();
    expect(cleanEmissionAuthorizationProvider("")).toBeNull();
    expect(cleanEmissionAuthorizationProvider(null)).toBeNull();
    expect(cleanEmissionAuthorizationProvider(undefined)).toBeNull();
    expect(cleanEmissionAuthorizationProvider(42)).toBeNull();
    expect(cleanEmissionAuthorizationProvider("SII_LOCAL")).toBeNull(); // case-sensitive
  });
});

describe("safeAuthorizationMetadata — tipo_dte", () => {
  it("incluye tipo_dte solo si esta en la whitelist 33/34/39/41", () => {
    expect(safeAuthorizationMetadata({ tipo_dte: 33 })).toEqual({ tipo_dte: 33 });
    expect(safeAuthorizationMetadata({ tipo_dte: 39 })).toEqual({ tipo_dte: 39 });
    expect(safeAuthorizationMetadata({ tipo_dte: 41 })).toEqual({ tipo_dte: 41 });
    expect(safeAuthorizationMetadata({ tipo_dte: "34" })).toEqual({ tipo_dte: 34 }); // coercion numerica
  });

  it("descarta tipos fuera de la whitelist o no enteros", () => {
    expect(safeAuthorizationMetadata({ tipo_dte: 61 })).toEqual({});
    expect(safeAuthorizationMetadata({ tipo_dte: 99 })).toEqual({});
    expect(safeAuthorizationMetadata({ tipo_dte: 39.5 })).toEqual({});
    expect(safeAuthorizationMetadata({ tipo_dte: "abc" })).toEqual({});
  });
});

describe("safeAuthorizationMetadata — source y ui_context", () => {
  it("acepta strings que cumplen el patron [a-z0-9_:-]{1,48} y los recorta", () => {
    expect(safeAuthorizationMetadata({ source: "emision_directa" })).toEqual({ source: "emision_directa" });
    expect(safeAuthorizationMetadata({ source: "  ui:boton-1  " })).toEqual({ source: "ui:boton-1" });
    expect(safeAuthorizationMetadata({ ui_context: "mesa_v5" })).toEqual({ ui_context: "mesa_v5" });
  });

  it("descarta strings con espacios internos, caracteres invalidos o vacios", () => {
    expect(safeAuthorizationMetadata({ source: "con espacio" })).toEqual({});
    expect(safeAuthorizationMetadata({ source: "ñandu!" })).toEqual({});
    expect(safeAuthorizationMetadata({ source: "" })).toEqual({});
    expect(safeAuthorizationMetadata({ ui_context: "tiene espacio" })).toEqual({});
  });

  it("respeta el limite de 48 caracteres (48 ok, 49 fuera)", () => {
    const ok = "a".repeat(48);
    const tooLong = "a".repeat(49);
    expect(safeAuthorizationMetadata({ source: ok })).toEqual({ source: ok });
    expect(safeAuthorizationMetadata({ source: tooLong })).toEqual({});
  });

  it("combina campos validos e ignora claves desconocidas", () => {
    expect(safeAuthorizationMetadata({ tipo_dte: 39, source: "emision_directa", ui_context: "mesa", extra: "x" })).toEqual({
      tipo_dte: 39,
      source: "emision_directa",
      ui_context: "mesa",
    });
  });

  it("sin argumentos devuelve un objeto vacio", () => {
    expect(safeAuthorizationMetadata()).toEqual({});
    expect(safeAuthorizationMetadata({})).toEqual({});
  });
});

describe("CURRENT_EMISSION_AUTHORIZATION_VERSION", () => {
  it("es un string de version no vacio", () => {
    expect(typeof CURRENT_EMISSION_AUTHORIZATION_VERSION).toBe("string");
    expect(CURRENT_EMISSION_AUTHORIZATION_VERSION.length).toBeGreaterThan(0);
  });
});
