import { describe, expect, it, vi } from "vitest";

// drain.ts lleva `import "server-only"` (Next lo resuelve solo en build) y sus
// bordes (queue con todo el pipeline, ops/events con supabase) no cargan en
// vitest — se mockean; el loop bajo test recibe processFn inyectado igual.
vi.mock("server-only", () => ({}));
vi.mock("./queue", () => ({ processDocumentQueue: vi.fn() }));
vi.mock("@/lib/ops/events", () => ({ recordOpsError: vi.fn() }));

import { drainDocumentQueue } from "./drain";

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
