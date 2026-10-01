import { beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./adapter-store";

// Punto 7 (2026-09-30): MAPAS PROVISORIOS vs CONFIRMADOS. Diagnóstico en prod:
// 44 mapas heurísticos se reusaban con confianza 1.0 sin que nadie los hubiera
// confirmado. Lo derivado nace provisorio (confianza < manual), un reuso SIN
// prueba no sube la confianza, y un provisorio no se comparte entre empresas.

type Llamada = { tabla: string; op: string; args: unknown[] };
const llamadas: Llamada[] = [];
let filaSelect: Record<string, unknown> | null = null;
let errorInsert: { code: string; message: string } | null = null;
let filasLista: Record<string, unknown>[] | null = null;

function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  const reg = (op: string) => (...args: unknown[]) => { llamadas.push({ tabla, op, args }); return b; };
  for (const op of ["select", "eq", "or", "order", "limit", "update", "not"]) b[op] = reg(op);
  b.insert = (...args: unknown[]) => {
    llamadas.push({ tabla, op: "insert", args });
    const conEstado = JSON.stringify(args[0]).includes("\"estado\"");
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.single = async () => (errorInsert && conEstado ? { data: null, error: errorInsert } : { data: { id: "nuevo" }, error: null });
    return q;
  };
  b.maybeSingle = async () => ({ data: filaSelect, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: filasLista, error: null }).then(ok);
  return b;
}
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

beforeEach(() => {
  llamadas.length = 0;
  filaSelect = null;
  errorInsert = null;
  filasLista = null;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});

const insertado = () => llamadas.filter((l) => l.op === "insert").map((l) => l.args[0] as Record<string, unknown>);
const actualizado = () => llamadas.filter((l) => l.op === "update").map((l) => l.args[0] as Record<string, unknown>);

describe("un mapa derivado nace PROVISORIO", () => {
  it("sin prueba: estado provisorio y confianza menor que un manual", async () => {
    await store.saveAdapter({ fingerprint: "fp", source: "heuristic", config: { columns: {} } as never, empresaId: "emp-A" });
    const fila = insertado()[0];
    expect(fila.estado).toBe("provisorio");
    expect(fila.confianza as number).toBeLessThan(1);
  });

  it("con prueba (saldo): nace confirmado", async () => {
    await store.saveAdapter({ fingerprint: "fp", source: "heuristic", config: { columns: {} } as never, empresaId: null, confirmadoPor: "saldo" });
    const fila = insertado()[0];
    expect(fila.estado).toBe("confirmado");
    expect(fila.confirmado_por).toBe("saldo");
  });

  it("FAIL-SAFE: si la columna estado no existe en la base, reintenta sin ella y guarda igual", async () => {
    errorInsert = { code: "PGRST204", message: "Could not find the 'estado' column of 'parser_adapters' in the schema cache" };
    const id = await store.saveAdapter({ fingerprint: "fp", source: "heuristic", config: { columns: {} } as never, empresaId: "emp-A" });
    expect(id).toBe("nuevo");
    expect(insertado()).toHaveLength(2);
    expect(insertado()[1].estado).toBeUndefined();
  });
});

describe("un reuso sin prueba no sube la confianza", () => {
  it("sin prueba: cuenta el uso, NO sube confianza ni éxitos", async () => {
    filaSelect = { confianza: 0.7, success_count: 0, usage_count: 3, estado: "provisorio" };
    await store.incrementAdapterSuccess("ad-1", { prueba: "sin_comprobar" });
    const u = actualizado()[0];
    expect(u.confianza).toBe(0.7);
    expect(u.success_count).toBe(0);
    expect(u.usage_count).toBe(4);
  });

  it("con prueba: sube y el provisorio pasa a confirmado", async () => {
    filaSelect = { confianza: 0.7, success_count: 0, usage_count: 3, estado: "provisorio" };
    await store.incrementAdapterSuccess("ad-1", { prueba: "saldo" });
    const [u, conf] = actualizado();
    expect(u.confianza as number).toBeGreaterThan(0.7);
    expect(conf).toMatchObject({ estado: "confirmado", confirmado_por: "saldo" });
  });
});

describe("un provisorio no se comparte entre empresas", () => {
  const base = { confianza: 0.7, disabled_until: null };
  it("un global PROVISORIO no se usa para otra empresa", () => {
    expect(store.selectAdapterForEmpresa([{ ...base, creado_por_empresa_id: null, estado: "provisorio" }], "emp-B")).toBeNull();
  });
  it("sin la columna estado (prod sin migrar) todo es provisorio: el global no se comparte", () => {
    expect(store.selectAdapterForEmpresa([{ ...base, creado_por_empresa_id: null }], "emp-B")).toBeNull();
  });
  it("un global CONFIRMADO sí se comparte; el propio provisorio también se usa (es de la misma empresa)", () => {
    const global = { ...base, confianza: 1, creado_por_empresa_id: null, estado: "confirmado" };
    expect(store.selectAdapterForEmpresa([global], "emp-B")).toBe(global);
    const propio = { ...base, creado_por_empresa_id: "emp-A", estado: "provisorio" };
    expect(store.selectAdapterForEmpresa([global, propio], "emp-A")).toBe(propio);
  });
});

describe("prod SIN la migración 20260930140000 (revisión adversarial 2026-09-30)", () => {
  // Sin la columna `estado` todo era provisorio: el mapa que la clienta confirmó
  // en el popup (source manual) no contaba y CADA cartola del formato volvía a
  // pedir "Revisa las columnas" (y escondía Editar/Aprobar). Mientras la columna
  // falte, se emula el backfill de la migración: manual y plantilla = confirmados.
  it("sin columna estado: manual → confirmado/manual, plantilla → confirmado/plantilla, el resto provisorio", () => {
    const manual = store.conEstadoLegado({ source: "manual", config: {} } as never);
    expect(manual.estado).toBe("confirmado");
    expect(manual.confirmado_por).toBe("manual");
    const plantilla = store.conEstadoLegado({ source: "named", config: { plantilla: true } } as never);
    expect(plantilla.estado).toBe("confirmado");
    expect(plantilla.confirmado_por).toBe("plantilla");
    expect(store.conEstadoLegado({ source: "heuristic", config: {} } as never).estado).toBe("provisorio");
  });
  it("con la columna (aunque sea null o provisorio) no se toca", () => {
    expect(store.conEstadoLegado({ source: "manual", config: {}, estado: "provisorio" } as never).estado).toBe("provisorio");
    expect(store.conEstadoLegado({ source: "manual", config: {}, estado: null } as never).estado).toBeNull();
  });
  it("getAdapterByFingerprint lo aplica: el manual propio (fila sin columna estado) llega confirmado", async () => {
    filasLista = [{ id: "m1", source: "manual", config: {}, confianza: 1, disabled_until: null, creado_por_empresa_id: "e1" }];
    const r = await store.getAdapterByFingerprint("fp", "e1");
    expect(r?.estado).toBe("confirmado");
  });
});
