/**
 * Fase 1 medición — borrar un documento (eliminar / deshacer) deja en la auditoría
 * de la cuenta un RESUMEN de las propuestas que se fueron: solo conteos por fuente,
 * estado, tipo y banda. Se pide ANTES del borrado (después ya no hay qué contar) y
 * jamás lleva glosas, receptores ni RUT.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Llamada = { tabla: string; op: "select" | "delete" | "update" | "rpc"; filtros: Record<string, unknown> };

const { estado, auditSpy } = vi.hoisted(() => ({
  estado: { llamadas: [] as Llamada[], rpcResp: null as unknown },
  auditSpy: vi.fn(async (_a: unknown) => undefined),
}));

vi.mock("@/lib/auth/roles", () => ({ esRolEmision: () => true }));
vi.mock("@/lib/audit/account", () => ({ recordCuentaAudit: auditSpy }));
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
          : { data: { id: "D1", empresa_id: "E1", nombre_archivo: "cartola.xlsx", tipo: "cartola", estado: "procesado", storage_path: "E1/D1/a.xlsx", storage_provider: "supabase", album_imagenes: null } };
      return q;
    },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      estado.llamadas.push({ tabla: fn, op: "rpc", filtros: args });
      return { data: estado.rpcResp, error: null };
    },
    from: (tabla: string) => {
      const l: Llamada = { tabla, op: "select", filtros: {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      q.select = () => q;
      q.delete = () => { l.op = "delete"; return q; };
      q.update = () => { l.op = "update"; return q; };
      for (const m of ["eq", "neq", "in", "not"]) q[m] = (c: string, v: unknown) => { l.filtros[`${m}:${c}`] = v; return q; };
      q.maybeSingle = () => q;
      q.then = (ok: (v: unknown) => unknown) => {
        estado.llamadas.push(l);
        let r: unknown = { data: [], error: null };
        if (l.op !== "select") r = { error: null };
        else if (tabla === "movimientos_raw") r = { data: [{ id: "m1" }, { id: "m2" }], error: null };
        else if (tabla === "propuestas_ia") r = { data: ((l.filtros["in:movimiento_id"] as string[]) ?? []).map((m) => ({ id: `p-${m}` })), error: null };
        else if (tabla === "boletas_emitidas" || tabla === "emision_jobs") r = { count: 0, error: null };
        return Promise.resolve(r).then(ok);
      };
      return q;
    },
  }),
}));

import { POST as eliminar } from "./route";
import { POST as deshacer } from "../deshacer-documento/route";

const req = () => new Request("http://x/api", { method: "POST", body: JSON.stringify({ documento_id: "D1" }) });

beforeEach(() => {
  estado.llamadas = [];
  auditSpy.mockClear();
  // La base devuelve conteos… y alguien coló texto: el saneo lo bota.
  estado.rpcResp = {
    total: 2, editadas: 0, sin_foto: 2,
    por_fuente: { regla: 1, ia_opencode: 1, "JUAN PEREZ": 9 },
    por_estado: { pendiente: 2 }, por_tipo_dte: { sin_tipo: 2 },
    por_tipo_dte_fuente: { sin_foto: 2 }, por_banda_confianza: { alta: 1, baja: 1 },
    descripcion: "TRANSF DE JUAN PEREZ 11.111.111-1",
  };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
});

describe.each([
  ["eliminar-documento", eliminar, "documento_eliminado"],
  ["deshacer-documento", deshacer, "documento_deshecho"],
] as const)("%s — rastro del borrado", (_n, POST, accion) => {
  it("pide el resumen ANTES de borrar los movimientos, scoped a empresa + documento", async () => {
    expect((await POST(req())).status).toBe(200);
    const iRpc = estado.llamadas.findIndex((l) => l.op === "rpc" && l.tabla === "resumen_propuestas_a_borrar");
    const iDel = estado.llamadas.findIndex((l) => l.op === "delete" && l.tabla === "movimientos_raw");
    expect(iRpc).toBeGreaterThanOrEqual(0);
    expect(iRpc).toBeLessThan(iDel);
    expect(estado.llamadas[iRpc].filtros).toMatchObject({ p_empresa_id: "E1", p_documento_id: "D1" });
  });

  it("la auditoría lleva propuestas_resumen con conteos y SIN PII", async () => {
    await POST(req());
    const a = auditSpy.mock.calls.map((c) => c[0] as { accion: string; metadata: Record<string, unknown> }).find((x) => x.accion === accion);
    const resumen = a?.metadata.propuestas_resumen as Record<string, unknown>;
    expect(resumen).toMatchObject({ total: 2, por_fuente: { regla: 1, ia_opencode: 1 }, por_estado: { pendiente: 2 } });
    const txt = JSON.stringify(a?.metadata);
    expect(txt).not.toMatch(/JUAN|11\.111|descripcion|receptor|glosa/i);
  });

  it("si la base no tiene la función → borra igual, sin resumen", async () => {
    estado.rpcResp = null;
    expect((await POST(req())).status).toBe(200);
    const a = auditSpy.mock.calls.map((c) => c[0] as { accion: string; metadata: Record<string, unknown> }).find((x) => x.accion === accion);
    expect(a?.metadata.propuestas_resumen).toBeUndefined();
  });
});
