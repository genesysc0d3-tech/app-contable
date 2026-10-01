import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deleteRespetaSinRespuesta, estadoCierreSeguro } from "./cierre-seguro";

describe("estadoCierreSeguro — nunca cancelled con propuesta", () => {
  it("job del lote (con propuesta) pedido cancelled → lápida revision_pendiente", () => {
    expect(estadoCierreSeguro("cancelled", { propuesta_id: "p1" })).toBe("revision_pendiente");
  });
  it("boleta única (sin propuesta) → cancelled como siempre", () => {
    expect(estadoCierreSeguro("cancelled", { propuesta_id: null })).toBe("cancelled");
  });
  it("boleta única que YA pudo apretar EMITIR (último status post-clic) → lápida, no cancelled (auditoría oct-2026 #2)", () => {
    const creado = "2026-10-01T12:00:00Z";
    for (const st of ["submitting", "capturing_result", "result_awaiting_ack", "result_needs_review"]) {
      expect(estadoCierreSeguro("cancelled", { propuesta_id: null, estado_visible: st, created_at: creado })).toBe("revision_pendiente");
    }
  });
  it("boleta única que nunca llegó al clic (opening_sii, sii_page_ready, cancelled de la extensión) → cancelled libre", () => {
    const creado = "2026-10-01T12:00:00Z";
    for (const st of ["opening_sii", "sii_page_ready", "waiting_sii_login", "cancelled", "running", null]) {
      expect(estadoCierreSeguro("cancelled", { propuesta_id: null, estado_visible: st, created_at: creado })).toBe("cancelled");
    }
    // failed (pre-emit seguro de la extensión) no se toca.
    expect(estadoCierreSeguro("failed", { propuesta_id: null, estado_visible: "submitting", created_at: creado })).toBe("failed");
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

describe("cableado del DELETE de /api/emision/jobs (auditoría oct-2026 #2)", () => {
  // Estático: sin `estado_visible` en el SELECT, estadoCierreSeguro no ve el clic y
  // un «liberar candado» volvería a cancelar una boleta única ya disparada.
  const src = readFileSync(join(__dirname, "../../app/api/emision/jobs/route.ts"), "utf8");
  it("el SELECT del job trae estado_visible y created_at antes de decidir el cierre", () => {
    const del = src.indexOf("export async function DELETE(");
    const sel = src.indexOf(".select(\"job_id, cuenta_id, empresa_id, usuario_id, estado, estado_visible, provider, propuesta_id, created_at, expires_at\")", del);
    const decide = src.indexOf("estadoCierreSeguro(pedido, job)", del);
    expect(sel).toBeGreaterThan(del);
    expect(decide).toBeGreaterThan(sel);
  });
  it("PATCH: post-clic en el UPDATE principal (una query) y el condicional solo para pre-clic (vuelta 2, B1)", () => {
    const patch = src.indexOf("export async function PATCH(");
    const principal = src.indexOf("...estadoVisibleEnLatidoPrincipal(estado) })", patch);
    const condicional = src.indexOf("await marcarEstadoVisibleLatido(service.service, job.job_id, estado)", patch);
    expect(principal).toBeGreaterThan(patch);
    expect(condicional).toBeGreaterThan(principal);
    expect(src.slice(principal, condicional)).toContain("estadoVisibleEnLatidoPrincipal(estado).estado_visible");
  });
});

