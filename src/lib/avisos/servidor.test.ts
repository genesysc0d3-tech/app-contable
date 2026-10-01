import { beforeEach, describe, expect, it } from "vitest";
import { _reiniciarCacheAvisos, avisosPendientes } from "./servidor";

// Entrega de avisos en pedidos que la app YA hace (layout y /api/mesa): UNA
// consulta indexada por vigencia, caché corta y fail-safe si la tabla no existe.

type Llamada = { tabla: string; select?: string; filtros: [string, string, unknown][] };

type Resp = { data: unknown; error: unknown };
function fakeSb(respuesta: () => Resp | Promise<Resp>) {
  const llamadas: Llamada[] = [];
  const sb = {
    from(tabla: string) {
      const ll: Llamada = { tabla, filtros: [] };
      llamadas.push(ll);
      const b: Record<string, unknown> = {};
      b.select = (s: string) => { ll.select = s; return b; };
      for (const op of ["eq", "lte", "gt", "lt", "gte"]) b[op] = (c: string, v: unknown) => { ll.filtros.push([op, c, v]); return b; };
      b.order = () => b;
      b.limit = () => b;
      b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
        try { return Promise.resolve(respuesta()).then(ok, ko); } catch (e) { return Promise.reject(e).then(ok, ko); }
      };
      return b;
    },
  };
  return { sb: sb as never, llamadas };
}

const NOW = new Date("2026-10-01T15:00:00Z");
const fila = (p: Record<string, unknown> = {}) => ({
  id: "a1", tipo: "novedad", titulo: "Hola", cuerpo: "c", formato: "toast",
  desde: "2026-10-01T00:00:00Z", hasta: "2026-10-08T00:00:00Z", empresa_ids: null, mesa: null,
  version_min: null, created_at: "2026-10-01T00:00:00Z", avisos_vistos: [], ...p,
});

beforeEach(() => _reiniciarCacheAvisos());

describe("avisosPendientes", () => {
  it("UNA consulta: activo + vigencia (índice) + vistos del usuario embebidos", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: [fila()], error: null }));
    const r = await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: NOW });
    expect(r!.map((a) => a.id)).toEqual(["a1"]);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].tabla).toBe("avisos_app");
    expect(llamadas[0].select).toMatch(/avisos_vistos\(/);
    expect(llamadas[0].filtros).toEqual(expect.arrayContaining([
      ["eq", "activo", true],
      ["lte", "desde", NOW.toISOString()],
      ["gt", "hasta", NOW.toISOString()],
      ["eq", "avisos_vistos.user_id", "u1"],
    ]));
  });

  it("N2: UNA sola regla de empresa (avisoParaEmpresa) en el server, sin modos: layout y /api/mesa filtran igual", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: [fila({ id: "otra", empresa_ids: ["e2"] }), fila({ id: "mia", empresa_ids: ["e1"] }), fila({ id: "todas" })], error: null }));
    const r = await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: NOW });
    expect(r!.map((a) => a.id)).toEqual(["mia", "todas"]);
    expect(llamadas[0].select).toMatch(/empresa_ids/);
    expect(llamadas[0].select).not.toMatch(/creado_por/);
  });

  it("B1: lo que viaja al navegador nunca lleva empresa_ids", async () => {
    const { sb } = fakeSb(() => ({ data: [fila({ empresa_ids: ["e1", "e-otra"] })], error: null }));
    const r = await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: NOW });
    expect(r).toHaveLength(1);
    expect(r![0]).not.toHaveProperty("empresa_ids");
  });

  it("N1/M5: si la consulta tarda más que el tope → undefined (\"no sé\"), sin cachear", async () => {
    let n = 0;
    const { sb, llamadas } = fakeSb(() => { n++; return n === 1 ? new Promise<Resp>(() => {}) : { data: [fila()], error: null }; });
    const t0 = Date.now();
    expect(await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: NOW, timeoutMs: 30 })).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(1_000);
    const r = await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: NOW, timeoutMs: 30 });
    expect(r!.map((a) => a.id)).toEqual(["a1"]);
    expect(llamadas).toHaveLength(2);
  });

  it("lo ya visto por ESTE usuario no viaja", async () => {
    const { sb } = fakeSb(() => ({
      data: [fila({ id: "visto", avisos_vistos: [{ user_id: "u1" }] }), fila({ id: "nuevo" })],
      error: null,
    }));
    const r = await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: NOW });
    expect(r!.map((a) => a.id)).toEqual(["nuevo"]);
    expect(r![0]).not.toHaveProperty("avisos_vistos");
  });

  it("caché corta por usuario+empresa: la 2.ª carga no consulta; pasado el minuto, sí", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: [fila()], error: null }));
    await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: NOW });
    await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: new Date(NOW.getTime() + 30_000) });
    expect(llamadas).toHaveLength(1);
    await avisosPendientes(sb, { userId: "u2", empresaId: "e1", now: NOW });
    expect(llamadas).toHaveLength(2);
    await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: new Date(NOW.getTime() + 61_000) });
    expect(llamadas).toHaveLength(3);
  });

  it("FAIL-SAFE sin tabla: undefined y no reintenta en cada carga (5 min)", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.avisos_app'" } }));
    expect(await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: NOW })).toBeUndefined();
    expect(await avisosPendientes(sb, { userId: "u2", empresaId: "e2", now: NOW })).toBeUndefined();
    expect(llamadas).toHaveLength(1);
  });

  it("N1: excepción o error cualquiera → undefined y NO se cachea (la próxima carga reintenta)", async () => {
    const { sb } = fakeSb(() => { throw new Error("socket"); });
    expect(await avisosPendientes(sb, { userId: "u1", empresaId: "e1", now: NOW })).toBeUndefined();
    let n = 0;
    const otro = fakeSb(() => (++n === 1 ? { data: null, error: { code: "42501", message: "permission denied" } } : { data: [fila()], error: null }));
    expect(await avisosPendientes(otro.sb, { userId: "u3", empresaId: "e1", now: NOW })).toBeUndefined();
    expect((await avisosPendientes(otro.sb, { userId: "u3", empresaId: "e1", now: NOW }))!.map((a) => a.id)).toEqual(["a1"]);
  });

  it("sin usuario o sin empresa no consulta", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: [fila()], error: null }));
    expect(await avisosPendientes(sb, { userId: "", empresaId: "e1", now: NOW })).toEqual([]);
    expect(llamadas).toHaveLength(0);
  });
});
