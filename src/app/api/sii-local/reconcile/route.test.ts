import { beforeEach, describe, expect, it, vi } from "vitest";

// Auditoría 2026-10-01: el dedup leía TODO el historial de boletas sin paginar →
// PostgREST cortaba en 1000 y, con más, folios que SÍ estaban se volvían a insertar
// (duplicados) y los fantasmas se contaban sobre un universo incompleto.

type Fila = Record<string, unknown>;
const MAX_ROWS = 1000;
let boletas: Fila[] = [];
let insertadas: Fila[] = [];

/** PostgREST falso: filtros básicos, orden por id y corte en max-rows. */
function consulta(tabla: string) {
  const preds: Array<(f: Fila) => boolean> = [];
  let rango: [number, number] | null = null;
  let ordenar: string | null = null;
  const ejecutar = () => {
    if (tabla === "empresas") return { data: { rut: "1-9", razon_social: "E", giro: "g", direccion: "d", comuna: "c" }, error: null };
    let filas = boletas.filter((f) => preds.every((p) => p(f)));
    if (ordenar) filas = [...filas].sort((a, b) => String(a[ordenar!]).localeCompare(String(b[ordenar!])));
    const desde = rango ? rango[0] : 0;
    const hasta = rango ? rango[1] + 1 : filas.length;
    return { data: filas.slice(desde, Math.min(hasta, desde + MAX_ROWS)), error: null };
  };
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => { preds.push((f) => f[k] === v); return q; },
    neq: (k: string, v: unknown) => { preds.push((f) => f[k] !== v); return q; },
    in: (k: string, vs: unknown[]) => { preds.push((f) => vs.includes(f[k])); return q; },
    gte: (k: string, v: string) => { preds.push((f) => String(f[k]) >= v); return q; },
    lte: (k: string, v: string) => { preds.push((f) => String(f[k]) <= v); return q; },
    order: (k: string) => { ordenar = k; return q; },
    range: (a: number, b: number) => { rango = [a, b]; return q; },
    single: async () => ejecutar(),
    insert: async (v: Fila) => { insertadas.push(v); return { error: null }; },
    then: (ok: (r: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok),
  };
  return q;
}

vi.mock("@/lib/api/sesion-segura", () => ({
  requireSesionSegura: async () => ({
    ok: true,
    user: { id: "u1" },
    supabase: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: "e1", rol: "owner" } }) }) }) }) },
  }),
}));
vi.mock("@/lib/entitlements", () => ({ validarAccesoCuenta: async () => ({ ok: true, planActivo: true }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (t: string) => consulta(t) }) }));

const post = async (body: unknown) => {
  const { POST } = await import("./route");
  const r = await POST(new Request("http://x/api/sii-local/reconcile", { method: "POST", body: JSON.stringify(body) }));
  return (await r.json()) as Record<string, unknown>;
};

describe("reconcile con más de 1000 boletas en la app", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://sb";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    insertadas = [];
    // 1500 boletas de septiembre (folios 1..1500), ids ordenables por folio.
    boletas = Array.from({ length: 1500 }, (_, i) => ({
      id: `b${String(i + 1).padStart(5, "0")}`, empresa_id: "e1", tipo_dte: 39, folio: i + 1,
      fecha_emision: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`, estado: "aceptado",
    }));
  });

  it("un folio que ya está (más allá de las primeras 1000) NO se vuelve a insertar", async () => {
    const res = await post({ rows: [{ folio: 1400, tipo_dte: 39, monto_total: 1000, fecha_emision: "2026-09-12" }] });
    expect(res.ok).toBe(true);
    expect(insertadas).toEqual([]);
    expect(res.respaldados).toEqual([]);
  });

  it("un folio que de verdad falta sí se respalda", async () => {
    const res = await post({ rows: [{ folio: 1600, tipo_dte: 39, monto_total: 1000, fecha_emision: "2026-09-12" }] });
    expect(res.respaldados).toEqual([1600]);
    expect(insertadas.length).toBe(1);
  });

  it("fantasmas: cuenta sobre TODO el rango, no sobre las primeras 1000 del historial", async () => {
    // Rango de un día (el tope es 500 filas por request); el Resumen trae todas las
    // del día menos los folios 1065 y 1373, que viven más allá de las primeras 1000.
    const faltan = new Set([1065, 1373]);
    const delDia = boletas.filter((b) => b.fecha_emision === "2026-09-01");
    const rowsDia = delDia.filter((b) => !faltan.has(b.folio as number)).map((b) => ({ folio: b.folio, tipo_dte: 39, monto_total: 1000, fecha_emision: b.fecha_emision }));
    const res = await post({ rows: rowsDia, desde: "2026-09-01", hasta: "2026-09-01" });
    expect(delDia.filter((b) => faltan.has(b.folio as number)).length).toBe(2);
    expect(res.fantasmas_posibles).toBe(2);
    expect(insertadas).toEqual([]);
  });

  it("fantasmas en un rango con más de 1000 boletas: no se pierden las del final", async () => {
    // Resumen vacío de filas válidas → toda boleta del rango es fantasma: deben ser 1500, no 1000.
    const res = await post({ rows: [], desde: "2026-09-01", hasta: "2026-09-30" });
    expect(res.fantasmas_posibles).toBe(1500);
  });
});
