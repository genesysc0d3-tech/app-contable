import { describe, expect, it, vi } from "vitest";
import { acquireCuentaEmissionLock, releaseCuentaEmissionLock } from "./locks";

vi.mock("@/lib/emission/folio-reservas", () => ({
  finalizeFolioReservaForJob: vi.fn(async () => ({ ok: true })),
}));

type Row = Record<string, unknown>;
type Filter = { op: "eq" | "lt"; column: string; value: unknown };

class QueryBuilder {
  private filters: Filter[] = [];

  constructor(
    private readonly db: FakeSupabase,
    private readonly table: string,
    private readonly op: "delete" | "update",
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

  then(resolve: (value: { error: null }) => void) {
    if (this.table === "emision_locks" && this.op === "delete") {
      for (const [cuentaId, row] of this.db.locks.entries()) {
        if (matches(row, this.filters)) this.db.locks.delete(cuentaId);
      }
    }
    if (this.table === "emision_jobs" && this.op === "update") {
      for (const [jobId, row] of this.db.jobs.entries()) {
        if (matches(row, this.filters)) this.db.jobs.set(jobId, { ...row, ...this.payload });
      }
    }
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
    };
  }
}

function matches(row: Row, filters: Filter[]) {
  return filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    if (filter.op === "lt") return String(row[filter.column]) < String(filter.value);
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
});
