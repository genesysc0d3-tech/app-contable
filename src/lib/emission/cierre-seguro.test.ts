import { describe, expect, it } from "vitest";
import { deleteRespetaSinRespuesta, estadoCierreSeguro } from "./cierre-seguro";

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

describe("deleteRespetaSinRespuesta — la lápida sin respuesta no baja por DELETE", () => {
  const ahora = new Date("2026-09-28T18:00:00Z");
  const colgado = { estado: "running", propuesta_id: "p1", created_at: "2026-09-28T17:30:00Z", expires_at: "2026-09-28T17:45:00Z" };
  it("running vencido con propuesta + failed/cancelled → se deja (solo el veredicto la baja)", () => {
    expect(deleteRespetaSinRespuesta(colgado, "failed", ahora)).toBe(true);
    expect(deleteRespetaSinRespuesta(colgado, "cancelled", ahora)).toBe(true);
  });
  it("sellarla a medias sí se puede (más protección)", () => {
    expect(deleteRespetaSinRespuesta(colgado, "revision_pendiente", ahora)).toBe(false);
  });
  it("job vivo del lote → el cierre pre-emit normal sigue", () => {
    expect(deleteRespetaSinRespuesta({ ...colgado, expires_at: "2026-09-28T18:10:00Z" }, "failed", ahora)).toBe(false);
  });
  it("boleta única (sin propuesta) → sigue igual", () => {
    expect(deleteRespetaSinRespuesta({ ...colgado, propuesta_id: null }, "cancelled", ahora)).toBe(false);
  });
});
