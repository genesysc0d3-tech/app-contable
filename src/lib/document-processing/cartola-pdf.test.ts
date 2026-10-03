import { describe, expect, it } from "vitest";
import { leerCartolaPdf, type EventoRutaPdf } from "./cartola-pdf";

describe("cola: paso cartola PDF (fail-safe)", () => {
  it("si el lector lanza, devuelve null (sigue el flujo de texto) y registra pdf_ruta tipo «error»", async () => {
    const eventos: EventoRutaPdf[] = [];
    const r = await leerCartolaPdf({
      pdf: new Uint8Array([1, 2, 3]), documento_id: "d", empresa_id: "e",
      parse: async () => { throw new Error("pdf roto"); },
      registrar: async (e) => { eventos.push(e); },
    });
    expect(r).toBeNull();
    expect(eventos).toHaveLength(1);
    expect(eventos[0].metadata).toMatchObject({ tipo: "error", al_lector: false });
  });
  it("si registrar el evento falla, la subida sigue igual", async () => {
    const r = await leerCartolaPdf({
      pdf: new Uint8Array([1]), documento_id: "d", empresa_id: "e",
      parse: async (_p, o) => { o.diagnostico({ tipo: "factura", motivo: "senal_dte", senales: ["dte"], paginas: 1, ms: 3 }); return null; },
      registrar: async () => { throw new Error("ops caído"); },
    });
    expect(r).toBeNull();
  });
  it("un PDF basura de verdad hace lanzar al lector (y el paso lo absorbe)", async () => {
    const { parsePdfCartola } = await import("@/lib/parsers");
    await expect(parsePdfCartola(new Uint8Array([1, 2, 3]))).rejects.toBeTruthy();
    const eventos: EventoRutaPdf[] = [];
    expect(await leerCartolaPdf({ pdf: new Uint8Array([1, 2, 3]), documento_id: "d", empresa_id: "e", parse: parsePdfCartola, registrar: async (e) => { eventos.push(e); } })).toBeNull();
    expect(eventos[0].metadata.tipo).toBe("error");
  });
});
