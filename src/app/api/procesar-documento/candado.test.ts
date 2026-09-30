/**
 * Doble candado 2026-09-30 — reprocesar borra lo previo del documento. Con
 * emitidas o lápidas se frena ANTES de encolar (antes llegaba al worker y dejaba
 * el documento en 'error'). Si no se puede revisar: 503 y no se encola.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Resp = { data?: unknown; error: { message: string } | null; count?: number | null };

const { estado } = vi.hoisted(() => ({
  estado: {
    resp: ((): Resp => ({ data: [], error: null })) as (tabla: string) => Resp,
    enqueue: vi.fn(async () => ({ id: "J1", status: "queued" })),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: vi.fn() };
});
vi.mock("@/lib/dev/support-mode", () => ({ getDevSupportWriteBlock: async () => null }));
vi.mock("@/lib/security/rate-limit", () => ({ rateLimitKey: () => "k" }));
vi.mock("@/lib/security/rate-limit-global", () => ({ enforceRateLimitGlobal: async () => null }));
vi.mock("@/lib/document-processing/abuse-guard", () => ({ verificarTopeDiarioIa: async () => ({ ok: true }), respuestaTopeIa: () => ({}) }));
vi.mock("@/lib/document-processing/queue", () => ({ enqueueDocumentProcessingJob: estado.enqueue }));
vi.mock("@/lib/document-processing/auto-drenaje", () => ({ iniciarDrenaje: vi.fn() }));
vi.mock("@/lib/ops/events", () => ({ recordOpsError: vi.fn(), recordOpsEvent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "U1" } } }) },
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = { select: () => q, eq: () => q };
      q.single = async () =>
        tabla === "usuarios"
          ? { data: { empresa_id: "E1", rol: "owner" } }
          : { data: { id: "D1", empresa_id: "E1", storage_path: "cartolas/a.xlsx", tipo: "cartola", estado: "procesado" } };
      return q;
    },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      for (const m of ["select", "eq", "neq", "in", "update"]) q[m] = () => q;
      q.then = (ok: (v: Resp) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(estado.resp(tabla)).then(ok, ko);
      return q;
    },
  }),
}));

import { POST } from "./route";

const req = () => new Request("http://x/api/procesar-documento", { method: "POST", body: JSON.stringify({ documento_id: "D1" }) });
function escenario(over: Partial<Record<string, Resp>>) {
  estado.resp = (tabla) =>
    over[tabla] ??
    (tabla === "movimientos_raw" ? { data: [{ id: "m1" }], error: null }
      : tabla === "propuestas_ia" ? { data: [{ id: "p1" }], error: null }
      : tabla === "boletas_emitidas" || tabla === "emision_jobs" ? { count: 0, error: null }
      : { data: [], error: null });
}

beforeEach(() => {
  estado.enqueue.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
});

describe("procesar-documento — candado antes de encolar", () => {
  it("con boleta emitida → 409 y no encola", async () => {
    escenario({ boletas_emitidas: { count: 1, error: null } });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(estado.enqueue).not.toHaveBeenCalled();
  });

  it("con lápida → 409 y no encola", async () => {
    escenario({ emision_jobs: { count: 1, error: null } });
    expect((await POST(req())).status).toBe(409);
    expect(estado.enqueue).not.toHaveBeenCalled();
  });

  it("★ si no se puede revisar → 503 y no encola", async () => {
    escenario({ emision_jobs: { count: null, error: { message: "boom" } } });
    expect((await POST(req())).status).toBe(503);
    escenario({ movimientos_raw: { data: null, error: { message: "boom" } } });
    expect((await POST(req())).status).toBe(503);
    expect(estado.enqueue).not.toHaveBeenCalled();
  });

  it("sin emitidas → encola", async () => {
    escenario({});
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(estado.enqueue).toHaveBeenCalledTimes(1);
  });
});
