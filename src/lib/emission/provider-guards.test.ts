import { describe, expect, it } from "vitest";
import { batchBlockedResult, blockUnsupportedBackendProvider } from "./provider-guards";

describe("blockUnsupportedBackendProvider", () => {
  it("bloquea sii_local en backend: 409 y pide la extension e-Boleta", async () => {
    const res = blockUnsupportedBackendProvider("sii_local");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(409);
    const body = await res!.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("SII_LOCAL_REQUIERE_EXTENSION");
    expect(body.detalle).toContain("e-Boleta");
  });

  it("bloquea simpleapi en boletas: 501 SIMPLEAPI_PENDIENTE", async () => {
    const res = blockUnsupportedBackendProvider("simpleapi");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(501);
    const body = await res!.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("SIMPLEAPI_PENDIENTE");
  });

  it("no bloquea el proveedor mock (devuelve null)", () => {
    expect(blockUnsupportedBackendProvider("mock")).toBeNull();
  });
});

describe("batchBlockedResult", () => {
  it("sii_local devuelve el resultado batch con la propuesta y el codigo de extension", () => {
    const r = batchBlockedResult("sii_local", "prop-1");
    expect(r).toEqual({
      propuesta_id: "prop-1",
      ok: false,
      error_code: "SII_LOCAL_REQUIERE_EXTENSION",
      error_message: "La emisión SII local debe continuar en la ventana segura de e-Boleta.",
    });
  });

  it("simpleapi devuelve SIMPLEAPI_PENDIENTE con la propuesta", () => {
    const r = batchBlockedResult("simpleapi", "prop-2");
    expect(r).toMatchObject({ propuesta_id: "prop-2", ok: false, error_code: "SIMPLEAPI_PENDIENTE" });
  });

  it("mock no produce bloqueo batch (null)", () => {
    expect(batchBlockedResult("mock", "prop-3")).toBeNull();
  });
});
