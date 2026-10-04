/**
 * Fase 1 medición — el REPROCESO (limpiarInsercionesPrevias) también borra
 * propuestas: deja en la auditoría `documento_reprocesado_limpieza` con SOLO
 * conteos de lo que se fue (pedidos antes del borrado).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { estado, auditSpy } = vi.hoisted(() => ({
  estado: { orden: [] as string[], rpcResp: { total: 2, por_estado: { pendiente: 2 }, glosa: "JUAN PEREZ" } as unknown },
  auditSpy: vi.fn(async (_a: unknown) => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit/account", () => ({ recordCuentaAudit: auditSpy }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async () => { estado.orden.push("rpc"); return { data: estado.rpcResp, error: null }; },
    from: (tabla: string) => {
      let op = "select";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      q.select = () => q;
      q.delete = () => { op = "delete"; return q; };
      for (const m of ["eq", "neq", "in"]) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => {
        if (op === "delete") estado.orden.push(`delete:${tabla}`);
        const r = op === "delete" ? { error: null }
          : tabla === "movimientos_raw" ? { data: [{ id: "m1" }, { id: "m2" }], error: null }
          : tabla === "propuestas_ia" ? { data: [{ id: "p1" }], error: null }
          : { count: 0, error: null };
        return Promise.resolve(r).then(ok);
      };
      return q;
    },
  }),
}));

const { limpiarInsercionesPrevias } = await import("./processor");

beforeEach(() => {
  estado.orden = [];
  auditSpy.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
});

describe("limpiarInsercionesPrevias — rastro del borrado", () => {
  it("resumen ANTES del delete y auditoría documento_reprocesado_limpieza sin PII", async () => {
    expect(await limpiarInsercionesPrevias("D1", "E1")).toEqual({ ok: true });
    expect(estado.orden).toEqual(["rpc", "delete:movimientos_raw"]);
    const a = auditSpy.mock.calls[0]?.[0] as { accion: string; empresaId: string; metadata: Record<string, unknown> };
    expect(a).toMatchObject({ accion: "documento_reprocesado_limpieza", empresaId: "E1" });
    expect(a.metadata.propuestas_resumen).toMatchObject({ total: 2, por_estado: { pendiente: 2 } });
    expect(JSON.stringify(a.metadata)).not.toMatch(/JUAN|glosa/);
  });
  it("sin empresaId (llamador viejo) → limpia igual, sin auditoría", async () => {
    expect(await limpiarInsercionesPrevias("D1")).toEqual({ ok: true });
    expect(auditSpy).not.toHaveBeenCalled();
  });
});
