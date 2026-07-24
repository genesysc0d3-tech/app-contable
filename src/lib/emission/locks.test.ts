import { describe, expect, it, vi } from "vitest";
import { acquireCuentaEmissionLock, releaseCuentaEmissionLock } from "./locks";

vi.mock("@/lib/emission/folio-reservas", () => ({
  finalizeFolioReservaForJob: vi.fn(async () => ({ ok: true })),
}));

type Row = Record<string, unknown>;
type Filter = { op: "eq" | "lt" | "in"; column: string; value: unknown };

class QueryBuilder {
  private filters: Filter[] = [];

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
    private readonly op: "delete" | "update" | "select",
    private readonly payload?: Row,
  ) {}

  eq(column: string, value: unknown) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ op: "lt", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ op: "in", column, value });
    return this;
  }

  select(_columns?: string) {
    return this;
  }

  private run(): Row[] {
    const affected: Row[] = [];
    if (this.table === "emision_locks" && this.op === "delete") {
      for (const [cuentaId, row] of this.db.locks.entries()) {
        if (matches(row, this.filters)) this.db.locks.delete(cuentaId);
      }
    }
    if (this.table === "emision_jobs" && this.op === "update") {
      for (const [jobId, row] of this.db.jobs.entries()) {
        if (matches(row, this.filters)) {
          const next = { ...row, ...this.payload };
          this.db.jobs.set(jobId, next);
          affected.push(next);
        }
      }
    }
    if (this.table === "emision_jobs" && this.op === "select") {
      for (const [, row] of this.db.jobs.entries()) {
        if (matches(row, this.filters)) affected.push(row);
      }
    }
    return affected;
  }

  async maybeSingle() {
    return { data: this.run()[0] ?? null, error: null };
  }

  then(resolve: (value: { error: null }) => void) {
    this.run();
    resolve({ error: null });
  }
}

class FakeSupabase {
  jobs = new Map<string, Row>();
  locks = new Map<string, Row>();

  from(table: string) {
    return {
      insert: async (row: Row) => {
        if (table === "emision_jobs") {
          this.jobs.set(String(row.job_id), row);
          return { error: null };
        }
        if (table === "emision_locks") {
          const cuentaId = String(row.cuenta_id);
          if (this.locks.has(cuentaId)) {
            return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          this.locks.set(cuentaId, row);
          return { error: null };
        }
        return { error: null };
      },
      delete: () => new QueryBuilder(this, table, "delete"),
      update: (payload: Row) => new QueryBuilder(this, table, "update", payload),
      select: () => new QueryBuilder(this, table, "select"),
    };
  }
}

function matches(row: Row, filters: Filter[]) {
  return filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    if (filter.op === "lt") return String(row[filter.column]) < String(filter.value);
    if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
    return false;
  });
}

function args(db: FakeSupabase, overrides: Partial<Parameters<typeof acquireCuentaEmissionLock>[0]> = {}) {
  return {
    sb: db as never,
    cuentaId: "cuenta-a",
    empresaId: "empresa-a",
    userId: "user-a",
    provider: "sii_local" as const,
    ttlSeconds: 300,
    ...overrides,
  };
}

describe("cuenta emission locks", () => {
  it("bloquea una segunda emision real para la misma cuenta", async () => {
    const db = new FakeSupabase();

    const first = await acquireCuentaEmissionLock(args(db));
    const second = await acquireCuentaEmissionLock(args(db, { userId: "user-b" }));

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "EMISION_BLOQUEADA" });
    expect(db.locks.size).toBe(1);
  });

  it("permite emisiones en cuentas distintas", async () => {
    const db = new FakeSupabase();

    const first = await acquireCuentaEmissionLock(args(db));
    const second = await acquireCuentaEmissionLock(args(db, { cuentaId: "cuenta-b", empresaId: "empresa-b", userId: "user-b" }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(db.locks.size).toBe(2);
  });

  it("ignora locks expirados antes de adquirir uno nuevo", async () => {
    const db = new FakeSupabase();

    await acquireCuentaEmissionLock(args(db, { ttlSeconds: -1 }));
    const fresh = await acquireCuentaEmissionLock(args(db, { userId: "user-b" }));

    expect(fresh.ok).toBe(true);
    expect(db.locks.size).toBe(1);
    expect([...db.locks.values()][0]?.usuario_id).toBe("user-b");
  });

  it("libera el lock y permite una emision posterior", async () => {
    const db = new FakeSupabase();

    const first = await acquireCuentaEmissionLock(args(db));
    if (!first.ok) throw new Error("first lock failed");

    await releaseCuentaEmissionLock({ sb: db as never, cuentaId: "cuenta-a", jobId: first.jobId, estado: "completed" });
    const second = await acquireCuentaEmissionLock(args(db, { userId: "user-b" }));

    expect(second.ok).toBe(true);
    expect(db.locks.size).toBe(1);
    expect(db.jobs.get(first.jobId)?.estado).toBe("completed");
  });

  // Guard de transición (C3): la lápida 'revision_pendiente' DEBE poder sobrescribir
  // un sello 'failed' espurio (carrera CAPTURE_DEBUG). Sin esto la propuesta
  // re-aparece 'lista' y se re-emite, quemando el folio.
  it("permite que la lapida revision_pendiente sobrescriba un 'failed' espurio", async () => {
    const db = new FakeSupabase();
    const lock = await acquireCuentaEmissionLock(args(db));
    if (!lock.ok) throw new Error("lock failed");

    await releaseCuentaEmissionLock({ sb: db as never, cuentaId: "cuenta-a", jobId: lock.jobId, estado: "failed" });
    expect(db.jobs.get(lock.jobId)?.estado).toBe("failed");

    await releaseCuentaEmissionLock({ sb: db as never, cuentaId: "cuenta-a", jobId: lock.jobId, estado: "revision_pendiente" });
    expect(db.jobs.get(lock.jobId)?.estado).toBe("revision_pendiente");
  });

  // Guard de transición (locks.ts:84): un release TARDÍO nunca degrada un job ya
  // 'completed' (antes el update era incondicional → una boleta registrada podía
  // volver a 'failed' y re-emitirse).
  it("no degrada un job 'completed' con un release tardio", async () => {
    const db = new FakeSupabase();
    const lock = await acquireCuentaEmissionLock(args(db));
    if (!lock.ok) throw new Error("lock failed");

    await releaseCuentaEmissionLock({ sb: db as never, cuentaId: "cuenta-a", jobId: lock.jobId, estado: "completed" });
    await releaseCuentaEmissionLock({ sb: db as never, cuentaId: "cuenta-a", jobId: lock.jobId, estado: "failed" });

    expect(db.jobs.get(lock.jobId)?.estado).toBe("completed");
  });

  // La lápida SÍ asciende a 'completed' cuando el folio finalmente se registra
  // (flujo revision_pendiente → completed del result route).
  it("asciende una lapida a 'completed' cuando el folio se registra", async () => {
    const db = new FakeSupabase();
    const lock = await acquireCuentaEmissionLock(args(db));
    if (!lock.ok) throw new Error("lock failed");

    await releaseCuentaEmissionLock({ sb: db as never, cuentaId: "cuenta-a", jobId: lock.jobId, estado: "revision_pendiente" });
    await releaseCuentaEmissionLock({ sb: db as never, cuentaId: "cuenta-a", jobId: lock.jobId, estado: "completed" });

    expect(db.jobs.get(lock.jobId)?.estado).toBe("completed");
  });

  // Boleta ÚNICA (sin propuesta_id): la lápida MANTIENE el candado de cuenta — es la
  // única reja server-side que le queda (los guards por propuesta_id no aplican).
  it("boleta unica: la lapida revision_pendiente MANTIENE el candado de cuenta", async () => {
    const db = new FakeSupabase();
    const lock = await acquireCuentaEmissionLock(args(db)); // sin propuestaId
    if (!lock.ok) throw new Error("lock failed");
    expect(db.locks.size).toBe(1);

    await releaseCuentaEmissionLock({ sb: db as never, cuentaId: "cuenta-a", jobId: lock.jobId, estado: "revision_pendiente" });

    expect(db.jobs.get(lock.jobId)?.estado).toBe("revision_pendiente");
    expect(db.locks.size).toBe(1); // candado retenido → un re-POST choca con EMISION_BLOQUEADA
  });

  // Lote (con propuesta_id): la lápida SÍ libera el candado — su reja es el guard
  // server-side por propuesta_id, no el candado de cuenta.
  it("lote: la lapida revision_pendiente SI libera el candado (guard por propuesta_id)", async () => {
    const db = new FakeSupabase();
    const lock = await acquireCuentaEmissionLock(args(db, { propuestaId: "prop-1" }));
    if (!lock.ok) throw new Error("lock failed");
    expect(db.locks.size).toBe(1);

    await releaseCuentaEmissionLock({ sb: db as never, cuentaId: "cuenta-a", jobId: lock.jobId, estado: "revision_pendiente" });

    expect(db.jobs.get(lock.jobId)?.estado).toBe("revision_pendiente");
    expect(db.locks.size).toBe(0); // candado liberado
  });
});
