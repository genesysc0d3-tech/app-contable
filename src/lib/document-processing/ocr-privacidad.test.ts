import { beforeEach, describe, expect, it, vi } from "vitest";

// Plan del flujo, PR 2/8 (revisión adversarial 2026-09-27): la imagen de un
// comprobante NO debe viajar como base64 dentro de ocr_jobs. La cola le pasa al
// OCR la ruta de almacenamiento para que la mini la baje con URL firmada, y las
// filas huérfanas (función muerta a mitad del sondeo) se borran.
vi.mock("server-only", () => ({}));
const ocrLlamadas: Array<{ imgs: Array<Record<string, unknown>>; opts: Record<string, unknown> | undefined }> = [];
vi.mock("@/lib/ai/ocr", () => ({
  ocrAndGroupImages: async (imgs: Array<Record<string, unknown>>, opts?: Record<string, unknown>) => {
    ocrLlamadas.push({ imgs, opts });
    return { groupedText: "texto", totalTokensInput: 0, totalTokensOutput: 0 };
  },
}));
vi.mock("@/lib/storage", () => ({ descargarDocumento: async () => Buffer.from("imagen") }));

beforeEach(() => { ocrLlamadas.length = 0; });
const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { storage_provider: "r2" }, error: null }) };
const SB = { from: () => q } as never;

describe("la cola le pasa la RUTA de la imagen al OCR, no solo los bytes", () => {
  it("imagen suelta", async () => {
    const { extractContentFromJob } = await import("./queue");
    await extractContentFromJob(SB, {
      id: "j", documento_id: "d", empresa_id: "e", tipo: "imagen", storage_path: "e/doc/foto.jpg", metadata: {},
    } as never);
    expect(ocrLlamadas[0].imgs[0].storagePath).toBe("e/doc/foto.jpg");
    expect(ocrLlamadas[0].imgs[0].storageProvider).toBe("r2");
    expect((ocrLlamadas[0].opts?.contexto as Record<string, unknown>)?.documentoId).toBe("d");
  });

  it("álbum (grouped_images)", async () => {
    const { extractContentFromJob } = await import("./queue");
    await extractContentFromJob(SB, {
      id: "j", documento_id: "d", empresa_id: "e", tipo: "imagen", storage_path: "e/1.jpg",
      metadata: { origen: "telegram", grouped_images: [{ path: "e/1.jpg" }, { path: "e/2.jpg" }] },
    } as never);
    expect(ocrLlamadas[0].imgs.map((i) => i.storagePath)).toEqual(["e/1.jpg", "e/2.jpg"]);
  });
});
