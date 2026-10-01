import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ops/events", () => ({ recordOpsError: vi.fn(async () => {}), recordOpsEvent: vi.fn(async () => {}) }));

// Auditoría 2026-10-01: un job que el usuario CANCELÓ mientras corría no puede
// revivir. markJobFailedOrRetryable y el vigilante (recoverStaleJobs) hacían UPDATE
// sin mirar el estado y dejaban el documento en "procesando".

type Fila = Record<string, unknown>;

/** Base falsa mínima: aplica los .eq() del UPDATE como lo haría PostgREST. */
function baseFalsa(jobs: Fila[], docs: Fila[]) {
  const tablas: Record<string, Fila[]> = { document_processing_jobs: jobs, documentos_subidos: docs };
  const from = (tabla: string) => {
    const filtros: Array<[string, unknown]> = [];
    let cambios: Fila | null = null;
    let lt: [string, string] | null = null;
    const coinciden = () => tablas[tabla].filter((f) => filtros.every(([k, v]) => f[k] === v) && (!lt || String(f[lt[0]]) < lt[1]));
    const aplicar = () => {
      const hit = coinciden();
      if (cambios) for (const f of hit) Object.assign(f, cambios);
      return hit;
    };
    const q = {
      select: () => q,
      update: (v: Fila) => { cambios = v; return q; },
      eq: (k: string, v: unknown) => { filtros.push([k, v]); return q; },
      lt: (k: string, v: string) => { lt = [k, v]; return q; },
      limit: () => q,
      maybeSingle: async () => { const hit = aplicar(); return { data: hit[0] ? { id: hit[0].id } : null, error: null }; },
      then: (ok: (r: { data: Fila[]; error: null }) => unknown) => Promise.resolve({ data: aplicar().map((f) => ({ ...f })), error: null }).then(ok),
    };
    return q;
  };
  return { from } as never;
}

const jobBase = { id: "job1", documento_id: "doc1", empresa_id: "e1", usuario_id: "u1", attempts: 0, max_attempts: 3, tipo: "excel" };

describe("markJobFailedOrRetryable no revive un job cancelado", () => {
  beforeEach(() => vi.clearAllMocks());

  it("job ya 'cancelled' → no lo pasa a retryable ni pone el documento en procesando", async () => {
    const { markJobFailedOrRetryable } = await import("./queue");
    const jobs = [{ ...jobBase, status: "cancelled" }];
    const docs = [{ id: "doc1", estado: "error", progreso_ia: { error: "Cancelado por el usuario" } }];
    await markJobFailedOrRetryable(baseFalsa(jobs, docs), jobBase as never, new Error("red caída"));
    expect(jobs[0].status).toBe("cancelled");
    expect(docs[0].estado).toBe("error");
    expect((docs[0].progreso_ia as Fila).error).toBe("Cancelado por el usuario");
  });

  it("job 'running' → retryable y documento en procesando (comportamiento normal)", async () => {
    const { markJobFailedOrRetryable } = await import("./queue");
    const jobs = [{ ...jobBase, status: "running" }];
    const docs = [{ id: "doc1", estado: "procesando" }];
    await markJobFailedOrRetryable(baseFalsa(jobs, docs), jobBase as never, new Error("red caída"));
    expect(jobs[0].status).toBe("retryable");
    expect(docs[0].estado).toBe("procesando");
  });
});

describe("recoverStaleJobs no revive un job cancelado entre el SELECT y el UPDATE", () => {
  it("si al UPDATE el job ya no está running, no lo toca ni toca el documento", async () => {
    const { recoverStaleJobs } = await import("./queue");
    const viejo = new Date("2026-10-01T00:00:00Z").toISOString();
    const jobs = [{ ...jobBase, status: "running", attempts: 2, locked_at: viejo }];
    const docs = [{ id: "doc1", estado: "procesando" }];
    const sb = baseFalsa(jobs, docs) as { from: (t: string) => unknown };
    // Carrera: el usuario cancela justo después del SELECT del vigilante.
    const fromOriginal = sb.from;
    let selectHecho = false;
    (sb as { from: (t: string) => unknown }).from = (t: string) => {
      const q = fromOriginal(t) as { update: (v: Fila) => unknown };
      if (t === "document_processing_jobs" && selectHecho) jobs[0].status = "cancelled";
      if (t === "document_processing_jobs") selectHecho = true;
      return q;
    };
    await recoverStaleJobs(sb as never, new Date("2026-10-01T12:00:00Z"), "worker-test");
    expect(jobs[0].status).toBe("cancelled");
    expect(docs[0].estado).toBe("procesando");
  });

  it("job atascado de verdad (sigue running) → failed y documento en error", async () => {
    const { recoverStaleJobs } = await import("./queue");
    const viejo = new Date("2026-10-01T00:00:00Z").toISOString();
    const jobs = [{ ...jobBase, status: "running", attempts: 2, locked_at: viejo }];
    const docs = [{ id: "doc1", estado: "procesando" }];
    await recoverStaleJobs(baseFalsa(jobs, docs), new Date("2026-10-01T12:00:00Z"), "worker-test");
    expect(jobs[0].status).toBe("failed");
    expect(docs[0].estado).toBe("error");
  });
});
