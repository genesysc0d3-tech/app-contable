import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { msHastaProximoJobTomable } from "./proximo-job";
import { STALE_RUNNING_MS } from "./state";

type Job = { empresa_id: string; status: string; next_run_at?: string; locked_at?: string };

// Supabase falso mínimo: filtra una lista en memoria con los operadores que usa la sonda.
function fakeSb(jobs: Job[]) {
  return {
    from() {
      let rows = [...jobs];
      const q = {
        select: () => q,
        eq: (c: keyof Job, v: string) => { rows = rows.filter((r) => r[c] === v); return q; },
        in: (c: keyof Job, vs: string[]) => { rows = rows.filter((r) => vs.includes(r[c] as string)); return q; },
        gte: (c: keyof Job, v: string) => { rows = rows.filter((r) => (r[c] ?? "") >= v); return q; },
        not: (c: keyof Job, _op: string, lista: string) => {
          const fuera = lista.replace(/[()]/g, "").split(",");
          rows = rows.filter((r) => !fuera.includes(r[c] as string));
          return q;
        },
        order: (c: keyof Job) => { rows.sort((a, b) => String(a[c]).localeCompare(String(b[c]))); return q; },
        limit: (n: number) => { rows = rows.slice(0, n); return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (ok: (v: { data: Job[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const now = new Date("2026-09-28T12:00:00Z");
const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe("msHastaProximoJobTomable", () => {
  it("empresa con un job corriendo (fresco) → su pendiente NO cuenta: no encadenar sin progreso", async () => {
    const sb = fakeSb([
      { empresa_id: "A", status: "running", locked_at: iso(-60_000) },
      { empresa_id: "A", status: "queued", next_run_at: iso(-5_000) },
    ]);
    expect(await msHastaProximoJobTomable(sb, 210_000, now)).toBeNull();
  });

  it("running COLGADO (más viejo que el reaper) no bloquea: el próximo drenaje lo recupera", async () => {
    const sb = fakeSb([
      { empresa_id: "A", status: "running", locked_at: iso(-STALE_RUNNING_MS - 60_000) },
      { empresa_id: "A", status: "queued", next_run_at: iso(-5_000) },
    ]);
    expect(await msHastaProximoJobTomable(sb, 210_000, now)).toBe(0);
  });

  it("otra empresa libre con un pendiente vencido → 0 (se encadena)", async () => {
    const sb = fakeSb([
      { empresa_id: "A", status: "running", locked_at: iso(-60_000) },
      { empresa_id: "A", status: "queued", next_run_at: iso(-50_000) },
      { empresa_id: "B", status: "retryable", next_run_at: iso(-1_000) },
    ]);
    expect(await msHastaProximoJobTomable(sb, 210_000, now)).toBe(0);
  });

  it("incidente 2026-08-22: reintento con backoff a 90 s, empresa libre → espera 90 s (no muere la cadena)", async () => {
    const sb = fakeSb([{ empresa_id: "A", status: "retryable", next_run_at: iso(90_000) }]);
    expect(await msHastaProximoJobTomable(sb, 210_000, now)).toBe(90_000);
  });

  it("fuera del horizonte o cola vacía → null", async () => {
    expect(await msHastaProximoJobTomable(fakeSb([{ empresa_id: "A", status: "queued", next_run_at: iso(300_000) }]), 210_000, now)).toBeNull();
    expect(await msHastaProximoJobTomable(fakeSb([]), 210_000, now)).toBeNull();
  });
});
