import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdapterConfig } from "./types";

/**
 * Vuelta 5 (2026-10-03): "Listo" del popup (upsertManualAdapter) contra una
 * tabla parser_adapters EN MEMORIA — se ejecuta la función real con un cliente
 * Supabase falso (sin red), y la caché (getAdapterByFingerprint) elige después.
 */
type Fila = Record<string, unknown>;
let tabla: Fila[] = [];

class Consulta implements PromiseLike<{ data: unknown; error: null }> {
  private filtros: ((r: Fila) => boolean)[] = [];
  constructor(private op: "select" | "update" | "insert", private payload?: Fila) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.filtros.push((r) => r[c] === v); return this; }
  or(expr: string) {
    const emp = expr.match(/creado_por_empresa_id\.eq\.([^,]+)/)?.[1];
    this.filtros.push((r) => r.creado_por_empresa_id == null || r.creado_por_empresa_id === emp);
    return this;
  }
  order() { return this; }
  limit() { return this; }
  private filas() { return tabla.filter((r) => this.filtros.every((f) => f(r))); }
  async single() {
    if (this.op === "insert") { const id = `nueva-${tabla.length + 1}`; tabla.push({ id, ...this.payload }); return { data: { id }, error: null }; }
    return { data: this.filas()[0] ?? null, error: null };
  }
  async maybeSingle() { return this.single(); }
  then<A, B>(ok?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    if (this.op === "update") for (const r of this.filas()) Object.assign(r, this.payload);
    return Promise.resolve({ data: this.op === "update" ? null : this.filas(), error: null as null }).then(ok, ko);
  }
}
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => ({
      select: () => new Consulta("select"),
      update: (p: Fila) => new Consulta("update", p),
      insert: (p: Fila) => new Consulta("insert", p),
    }),
  }),
}));

beforeEach(() => {
  tabla = [];
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://memoria.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba";
});

const base = { header_row: 0, skip_rows_before_data: 1, date_format: "dd/mm/yyyy", number_format: "chilean", layout: "two_cols", columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 } } as AdapterConfig;
const otro = { ...base, columns: { ...base.columns, cargo: 3, abono: 2 } } as AdapterConfig;
const fila = (id: string, config: AdapterConfig, extra: Fila = {}): Fila => ({
  id, fingerprint: "fp", creado_por_empresa_id: "emp", source: "manual", estado: "confirmado", confirmado_por: "cliente",
  confianza: 1, disabled_until: null, config, ...extra,
});

describe("«Listo» con dos filas del cliente (A1)", () => {
  it("tras «Listo» sobre S, la caché elige S (aunque T se usó más recientemente antes)", async () => {
    const { upsertManualAdapter, getAdapterByFingerprint } = await import("./adapter-store");
    tabla = [fila("S", base, { last_used_at: "2026-10-01T10:00:00Z" }), fila("T", otro, { last_used_at: "2026-10-02T10:00:00Z" })];
    expect((await getAdapterByFingerprint("fp", "emp"))?.id).toBe("T");
    const id = await upsertManualAdapter({ fingerprint: "fp", empresaId: "emp", config: { ...base, revision_cliente: { documento_id: "d", firma: "f" } }, confirmadoPor: "cliente" });
    expect(id).toBe("S");
    expect(tabla).toHaveLength(2);
    expect((await getAdapterByFingerprint("fp", "emp"))?.id).toBe("S");
  });
  it("«Listo» con un mapa nuevo inserta otra fila y esa gana en la caché", async () => {
    const { upsertManualAdapter, getAdapterByFingerprint } = await import("./adapter-store");
    tabla = [fila("T", otro, { last_used_at: "2026-10-02T10:00:00Z" })];
    const id = await upsertManualAdapter({ fingerprint: "fp", empresaId: "emp", config: base, confirmadoPor: "cliente" });
    expect(tabla).toHaveLength(2);
    expect((await getAdapterByFingerprint("fp", "emp"))?.id).toBe(id);
  });
});

describe("«Listo» sobre una fila confirmada por el banco con el MISMO mapa (M1)", () => {
  it("conserva confirmado_por saldo y la huella de la cuenta (sigue contando para el consenso)", async () => {
    const { upsertManualAdapter, hayConsensoParaGlobal } = await import("./adapter-store");
    tabla = [fila("K", { ...base, cuenta_huella: "h1" }, { source: "named", confirmado_por: "saldo", last_used_at: "2026-10-01T10:00:00Z", cuenta_id: "c1" })];
    await upsertManualAdapter({ fingerprint: "fp", empresaId: "emp", config: { ...base, revision_cliente: { documento_id: "d", firma: "f" } }, confirmadoPor: "cliente" });
    expect(tabla).toHaveLength(1);
    expect(tabla[0]).toMatchObject({ estado: "confirmado", confirmado_por: "saldo", config: { cuenta_huella: "h1", revision_cliente: { documento_id: "d" } } });
    const otraEmpresa = { ...tabla[0], creado_por_empresa_id: "emp2", cuenta_id: "c2", config: { ...base, cuenta_huella: "h2" } };
    expect(hayConsensoParaGlobal([tabla[0], otraEmpresa] as never, base)).toBe(true);
  });
  it("sobre una fila provisoria con el mismo mapa: queda confirmada por el cliente", async () => {
    const { upsertManualAdapter } = await import("./adapter-store");
    tabla = [fila("P", base, { source: "heuristic", estado: "provisorio", confirmado_por: null, confianza: 0.7 })];
    await upsertManualAdapter({ fingerprint: "fp", empresaId: "emp", config: base, confirmadoPor: "cliente" });
    expect(tabla[0]).toMatchObject({ estado: "confirmado", confirmado_por: "cliente" });
  });
});

describe("B3: adapterPropioMismoMapa usa la misma regla que filaPropiaMismoMapa", () => {
  it("devuelve la fila propia con el mismo mapa (aunque esté deshabilitada) y null con otro mapa", async () => {
    const { adapterPropioMismoMapa } = await import("./adapter-store");
    tabla = [fila("Z", base, { confianza: 0.1, disabled_until: "2099-01-01" })];
    expect(await adapterPropioMismoMapa("fp", "emp", { ...base, titulos: ["x"] })).toBe("Z");
    expect(await adapterPropioMismoMapa("fp", "emp", otro)).toBeNull();
  });
});
