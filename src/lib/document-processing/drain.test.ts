import { describe, expect, it, vi } from "vitest";

// drain.ts lleva `import "server-only"` (Next lo resuelve solo en build) y sus
// bordes (queue con todo el pipeline, ops/events con supabase) no cargan en
// vitest — se mockean; el loop bajo test recibe processFn inyectado igual.
vi.mock("server-only", () => ({}));
vi.mock("./queue", () => ({ processDocumentQueue: vi.fn(), msHastaProximoJobPendiente: vi.fn(async () => null) }));
vi.mock("@/lib/ops/events", () => ({ recordOpsError: vi.fn() }));

import { drainDocumentQueue, drainAndChain } from "./drain";

type QueueResult = {
  ok: boolean; recovered: number; claimed: number; completed: number;
  yielded: number; failed_or_retryable: number; results: unknown[];
};

function res(partial: Partial<QueueResult>): QueueResult {
  return {
    ok: true,
    recovered: 0,
    claimed: 0,
    completed: 0,
    yielded: 0,
    failed_or_retryable: 0,
    results: [],
    ...partial,
  } as QueueResult;
}

describe("drainDocumentQueue — loop con presupuesto", () => {
  it("procesa de a 1 hasta que la cola queda vacía (claimed 0)", async () => {
    const processFn = vi
      .fn()
      .mockResolvedValueOnce(res({ claimed: 1, completed: 1 }))
      .mockResolvedValueOnce(res({ claimed: 1, completed: 1 }))
      .mockResolvedValueOnce(res({ claimed: 0 }));
    const r = await drainDocumentQueue({ processFn, budgetMs: 60_000 });
    expect(processFn).toHaveBeenCalledTimes(3);
    expect(r.rondas).toBe(3);
    expect(r.completados).toBe(2);
    expect(r.presupuestoAgotado).toBe(false);
  });

  it("un yield reclama el mismo job de nuevo (next_run = ahora) y sigue avanzando", async () => {
    const processFn = vi
      .fn()
      .mockResolvedValueOnce(res({ claimed: 1, yielded: 1 }))
      .mockResolvedValueOnce(res({ claimed: 1, completed: 1 }))
      .mockResolvedValueOnce(res({ claimed: 0 }));
    const r = await drainDocumentQueue({ processFn, budgetMs: 60_000 });
    expect(r.yields).toBe(1);
    expect(r.completados).toBe(1);
    expect(r.rondas).toBe(3);
  });

  it("corta por presupuesto y lo reporta (para que el caller encadene)", async () => {
    const processFn = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return res({ claimed: 1, completed: 1 });
    });
    const r = await drainDocumentQueue({ processFn, budgetMs: 50 });
    expect(r.presupuestoAgotado).toBe(true);
    expect(r.rondas).toBeGreaterThanOrEqual(1);
    expect(r.rondas).toBeLessThan(10);
  });

  it("acumula fallidos y recuperados del watchdog", async () => {
    const processFn = vi
      .fn()
      .mockResolvedValueOnce(res({ recovered: 1, claimed: 1, failed_or_retryable: 1 }))
      .mockResolvedValueOnce(res({ claimed: 0 }));
    const r = await drainDocumentQueue({ processFn, budgetMs: 60_000 });
    expect(r.recuperados).toBe(1);
    expect(r.fallidos).toBe(1);
  });
});

describe("drainAndChain — la cadena no muere con backoffs futuros (incidente 2026-08-22)", () => {
  function withKitchen() {
    process.env.CRON_SECRET = "test-secret";
    const kicks: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      kicks.push(JSON.parse(String(init?.body ?? "{}")).depth);
      return { ok: true } as Response;
    }));
    return kicks;
  }

  it("cola 'vacía' pero con reintento en backoff cercano: espera y encadena", async () => {
    const kicks = withKitchen();
    const processFn = vi.fn().mockResolvedValue(res({ claimed: 0 }));
    const probeFn = vi.fn(async () => 10); // reintento vence en 10ms
    const r = await drainAndChain({ lockOwner: "t", processFn, budgetMs: 1000, probeFn });
    expect(probeFn).toHaveBeenCalled();
    expect(r.encadenado).toBe(true);
    expect(kicks.length).toBe(1);
  });

  it("cola vacía de verdad (sin pendientes): NO encadena", async () => {
    const kicks = withKitchen();
    const processFn = vi.fn().mockResolvedValue(res({ claimed: 0 }));
    const probeFn = vi.fn(async () => null);
    const r = await drainAndChain({ lockOwner: "t", processFn, budgetMs: 1000, probeFn });
    expect(r.encadenado).toBe(false);
    expect(kicks.length).toBe(0);
  });

  it("con progreso real la profundidad se RESETEA (cartola grande no muere por depth)", async () => {
    const kicks = withKitchen();
    const processFn = vi
      .fn()
      .mockResolvedValueOnce(res({ claimed: 1, yielded: 1 }))
      .mockResolvedValue(res({ claimed: 0 }));
    await drainAndChain({ lockOwner: "t", depth: 39, processFn, budgetMs: 1000, probeFn: async () => null });
    expect(kicks).toEqual([1]); // progresó → siguiente eslabón parte en 1, no en 40
  });

  it("sin progreso la profundidad acumula (corta loops degenerados)", async () => {
    const kicks = withKitchen();
    const processFn = vi.fn().mockResolvedValue(res({ claimed: 0 }));
    await drainAndChain({ lockOwner: "t", depth: 5, processFn, budgetMs: 1000, probeFn: async () => 0 });
    expect(kicks).toEqual([6]);
  });
});
