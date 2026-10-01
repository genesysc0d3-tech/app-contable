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
      maybeSingle: async () => { const hit = aplicar(); return { data: hit[0] ? { ...hit[0] } : null, error: null }; },
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

describe("lease del worker: uno viejo no marca fallido un job que otro re-tomó", () => {
  const tomaVieja = { locked_by: "worker:1", locked_at: "2026-10-01T10:00:00.000Z" };
  const tomaNueva = { locked_by: "worker:1", locked_at: "2026-10-01T10:30:00.000Z" }; // mismo pid, otra toma

  it("markJobFailedOrRetryable con lease vieja → no toca job ni documento", async () => {
    const { markJobFailedOrRetryable } = await import("./queue");
    const jobs = [{ ...jobBase, status: "running", ...tomaNueva }];
    const docs = [{ id: "doc1", estado: "procesando", progreso_ia: { estado: "queued_worker" } }];
    await markJobFailedOrRetryable(baseFalsa(jobs, docs), { ...jobBase, ...tomaVieja } as never, new Error("timeout"));
    expect(jobs[0].status).toBe("running");
    expect(jobs[0].locked_at).toBe(tomaNueva.locked_at);
    expect((docs[0].progreso_ia as Fila).estado).toBe("queued_worker");
  });

  it("markJobFailedDefinitivo con lease vieja → no toca job ni documento", async () => {
    const { markJobFailedDefinitivo } = await import("./queue");
    const jobs = [{ ...jobBase, status: "running", ...tomaNueva }];
    const docs = [{ id: "doc1", estado: "procesando" }];
    await markJobFailedDefinitivo(baseFalsa(jobs, docs), { ...jobBase, ...tomaVieja } as never, new Error("PDF con clave"));
    expect(jobs[0].status).toBe("running");
    expect(docs[0].estado).toBe("procesando");
  });

  it("markJobFailedDefinitivo sobre un job CANCELADO → conserva «Cancelado por el usuario»", async () => {
    const { markJobFailedDefinitivo } = await import("./queue");
    const jobs = [{ ...jobBase, status: "cancelled", locked_by: null, locked_at: null }];
    const docs = [{ id: "doc1", estado: "error", progreso_ia: { error: "Cancelado por el usuario" } }];
    await markJobFailedDefinitivo(baseFalsa(jobs, docs), { ...jobBase, ...tomaVieja } as never, new Error("PDF con clave"));
    expect(jobs[0].status).toBe("cancelled");
    expect((docs[0].progreso_ia as Fila).error).toBe("Cancelado por el usuario");
  });

  it("con su propia lease → falla normal (job failed, documento en error)", async () => {
    const { markJobFailedDefinitivo } = await import("./queue");
    const jobs = [{ ...jobBase, status: "running", ...tomaVieja }];
    const docs = [{ id: "doc1", estado: "procesando" }];
    await markJobFailedDefinitivo(baseFalsa(jobs, docs), { ...jobBase, ...tomaVieja } as never, new Error("PDF con clave"));
    expect(jobs[0].status).toBe("failed");
    expect(docs[0].estado).toBe("error");
  });
});

describe("lease también al completar y al ceder (yield)", () => {
  const tomaVieja = { locked_by: "worker:1", locked_at: "2026-10-01T10:00:00.000Z" };
  const tomaNueva = { locked_by: "worker:1", locked_at: "2026-10-01T10:30:00.000Z" };

  it("completarJob con lease vieja → false y el job sigue del worker nuevo", async () => {
    const { completarJob } = await import("./queue");
    const jobs = [{ ...jobBase, status: "running", ...tomaNueva }];
    expect(await completarJob(baseFalsa(jobs, []), { ...jobBase, ...tomaVieja } as never)).toBe(false);
    expect(jobs[0].status).toBe("running");
  });

  it("completarJob con su lease → completed", async () => {
    const { completarJob } = await import("./queue");
    const jobs = [{ ...jobBase, status: "running", ...tomaVieja }];
    expect(await completarJob(baseFalsa(jobs, []), { ...jobBase, ...tomaVieja } as never)).toBe(true);
    expect(jobs[0].status).toBe("completed");
  });

  it("no completado por lease perdida → el documento NO se marca «Cancelado por el usuario»", async () => {
    const { cerrarDocumentoNoCompletado } = await import("./queue");
    const jobs = [{ ...jobBase, status: "running", ...tomaNueva }];
    const docs = [{ id: "doc1", estado: "procesando" }];
    await cerrarDocumentoNoCompletado(baseFalsa(jobs, docs), { ...jobBase, ...tomaVieja } as never);
    expect(docs[0].estado).toBe("procesando");
  });

  it("no completado porque el usuario CANCELÓ → documento en error «Cancelado por el usuario»", async () => {
    const { cerrarDocumentoNoCompletado } = await import("./queue");
    const jobs = [{ ...jobBase, status: "cancelled", locked_by: null, locked_at: null }];
    const docs: Fila[] = [{ id: "doc1", estado: "procesando" }];
    await cerrarDocumentoNoCompletado(baseFalsa(jobs, docs), { ...jobBase, ...tomaVieja } as never);
    expect(docs[0].estado).toBe("error");
    expect((docs[0].progreso_ia as Fila).error).toBe("Cancelado por el usuario");
  });

  it("markJobYielded con lease vieja → no devuelve a la cola el job del worker nuevo", async () => {
    const { markJobYielded } = await import("./queue");
    const { ProcessorYieldError } = await import("@/lib/ai/processor");
    const jobs = [{ ...jobBase, status: "running", ...tomaNueva }];
    await markJobYielded(baseFalsa(jobs, []), { ...jobBase, ...tomaVieja } as never, new ProcessorYieldError(3, 10));
    expect(jobs[0].status).toBe("running");
    expect(jobs[0].locked_at).toBe(tomaNueva.locked_at);
  });

  it("markJobYielded con su lease → retryable", async () => {
    const { markJobYielded } = await import("./queue");
    const { ProcessorYieldError } = await import("@/lib/ai/processor");
    const jobs = [{ ...jobBase, status: "running", ...tomaVieja }];
    await markJobYielded(baseFalsa(jobs, []), { ...jobBase, ...tomaVieja } as never, new ProcessorYieldError(3, 10));
    expect(jobs[0].status).toBe("retryable");
  });
});
