/**
 * Doble candado 2026-09-30 — el REPROCESO también borra propuestas
 * (limpiarInsercionesPrevias). Antes: tragaba el error de las consultas y del
 * DELETE (reinsertaba encima → duplicados) y no miraba lápidas.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Resp = { data?: unknown; error: { message: string; code?: string } | null; count?: number | null };
type Llamada = { tabla: string; op: "select" | "delete"; filtros: Record<string, unknown> };

const { estado } = vi.hoisted(() => ({
  estado: { llamadas: [] as Llamada[], resp: (() => ({ data: [], error: null })) as (l: Llamada) => Resp },
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (tabla: string) => {
      const l: Llamada = { tabla, op: "select", filtros: {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      q.select = () => q;
      q.delete = () => { l.op = "delete"; return q; };
      for (const m of ["eq", "neq", "in"]) q[m] = (c: string, v: unknown) => { l.filtros[`${m}:${c}`] = v; return q; };
      q.then = (ok: (v: Resp) => unknown, ko: (e: unknown) => unknown) => {
        estado.llamadas.push(l);
        return Promise.resolve(estado.resp(l)).then(ok, ko);
      };
      return q;
    },
  }),
}));

const { limpiarInsercionesPrevias } = await import("./processor");

function escenario(over: (l: Llamada) => Resp | undefined = () => undefined) {
  estado.resp = (l) => {
    const o = over(l);
    if (o) return o;
    if (l.op === "delete") return { error: null };
    if (l.tabla === "movimientos_raw") return { data: [{ id: "m1" }, { id: "m2" }], error: null };
    if (l.tabla === "propuestas_ia") return { data: [{ id: "p1" }], error: null };
    return { count: 0, error: null };
  };
}
const borro = () => estado.llamadas.some((l) => l.op === "delete");

beforeEach(() => {
  estado.llamadas = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
});

describe("limpiarInsercionesPrevias (reproceso)", () => {
  it("sano: borra movimientos por documento (cascada), no un .in() de propuestas", async () => {
    escenario();
    expect(await limpiarInsercionesPrevias("D1")).toEqual({ ok: true });
    const dels = estado.llamadas.filter((l) => l.op === "delete");
    expect(dels).toEqual([{ tabla: "movimientos_raw", op: "delete", filtros: { "eq:documento_id": "D1" } }]);
  });

  it("★ error al revisar boletas → no borra (fail-closed)", async () => {
    escenario((l) => (l.tabla === "boletas_emitidas" ? { count: null, error: { message: "timeout" } } : undefined));
    expect(await limpiarInsercionesPrevias("D1")).toEqual({ ok: false, error: "REPROCESO_REVISION_FALLO" });
    expect(borro()).toBe(false);
  });

  it("★ error al leer movimientos → no sigue (no reinsertar encima)", async () => {
    escenario((l) => (l.tabla === "movimientos_raw" && l.op === "select" ? { data: null, error: { message: "boom" } } : undefined));
    expect(await limpiarInsercionesPrevias("D1")).toEqual({ ok: false, error: "REPROCESO_REVISION_FALLO" });
    expect(borro()).toBe(false);
  });

  it("★ lápida (job abierto) bloquea el reproceso", async () => {
    escenario((l) => (l.tabla === "emision_jobs" ? { count: 1, error: null } : undefined));
    expect(await limpiarInsercionesPrevias("D1")).toEqual({ ok: false, error: "REPROCESO_CON_BOLETA_EMITIDA" });
    expect(borro()).toBe(false);
  });

  it("★ el trigger PROPUESTA_CON_EMISION frena el DELETE → no ok (antes se tragaba)", async () => {
    escenario((l) => (l.op === "delete" ? { error: { message: "PROPUESTA_CON_EMISION: …", code: "MDE01" } } : undefined));
    expect(await limpiarInsercionesPrevias("D1")).toEqual({ ok: false, error: "REPROCESO_CON_BOLETA_EMITIDA" });
  });
});
