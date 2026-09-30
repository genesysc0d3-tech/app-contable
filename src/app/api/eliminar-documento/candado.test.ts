/**
 * Doble candado 2026-09-30 — rutas que BORRAN un documento (eliminar y deshacer).
 * Bug: ignoraban el `error` de las consultas de boletas/jobs; si Supabase fallaba,
 * borraban igual y la lápida quedaba huérfana → la venta podía emitirse dos veces.
 * Estos tests muerden si vuelve el fail-open, el .in() gigante o el error crudo del trigger.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Resp = { data?: unknown; error: { message: string; code?: string } | null; count?: number | null };
type Llamada = { tabla: string; op: "select" | "delete" | "update"; filtros: Record<string, unknown> };

const { estado } = vi.hoisted(() => ({
  estado: {
    llamadas: [] as Llamada[],
    resp: (() => ({ data: [], error: null })) as (l: Llamada) => Resp,
    storageRemove: vi.fn(async () => ({ error: null })),
  },
}));

vi.mock("@/lib/auth/roles", () => ({ esRolEmision: () => true }));
vi.mock("@/lib/audit/account", () => ({ recordCuentaAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/r2", () => ({ deleteFromR2: vi.fn(async () => undefined) }));
vi.mock("@/lib/document-processing/queue", () => ({ cancelDocumentProcessingJob: vi.fn(async () => false) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "U1" } } }) },
    from: (tabla: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = { select: () => q, eq: () => q };
      q.single = async () =>
        tabla === "usuarios"
          ? { data: { empresa_id: "E1", rol: "owner" } }
          : {
              data: {
                id: "D1", empresa_id: "E1", nombre_archivo: "cartola.xlsx", tipo: "cartola",
                estado: "procesado", storage_path: "cartolas/a.xlsx", storage_provider: "supabase", album_imagenes: null,
              },
            };
      return q;
    },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { from: () => ({ remove: estado.storageRemove }) },
    from: (tabla: string) => {
      const l: Llamada = { tabla, op: "select", filtros: {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      q.select = () => q;
      q.delete = () => { l.op = "delete"; return q; };
      q.update = () => { l.op = "update"; return q; };
      for (const m of ["eq", "neq", "in", "not"]) q[m] = (c: string, v: unknown) => { l.filtros[`${m}:${c}`] = v; return q; };
      q.maybeSingle = () => q;
      q.then = (ok: (v: Resp) => unknown, ko: (e: unknown) => unknown) => {
        estado.llamadas.push(l);
        return Promise.resolve(estado.resp(l)).then(ok, ko);
      };
      return q;
    },
  }),
}));

import { POST as eliminar } from "./route";
import { POST as deshacer } from "../deshacer-documento/route";
import { MENSAJE_CANDADO_BD, MENSAJE_NO_PUDIMOS_REVISAR } from "@/lib/emission/bloqueo-borrado";

const req = () => new Request("http://x/api", { method: "POST", body: JSON.stringify({ documento_id: "D1" }) });
const movs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }));

/** Respuesta "sana" por defecto; `over` cambia una tabla/op puntual. */
function escenario(nMovs: number, over: (l: Llamada) => Resp | undefined = () => undefined) {
  estado.resp = (l) => {
    const o = over(l);
    if (o) return o;
    if (l.op !== "select") return { error: null };
    if (l.tabla === "movimientos_raw") return { data: movs(nMovs), error: null };
    if (l.tabla === "propuestas_ia") return { data: (l.filtros["in:movimiento_id"] as string[]).map((m) => ({ id: `p-${m}` })), error: null };
    if (l.tabla === "boletas_emitidas" || l.tabla === "emision_jobs") return { count: 0, error: null };
    return { data: [], error: null };
  };
}

const borrados = () => estado.llamadas.filter((l) => l.op === "delete").map((l) => l.tabla);

beforeEach(() => {
  estado.llamadas = [];
  estado.storageRemove.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
});

describe.each([
  ["eliminar-documento", eliminar],
  ["deshacer-documento", deshacer],
] as const)("%s — candado 1 fail-closed", (_nombre, POST) => {
  it("★ error al revisar boletas → 503 'No pudimos revisar…' y NO borra nada", async () => {
    escenario(3, (l) => (l.tabla === "boletas_emitidas" ? { count: null, error: { message: "timeout" } } : undefined));
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(MENSAJE_NO_PUDIMOS_REVISAR);
    expect(borrados()).toEqual([]);
    expect(estado.storageRemove).not.toHaveBeenCalled();
  });

  it("★ error al revisar jobs (lápidas) → 503 y NO borra nada", async () => {
    escenario(3, (l) => (l.tabla === "emision_jobs" ? { count: null, error: { message: "boom" } } : undefined));
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(borrados()).toEqual([]);
    expect(estado.storageRemove).not.toHaveBeenCalled();
  });

  it("★ error al leer propuestas o movimientos → 503 y NO borra nada", async () => {
    escenario(3, (l) => (l.tabla === "propuestas_ia" && l.op === "select" ? { data: null, error: { message: "boom" } } : undefined));
    expect((await POST(req())).status).toBe(503);
    escenario(3, (l) => (l.tabla === "movimientos_raw" && l.op === "select" ? { data: null, error: { message: "boom" } } : undefined));
    expect((await POST(req())).status).toBe(503);
    expect(borrados()).toEqual([]);
  });

  it("lápida (job abierto) → 409 y NO borra", async () => {
    escenario(3, (l) => (l.tabla === "emision_jobs" ? { count: 1, error: null } : undefined));
    expect((await POST(req())).status).toBe(409);
    expect(borrados()).toEqual([]);
  });

  it("boleta emitida → 409 y NO borra", async () => {
    escenario(3, (l) => (l.tabla === "boletas_emitidas" ? { count: 2, error: null } : undefined));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/2 boleta\(s\) emitida\(s\)/);
    expect(borrados()).toEqual([]);
  });

  it("cartola grande (350 movimientos): todas las consultas en trozos de ≤100 ids", async () => {
    escenario(350);
    const res = await POST(req());
    expect(res.status).toBe(200);
    const conIn = estado.llamadas.filter((l) => l.op === "select" && (l.filtros["in:movimiento_id"] || l.filtros["in:propuesta_id"]));
    expect(conIn.length).toBe(4 + 4 * 2); // 4 trozos de propuestas + (boletas + jobs) × 4
    for (const l of conIn) {
      const v = (l.filtros["in:movimiento_id"] ?? l.filtros["in:propuesta_id"]) as string[];
      expect(v.length).toBeLessThanOrEqual(100);
    }
    // Ningún DELETE con .in() gigante: se borra movimientos por documento (cascada).
    expect(estado.llamadas.some((l) => l.op === "delete" && l.tabla === "propuestas_ia")).toBe(false);
    expect(estado.llamadas.find((l) => l.op === "delete" && l.tabla === "movimientos_raw")?.filtros).toEqual({ "eq:documento_id": "D1" });
  });

  it("★ candado 2: el trigger PROPUESTA_CON_EMISION salta → 409 con mensaje humano", async () => {
    escenario(3, (l) =>
      l.op === "delete" && l.tabla === "movimientos_raw"
        ? { error: { message: "PROPUESTA_CON_EMISION: la propuesta p-m0 tiene 1 boleta(s)…", code: "MDE01" } }
        : undefined,
    );
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(MENSAJE_CANDADO_BD);
  });
});

describe("eliminar-documento — orden con el candado 2", () => {
  it("si el trigger frena, el ARCHIVO no se toca (movimientos se borran antes que el storage)", async () => {
    escenario(3, (l) =>
      l.op === "delete" && l.tabla === "movimientos_raw" ? { error: { message: "PROPUESTA_CON_EMISION", code: "MDE01" } } : undefined,
    );
    await eliminar(req());
    expect(estado.storageRemove).not.toHaveBeenCalled();
    expect(borrados()).toEqual(["movimientos_raw"]);
  });

  it("camino feliz: movimientos → archivo → PII → ia_uso → fila", async () => {
    escenario(3);
    const res = await eliminar(req());
    expect(res.status).toBe(200);
    expect(estado.storageRemove).toHaveBeenCalledTimes(1);
    expect(borrados()).toEqual(["movimientos_raw", "audit_chunks", "parser_logs", "ia_uso", "documentos_subidos"]);
  });
});

describe("deshacer-documento — no resetea si no pudo borrar", () => {
  it("trigger frena → no se resetea el documento a 'subido'", async () => {
    escenario(3, (l) =>
      l.op === "delete" && l.tabla === "movimientos_raw" ? { error: { message: "PROPUESTA_CON_EMISION", code: "MDE01" } } : undefined,
    );
    await deshacer(req());
    expect(estado.llamadas.some((l) => l.op === "update" && l.tabla === "documentos_subidos")).toBe(false);
  });
});
