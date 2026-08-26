/**
 * El contrato que importa del carril local: NUNCA puede dejar sin OCR a nadie.
 *
 * El mini es una optimización de privacidad y costo, no una dependencia. Si está
 * apagado, no responde, devuelve basura o revienta, `ocrConMini` tiene que
 * devolver `null` para que el llamador siga por el proveedor remoto. Estos tests
 * cubren cada forma de fallar, porque el modo de falla es justo lo que decide si
 * esto se puede encender en producción.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const filas = new Map<string, { estado: string; resultado: unknown }>();
let insertFalla = false;
let seq = 0;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => {
            if (insertFalla) return { data: null, error: { message: "boom" } };
            const id = `job-${++seq}`;
            filas.set(id, { estado: "pendiente", resultado: null });
            return { data: { id }, error: null };
          },
        }),
      }),
      select: () => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => ({ data: filas.get(id) ?? null, error: null }),
        }),
      }),
      delete: () => ({
        eq: (_c: string, id: string) => {
          filas.delete(id);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

vi.mock("../r2", () => ({
  isR2Configured: () => false,
  r2SignedGetUrl: async () => "https://ejemplo/firmada",
}));

import { ocrConMini, ocrMiniHabilitado } from "./ocr-mini";

const ARGS = { base64: "AAAA", mimeType: "image/jpeg" };

/** Deja el job en un estado final, como haría el worker del mini. */
function resolverJob(estado: string, resultado: unknown, tras = 10) {
  setTimeout(() => {
    for (const [id, f] of filas) if (f.estado === "pendiente") filas.set(id, { estado, resultado });
  }, tras);
}

describe("ocrConMini", () => {
  beforeEach(() => {
    filas.clear();
    insertFalla = false;
    seq = 0;
    process.env.OCR_MINI_ENABLED = "1";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    process.env.OCR_MINI_TIMEOUT_MS = "1500";
  });
  afterEach(() => {
    delete process.env.OCR_MINI_ENABLED;
    delete process.env.OCR_MINI_TIMEOUT_MS;
  });

  it("apagado por defecto: sin la env no se usa el mini", () => {
    delete process.env.OCR_MINI_ENABLED;
    expect(ocrMiniHabilitado()).toBe(false);
  });

  it("devuelve el texto cuando el mini responde", async () => {
    resolverJob("listo", { text: "RUT  16.482.913-4" });
    const r = await ocrConMini(ARGS);
    expect(r?.text).toContain("16.482.913-4");
  });

  it("borra la fila al terminar (no deja un silo de datos de terceros)", async () => {
    resolverJob("listo", { text: "algo" });
    await ocrConMini(ARGS);
    expect(filas.size).toBe(0);
  });

  it("cae al remoto si el mini marca error", async () => {
    resolverJob("error", null);
    expect(await ocrConMini(ARGS)).toBeNull();
  });

  it("cae al remoto si el mini no contesta a tiempo", async () => {
    // Nadie resuelve el job: debe rendirse solo, no colgarse.
    expect(await ocrConMini({ ...ARGS, timeoutMs: 600 })).toBeNull();
  });

  it("cae al remoto si el texto viene vacío", async () => {
    resolverJob("listo", { text: "   " });
    expect(await ocrConMini(ARGS)).toBeNull();
  });

  it("cae al remoto si el resultado viene malformado", async () => {
    resolverJob("listo", { texto_mal: 123 });
    expect(await ocrConMini(ARGS)).toBeNull();
  });

  it("cae al remoto si no se pudo ni encolar", async () => {
    insertFalla = true;
    expect(await ocrConMini(ARGS)).toBeNull();
  });

  it("con el carril apagado ni siquiera encola", async () => {
    process.env.OCR_MINI_ENABLED = "0";
    expect(await ocrConMini(ARGS)).toBeNull();
    expect(filas.size).toBe(0);
  });

  it("sin credenciales de servicio no revienta, cae al remoto", async () => {
    const guardado = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(await ocrConMini(ARGS)).toBeNull();
    process.env.SUPABASE_SERVICE_ROLE_KEY = guardado;
  });
});
