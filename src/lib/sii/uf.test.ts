import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UF_REFERENCIA_CLP, UMBRAL_IDENTIFICACION_UF } from "./validation";

// El módulo cachea en memoria — se re-importa fresco en cada test.
async function freshUf() {
  vi.resetModules();
  return await import("./uf");
}

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.unstubAllGlobals());

describe("getUfClp — UF del día con fallback", () => {
  it("usa el valor de mindicador.cl cuando responde bien", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ serie: [{ fecha: "2026-06-12", valor: 40_771.41 }] }),
    }));
    const { getUfClp, getUmbralIdentificacionClp } = await freshUf();
    expect(await getUfClp()).toBe(40_771.41);
    expect(await getUmbralIdentificacionClp()).toBe(Math.round(135 * 40_771.41));
  });

  it("cae a la constante referencial si la API falla", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { getUfClp } = await freshUf();
    expect(await getUfClp()).toBe(UF_REFERENCIA_CLP);
  });

  it("rechaza valores absurdos de la API (sanity bounds)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ serie: [{ valor: 3 }] }), // basura
    }));
    const { getUmbralIdentificacionClp } = await freshUf();
    expect(await getUmbralIdentificacionClp()).toBe(UMBRAL_IDENTIFICACION_UF * UF_REFERENCIA_CLP);
  });

  it("cachea: una sola llamada a la API para lecturas repetidas", async () => {
    const mock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ serie: [{ valor: 40_500 }] }),
    });
    vi.stubGlobal("fetch", mock);
    const { getUfClp } = await freshUf();
    await getUfClp();
    await getUfClp();
    await getUfClp();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
