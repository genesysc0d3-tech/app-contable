import { describe, expect, it } from "vitest";
import { estadoCierreSeguro } from "./cierre-seguro";

describe("estadoCierreSeguro — nunca cancelled con propuesta", () => {
  it("job del lote (con propuesta) pedido cancelled → lápida revision_pendiente", () => {
    expect(estadoCierreSeguro("cancelled", { propuesta_id: "p1" })).toBe("revision_pendiente");
  });
  it("boleta única (sin propuesta) → cancelled como siempre", () => {
    expect(estadoCierreSeguro("cancelled", { propuesta_id: null })).toBe("cancelled");
  });
  it("failed y revision_pendiente pasan igual", () => {
    expect(estadoCierreSeguro("failed", { propuesta_id: "p1" })).toBe("failed");
    expect(estadoCierreSeguro("revision_pendiente", { propuesta_id: "p1" })).toBe("revision_pendiente");
  });
});
