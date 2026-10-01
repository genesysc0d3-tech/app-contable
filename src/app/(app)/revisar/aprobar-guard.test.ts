/**
 * Aprobar con guard de estado (adversarial mesa §2, 2026-09-30): `aprobarPropuesta` y
 * `aprobarTodas` aprobaban sin mirar el estado. Con una vista vieja, una persona
 * resucitaba a `aprobado` lo que otra había rechazado (y volvía a Emitir) o le cambiaba
 * el cliente a una ya emitida. Ahora solo aprueban desde pendiente/listo/editado, con el
 * filtro EN la propia consulta (atómico, sin leer-y-después-escribir).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Llamada = { tabla: string; op: "select" | "update"; filtros: Record<string, unknown>; valores?: unknown };

const { estado } = vi.hoisted(() => ({
  estado: { llamadas: [] as Llamada[], count: 1 as number },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit/account", () => ({ recordCuentaAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/dev/support-mode", () => ({ getDevSupportWriteBlock: async () => null }));
vi.mock("@/lib/ai/aprender-regla", () => ({ aprenderReglaDesdeResolucion: vi.fn(), extraerPatronContraparte: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "U1" } } }) },
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = { select: () => q, eq: () => q };
      q.single = async () => ({ data: { empresa_id: "E1", rol: "owner" } });
      return q;
    },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(tabla: string) {
      const l: Llamada = { tabla, op: "select", filtros: {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      q.select = () => q;
      q.update = (v: unknown) => { l.op = "update"; l.valores = v; return q; };
      for (const m of ["eq", "in", "neq"]) q[m] = (c: string, v: unknown) => { l.filtros[`${m}:${c}`] = v; return q; };
      q.then = (ok: (v: unknown) => unknown) => {
        estado.llamadas.push(l);
        return Promise.resolve({ error: null, count: estado.count }).then(ok);
      };
      return q;
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";

import { aprobarPropuesta, aprobarTodas } from "./actions";

const ESPERADOS = ["pendiente", "listo", "editado"];

beforeEach(() => {
  estado.llamadas = [];
  estado.count = 1;
});

describe("aprobarPropuesta — solo desde el estado esperado", () => {
  it("el UPDATE filtra por estado (pendiente/listo/editado) en la misma consulta", async () => {
    await aprobarPropuesta("P1", "CLI");
    const upd = estado.llamadas.find((l) => l.tabla === "propuestas_ia" && l.op === "update");
    expect(upd?.filtros["eq:id"]).toBe("P1");
    expect(upd?.filtros["in:estado"]).toEqual(ESPERADOS);
  });

  it("si no calzó (rechazada/emitida por otra persona con vista vieja) → error honesto", async () => {
    estado.count = 0;
    const r = await aprobarPropuesta("P1", null);
    expect(r).toMatchObject({ error: expect.stringContaining("cambió") });
  });
});

describe("aprobarTodas — filtra por estado en la propia consulta", () => {
  it("cada lote del UPDATE lleva el filtro de estado", async () => {
    await aprobarTodas(Array.from({ length: 60 }, (_, i) => `P${i}`));
    const upds = estado.llamadas.filter((l) => l.tabla === "propuestas_ia" && l.op === "update");
    expect(upds).toHaveLength(2);
    for (const u of upds) expect(u.filtros["in:estado"]).toEqual(ESPERADOS);
  });
});
