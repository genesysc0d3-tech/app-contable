import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

// Bug (revisión adversarial 2026-09-27): reprocesar desde la app un documento
// que llegó por Telegram mandaba metadata {} y, con force, pisaba la del job:
// se perdía origen:"telegram" y las imágenes del álbum → IA directo, 1 imagen.
describe("reproceso conserva la metadata del documento", () => {
  it("un álbum de Telegram reprocesado desde la app sigue siendo Telegram y conserva sus imágenes", async () => {
    const { enqueueDocumentProcessingJob } = await import("./queue");
    const anterior = {
      origen: "telegram", album: true, mesa: "boleta", chat_id: 12345,
      grouped_images: [{ path: "e/1.jpg" }, { path: "e/2.jpg" }, { path: "e/3.jpg" }],
    };
    let actualizado: Record<string, unknown> | null = null;
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: { id: "job1", status: "completed", metadata: anterior }, error: null }),
      update: (v: Record<string, unknown>) => { actualizado = v; return q; },
      single: async () => ({ data: { id: "job1", status: "queued", metadata: actualizado?.metadata }, error: null }),
    };
    const sb = { from: () => q } as never;
    await enqueueDocumentProcessingJob(sb, {
      documentoId: "doc1", empresaId: "emp1", tipo: "imagen", storagePath: "e/1.jpg", metadata: {}, force: true,
    } as never);
    const meta = actualizado!.metadata as Record<string, unknown>;
    expect(meta.origen).toBe("telegram");
    expect((meta.grouped_images as unknown[]).length).toBe(3);
    expect(meta.mesa).toBe("boleta");
    expect(meta.chat_id).toBeUndefined(); // no se le vuelve a escribir por Telegram
  });

  it("la metadata nueva gana sobre la anterior", async () => {
    const { metadataDeReproceso } = await import("./queue");
    expect(metadataDeReproceso({ origen: "telegram", mesa: "boleta" }, { mesa: "factura" })).toEqual({ origen: "telegram", mesa: "factura" });
    expect(metadataDeReproceso(null, { grouped_images: [1] })).toEqual({ grouped_images: [1] });
  });
});
