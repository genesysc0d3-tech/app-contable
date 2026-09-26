import { beforeEach, describe, expect, it, vi } from "vitest";

// Revisión adversarial 2026-09-26: (1) la búsqueda del cache trae SOLO globales
// + propios (los privados de otras empresas no tapan al global con el limit);
// (2) la corrección MANUAL de una empresa se guarda aunque exista un global —
// antes upsertManualAdapter devolvía el global y no guardaba nada.
type Llamada = { tabla: string; op: string; args: unknown[] };
const llamadas: Llamada[] = [];
let respuestaSelect: { data: unknown; error: unknown } = { data: null, error: null };

function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  const reg = (op: string) => (...args: unknown[]) => { llamadas.push({ tabla, op, args }); return b; };
  for (const op of ["select", "eq", "or", "order", "limit", "insert", "update"]) b[op] = reg(op);
  b.maybeSingle = async () => respuestaSelect;
  b.single = async () => ({ data: { id: "nuevo-id" }, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve(respuestaSelect).then(ok);
  return b;
}
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: (t: string) => builder(t) }) }));

beforeEach(() => {
  llamadas.length = 0;
  respuestaSelect = { data: null, error: null };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});

describe("propiedad de los formatos (adapter-store)", () => {
  it("getAdapterByFingerprint filtra en la consulta a globales + propios", async () => {
    const { getAdapterByFingerprint } = await import("./adapter-store");
    respuestaSelect = { data: [], error: null };
    await getAdapterByFingerprint("fp1", "emp-A");
    const or = llamadas.find((l) => l.op === "or");
    expect(or?.args[0]).toBe("creado_por_empresa_id.is.null,creado_por_empresa_id.eq.emp-A");
  });

  it("upsertManualAdapter con un GLOBAL existente guarda el manual PROPIO (no devuelve el global)", async () => {
    const { upsertManualAdapter } = await import("./adapter-store");
    // La búsqueda filtra por dueño = emp-A → no encuentra el global → inserta.
    respuestaSelect = { data: null, error: null };
    const id = await upsertManualAdapter({ fingerprint: "fp1", empresaId: "emp-A", config: { columns: {} } as never });
    expect(id).toBe("nuevo-id");
    expect(llamadas.some((l) => l.op === "eq" && l.args[0] === "creado_por_empresa_id" && l.args[1] === "emp-A")).toBe(true);
    const ins = llamadas.find((l) => l.op === "insert");
    expect((ins?.args[0] as Record<string, unknown>).creado_por_empresa_id).toBe("emp-A");
    expect((ins?.args[0] as Record<string, unknown>).source).toBe("manual");
  });

  it("saveAdapter guarda el dueño que le pasan (formato provisorio = privado)", async () => {
    const { saveAdapter } = await import("./adapter-store");
    await saveAdapter({ fingerprint: "fp1", source: "heuristic", config: { columns: {} } as never, empresaId: "emp-A" });
    const ins = llamadas.find((l) => l.op === "insert");
    expect((ins?.args[0] as Record<string, unknown>).creado_por_empresa_id).toBe("emp-A");
  });
});
