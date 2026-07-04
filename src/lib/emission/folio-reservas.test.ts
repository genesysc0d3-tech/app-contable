import { describe, expect, it } from "vitest";
import {
  finalizeFolioReservaForJob,
  markSimpleApiFolioGenerated,
  requireSimpleApiFolioReserva,
  requireSimpleApiFolioReservaForJob,
  reserveSimpleApiFolio,
} from "./folio-reservas";

// ---------------------------------------------------------------------------
// FakeSupabase en memoria (mismo enfoque que locks.test.ts) — soporta los
// encadenamientos que usa folio-reservas: select/insert/update + eq/neq/order/
// limit + maybeSingle/single, con ganchos para forzar errores y colisiones.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Resp = { data: Row | null; error: { code?: string; message?: string } | null };
type Filter = { op: "eq" | "neq"; col: string; val: unknown };

class FakeDb {
  reservas: Row[] = [];
  boletas: Row[] = [];
  seq = 1;
  collideInserts = 0;
  failNextInsert: { code?: string; message?: string } | null = null;
  failNextMaybeSingle: { message: string } | null = null;
  failNextUpdate: { message: string } | null = null;

  arr(table: string): Row[] {
    return table === "boletas_emitidas" ? this.boletas : this.reservas;
  }

  from(table: string) {
    return {
      select: () => new SelectQuery(this, table),
      insert: (payload: Row) => new InsertQuery(this, table, payload),
      update: (payload: Row) => new UpdateQuery(this, table, payload),
    };
  }
}

function applyFilters(rows: Row[], filters: Filter[]) {
  return rows.filter((r) => filters.every((f) => (f.op === "eq" ? r[f.col] === f.val : r[f.col] !== f.val)));
}

class SelectQuery {
  private filters: Filter[] = [];
  private orderCol?: string;
  private orderAsc = true;
  private limitN?: number;
  constructor(private db: FakeDb, private table: string) {}
  eq(col: string, val: unknown) { this.filters.push({ op: "eq", col, val }); return this; }
  neq(col: string, val: unknown) { this.filters.push({ op: "neq", col, val }); return this; }
  order(col: string, opts: { ascending: boolean }) { this.orderCol = col; this.orderAsc = opts.ascending; return this; }
  limit(n: number) { this.limitN = n; return this; }
  private rows(): Row[] {
    let rows = applyFilters(this.db.arr(this.table), this.filters);
    if (this.orderCol) {
      const col = this.orderCol;
      rows = [...rows].sort((a, b) => (this.orderAsc ? Number(a[col]) - Number(b[col]) : Number(b[col]) - Number(a[col])));
    }
    if (this.limitN !== undefined) rows = rows.slice(0, this.limitN);
    return rows;
  }
  async maybeSingle(): Promise<Resp> {
    if (this.db.failNextMaybeSingle) {
      const e = this.db.failNextMaybeSingle;
      this.db.failNextMaybeSingle = null;
      return { data: null, error: { message: e.message } };
    }
    return { data: this.rows()[0] ?? null, error: null };
  }
}

class InsertQuery {
  constructor(private db: FakeDb, private table: string, private payload: Row) {}
  select() { return this; }
  async single(): Promise<Resp> {
    if (this.db.collideInserts > 0) {
      this.db.collideInserts -= 1;
      return { data: null, error: { code: "23505", message: "duplicate key" } };
    }
    if (this.db.failNextInsert) {
      const e = this.db.failNextInsert;
      this.db.failNextInsert = null;
      return { data: null, error: e };
    }
    const arr = this.db.arr(this.table);
    const collision = arr.some(
      (r) => r.empresa_id === this.payload.empresa_id && r.tipo_dte === this.payload.tipo_dte && r.folio === this.payload.folio && r.estado !== "liberado",
    );
    if (collision) return { data: null, error: { code: "23505", message: "duplicate key" } };
    const row: Row = { id: `res-${this.db.seq++}`, updated_at: null, ...this.payload };
    arr.push(row);
    return { data: row, error: null };
  }
}

class UpdateQuery {
  private filters: Filter[] = [];
  constructor(private db: FakeDb, private table: string, private payload: Row) {}
  eq(col: string, val: unknown) { this.filters.push({ op: "eq", col, val }); return this; }
  select() { return this; }
  private apply(): Row[] {
    const updated = applyFilters(this.db.arr(this.table), this.filters);
    for (const r of updated) Object.assign(r, this.payload);
    return updated;
  }
  async maybeSingle(): Promise<Resp> {
    if (this.db.failNextUpdate) {
      const e = this.db.failNextUpdate;
      this.db.failNextUpdate = null;
      return { data: null, error: { message: e.message } };
    }
    return { data: this.apply()[0] ?? null, error: null };
  }
  then(resolve: (v: { error: null }) => void) {
    this.apply();
    resolve({ error: null });
  }
}

// Espejo del tipo local (no exportado) ReservaEstado, mutable para que calce
// con la firma `allowedEstados: ReservaEstado[]`.
type Estado = "reservado" | "generado" | "usado" | "liberado" | "fallido" | "vencido";

const future = () => new Date(Date.now() + 60_000).toISOString();
const past = () => new Date(Date.now() - 60_000).toISOString();

function seedReserva(db: FakeDb, overrides: Row = {}): Row {
  const row: Row = {
    id: "res-seed",
    job_id: "job-1",
    empresa_id: "empresa-1",
    tipo_dte: 39,
    folio: 41,
    estado: "reservado",
    expires_at: future(),
    updated_at: null,
    ...overrides,
  };
  db.reservas.push(row);
  return row;
}

const sbOf = (db: FakeDb) => db as never;

// ===========================================================================

describe("reserveSimpleApiFolio — gate de tipo y reserva", () => {
  it("rechaza tipos fuera de la whitelist SimpleAPI sin tocar la DB", async () => {
    const db = new FakeDb();
    const r = await reserveSimpleApiFolio({ sb: sbOf(db), empresaId: "empresa-1", tipoDte: 61, jobId: "job-1", expiresAt: future() });
    expect(r).toEqual({ ok: false, error: "TIPO_DTE_INVALID" });
    expect(db.reservas).toHaveLength(0);
  });

  it("reserva el folio 1 en una empresa sin historial", async () => {
    const db = new FakeDb();
    const r = await reserveSimpleApiFolio({ sb: sbOf(db), empresaId: "empresa-1", tipoDte: 39, jobId: "job-1", expiresAt: future() });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.folio).toBe(1);
    expect(r.tipoDte).toBe(39);
  });

  it("calcula el siguiente folio como max(emitidos, reservados) + 1 e ignora liberados", async () => {
    const db = new FakeDb();
    db.boletas.push({ empresa_id: "empresa-1", tipo_dte: 39, folio: 10 });
    seedReserva(db, { id: "r12", folio: 12, job_id: "job-x" });
    seedReserva(db, { id: "r99", folio: 99, estado: "liberado", job_id: "job-y" });
    const r = await reserveSimpleApiFolio({ sb: sbOf(db), empresaId: "empresa-1", tipoDte: 39, jobId: "job-1", expiresAt: future() });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.folio).toBe(13); // max(10,12)+1, el liberado 99 no cuenta
  });

  it("reintenta ante colision 23505 y termina reservando", async () => {
    const db = new FakeDb();
    db.collideInserts = 2; // las dos primeras inserciones chocan
    const r = await reserveSimpleApiFolio({ sb: sbOf(db), empresaId: "empresa-1", tipoDte: 39, jobId: "job-1", expiresAt: future() });
    expect(r.ok).toBe(true);
    expect(db.reservas).toHaveLength(1);
  });

  it("falla si la colision persiste tras todos los intentos", async () => {
    const db = new FakeDb();
    db.collideInserts = 10; // siempre choca
    const r = await reserveSimpleApiFolio({ sb: sbOf(db), empresaId: "empresa-1", tipoDte: 39, jobId: "job-1", expiresAt: future() });
    expect(r).toMatchObject({ ok: false, error: "FOLIO_RESERVA_FAILED" });
    expect(db.reservas).toHaveLength(0);
  });

  it("propaga un error de DB que no sea 23505", async () => {
    const db = new FakeDb();
    db.failNextInsert = { code: "500", message: "boom" };
    const r = await reserveSimpleApiFolio({ sb: sbOf(db), empresaId: "empresa-1", tipoDte: 39, jobId: "job-1", expiresAt: future() });
    expect(r).toEqual({ ok: false, error: "FOLIO_RESERVA_FAILED", detalle: "boom" });
  });
});

describe("requireSimpleApiFolioReserva — validaciones de la reserva", () => {
  const base = { empresaId: "empresa-1", jobId: "job-1", tipoDte: 39, folio: 41, allowedEstados: ["reservado"] as Estado[] };

  it("exige tipo y folio antes de consultar", async () => {
    const db = new FakeDb();
    expect(await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base, tipoDte: null })).toMatchObject({ ok: false, status: 409, error: "FOLIO_RESERVA_REQUIRED" });
    expect(await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base, folio: null })).toMatchObject({ ok: false, error: "FOLIO_RESERVA_REQUIRED" });
  });

  it("devuelve QUERY_FAILED (500) si la consulta falla", async () => {
    const db = new FakeDb();
    db.failNextMaybeSingle = { message: "db down" };
    const r = await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base });
    expect(r).toMatchObject({ ok: false, status: 500, error: "FOLIO_RESERVA_QUERY_FAILED", detalle: "db down" });
  });

  it("NOT_FOUND cuando no hay reserva para el job", async () => {
    const db = new FakeDb();
    expect(await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base })).toMatchObject({ ok: false, status: 409, error: "FOLIO_RESERVA_NOT_FOUND" });
  });

  it("detecta mismatch de empresa, tipo y folio", async () => {
    const db = new FakeDb();
    seedReserva(db);
    expect(await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base, empresaId: "otra" })).toMatchObject({ error: "FOLIO_RESERVA_EMPRESA_MISMATCH" });
    expect(await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base, tipoDte: 41 })).toMatchObject({ error: "FOLIO_RESERVA_TIPO_MISMATCH" });
    expect(await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base, folio: 999 })).toMatchObject({ error: "FOLIO_RESERVA_FOLIO_MISMATCH" });
  });

  it("rechaza un estado fuera de los permitidos", async () => {
    const db = new FakeDb();
    seedReserva(db, { estado: "generado" });
    const r = await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base, allowedEstados: ["reservado"] });
    expect(r).toMatchObject({ ok: false, error: "FOLIO_RESERVA_ESTADO_INVALIDO" });
  });

  it("rechaza una reserva expirada", async () => {
    const db = new FakeDb();
    seedReserva(db, { expires_at: past() });
    const r = await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base });
    expect(r).toMatchObject({ ok: false, error: "FOLIO_RESERVA_EXPIRED" });
  });

  it("acepta una reserva valida, vigente y en estado permitido", async () => {
    const db = new FakeDb();
    seedReserva(db);
    const r = await requireSimpleApiFolioReserva({ sb: sbOf(db), ...base });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.reserva.folio).toBe(41);
  });
});

describe("requireSimpleApiFolioReservaForJob — solo por job", () => {
  const base = { empresaId: "empresa-1", jobId: "job-1", allowedEstados: ["reservado"] as Estado[] };

  it("NOT_FOUND, mismatch de empresa, estado invalido y expirada", async () => {
    const empty = new FakeDb();
    expect(await requireSimpleApiFolioReservaForJob({ sb: sbOf(empty), ...base })).toMatchObject({ error: "FOLIO_RESERVA_NOT_FOUND" });

    const dbEmpresa = new FakeDb();
    seedReserva(dbEmpresa);
    expect(await requireSimpleApiFolioReservaForJob({ sb: sbOf(dbEmpresa), ...base, empresaId: "otra" })).toMatchObject({ error: "FOLIO_RESERVA_EMPRESA_MISMATCH" });

    const dbEstado = new FakeDb();
    seedReserva(dbEstado, { estado: "usado" });
    expect(await requireSimpleApiFolioReservaForJob({ sb: sbOf(dbEstado), ...base })).toMatchObject({ error: "FOLIO_RESERVA_ESTADO_INVALIDO" });

    const dbExp = new FakeDb();
    seedReserva(dbExp, { expires_at: past() });
    expect(await requireSimpleApiFolioReservaForJob({ sb: sbOf(dbExp), ...base })).toMatchObject({ error: "FOLIO_RESERVA_EXPIRED" });
  });

  it("acepta la reserva vigente y permitida", async () => {
    const db = new FakeDb();
    seedReserva(db);
    const r = await requireSimpleApiFolioReservaForJob({ sb: sbOf(db), ...base });
    expect(r.ok).toBe(true);
  });
});

describe("markSimpleApiFolioGenerated", () => {
  it("pasa una reserva 'reservado' a 'generado'", async () => {
    const db = new FakeDb();
    seedReserva(db);
    const r = await markSimpleApiFolioGenerated({ sb: sbOf(db), jobId: "job-1", tipoDte: 39, folio: 41 });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.reserva.estado).toBe("generado");
    expect(db.reservas[0]!.estado).toBe("generado");
  });

  it("ESTADO_INVALIDO si no hay una reserva 'reservado' que calce", async () => {
    const db = new FakeDb();
    seedReserva(db, { estado: "generado" });
    const r = await markSimpleApiFolioGenerated({ sb: sbOf(db), jobId: "job-1", tipoDte: 39, folio: 41 });
    expect(r).toMatchObject({ ok: false, status: 409, error: "FOLIO_RESERVA_ESTADO_INVALIDO" });
  });

  it("UPDATE_FAILED (500) si el update falla", async () => {
    const db = new FakeDb();
    seedReserva(db);
    db.failNextUpdate = { message: "update boom" };
    const r = await markSimpleApiFolioGenerated({ sb: sbOf(db), jobId: "job-1", tipoDte: 39, folio: 41 });
    expect(r).toMatchObject({ ok: false, status: 500, error: "FOLIO_RESERVA_UPDATE_FAILED", detalle: "update boom" });
  });
});

describe("finalizeFolioReservaForJob — maquina de estados", () => {
  it("completed marca la reserva como 'usado'", async () => {
    const db = new FakeDb();
    seedReserva(db, { estado: "reservado" });
    await finalizeFolioReservaForJob({ sb: sbOf(db), jobId: "job-1", estado: "completed" });
    expect(db.reservas[0]!.estado).toBe("usado");
  });

  it("failed sobre 'reservado' libera el folio", async () => {
    const db = new FakeDb();
    seedReserva(db, { estado: "reservado" });
    await finalizeFolioReservaForJob({ sb: sbOf(db), jobId: "job-1", estado: "failed" });
    expect(db.reservas[0]!.estado).toBe("liberado");
  });

  it("cancelled/expired sobre 'generado' lo marca como 'fallido'", async () => {
    const dbCancel = new FakeDb();
    seedReserva(dbCancel, { estado: "generado" });
    await finalizeFolioReservaForJob({ sb: sbOf(dbCancel), jobId: "job-1", estado: "cancelled" });
    expect(dbCancel.reservas[0]!.estado).toBe("fallido");

    const dbExpired = new FakeDb();
    seedReserva(dbExpired, { estado: "generado" });
    await finalizeFolioReservaForJob({ sb: sbOf(dbExpired), jobId: "job-1", estado: "expired" });
    expect(dbExpired.reservas[0]!.estado).toBe("fallido");
  });

  it("no hace nada si no hay reserva para el job", async () => {
    const db = new FakeDb();
    await expect(finalizeFolioReservaForJob({ sb: sbOf(db), jobId: "ninguno", estado: "completed" })).resolves.toBeUndefined();
    expect(db.reservas).toHaveLength(0);
  });

  it("no transiciona estados terminales (failed sobre 'usado' no cambia nada)", async () => {
    const db = new FakeDb();
    seedReserva(db, { estado: "usado" });
    await finalizeFolioReservaForJob({ sb: sbOf(db), jobId: "job-1", estado: "failed" });
    expect(db.reservas[0]!.estado).toBe("usado");
  });
});
