import { beforeEach, describe, expect, it, vi } from "vitest";

// /dev → Avisos: escribir avisos que verán TODAS las clientas es god-mode. Mismo
// guard que la pausa de emisión (getDevOperatorContext: email operador +
// dev_mode + aal2) y cada escritura queda en ops_events con el correo del operador.

let operador: unknown = { ok: false, error: "NOT_DEV_OPERATOR" };
const eventos: Record<string, unknown>[] = [];
const escrituras: { tabla: string; op: string; payload?: unknown; filtros: [string, unknown][] }[] = [];

function tabla(nombre: string) {
  const reg = { tabla: nombre, op: "", payload: undefined as unknown, filtros: [] as [string, unknown][] };
  const b: Record<string, unknown> = {};
  b.insert = (p: unknown) => { reg.op = "insert"; reg.payload = p; escrituras.push(reg); return b; };
  b.update = (p: unknown) => { reg.op = "update"; reg.payload = p; escrituras.push(reg); return b; };
  b.eq = (c: string, v: unknown) => { reg.filtros.push([c, v]); return b; };
  b.select = () => b;
  b.single = async () => ({ data: { id: "nuevo-id" }, error: null });
  b.maybeSingle = b.single;
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
  return b;
}
const sb = { from: (t: string) => tabla(t) };

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/dev/support-mode", () => ({ getDevOperatorContext: async () => operador }));
vi.mock("@/lib/ops/events", () => ({ recordOpsEvent: async (e: Record<string, unknown>) => { eventos.push(e); } }));

const input = {
  tipo: "urgente", formato: "popup", titulo: "El SII está con problemas",
  cuerpo: "Espera antes de emitir.", desde: "2026-10-01T12:00:00.000Z", hasta: "2026-10-01T18:00:00.000Z",
  empresaIds: [], mesa: null, versionMin: "",
};

beforeEach(() => {
  operador = { ok: false, error: "NOT_DEV_OPERATOR" };
  eventos.length = 0;
  escrituras.length = 0;
});

describe("guard de /dev → Avisos", () => {
  it("sin operador: crear, editar y desactivar se niegan SIN tocar la base", async () => {
    const { guardarAviso, desactivarAviso } = await import("./actions");
    expect(await guardarAviso(null, input)).toEqual({ error: "Solo operador Genesys" });
    expect(await guardarAviso("8f0e3c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6", input)).toEqual({ error: "Solo operador Genesys" });
    expect(await desactivarAviso("8f0e3c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6")).toEqual({ error: "Solo operador Genesys" });
    for (const e of ["NO_AUTH", "MFA_REQUERIDO", "MFA_NO_ENROLADO"]) {
      operador = { ok: false, error: e };
      expect(await guardarAviso(null, input)).toEqual({ error: "Solo operador Genesys" });
    }
    expect(escrituras).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it("con operador: crea con creado_por = su correo y deja auditoría", async () => {
    operador = { ok: true, sb, userId: "op", email: "genesysc0d3@gmail.com" };
    const { guardarAviso } = await import("./actions");
    const r = await guardarAviso(null, input, { confirmadoParaTodas: true });
    expect(r).toEqual({ ok: true, id: "nuevo-id" });
    expect(escrituras[0]).toMatchObject({ tabla: "avisos_app", op: "insert" });
    expect(escrituras[0].payload).toMatchObject({ tipo: "urgente", formato: "popup", creado_por: "genesysc0d3@gmail.com", activo: true });
    expect(eventos[0]).toMatchObject({ source: "dev-support", eventName: "aviso_creado", resourceType: "aviso_app", resourceId: "nuevo-id" });
  });

  it("con operador: editar exige UUID, valida y audita; desactivar audita", async () => {
    operador = { ok: true, sb, userId: "op", email: "genesysc0d3@gmail.com" };
    const { guardarAviso, desactivarAviso } = await import("./actions");
    expect(await guardarAviso("no-uuid", input)).toEqual({ error: "Aviso inválido" });
    expect("error" in (await guardarAviso(null, { ...input, tipo: "novedad" }))).toBe(true); // popup no urgente
    const id = "8f0e3c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6";
    expect(await guardarAviso(id, input, { confirmadoParaTodas: true })).toEqual({ ok: true, id });
    expect(escrituras.at(-1)).toMatchObject({ op: "update", filtros: [["id", id]] });
    expect(await desactivarAviso(id)).toEqual({ ok: true });
    expect(escrituras.at(-1)).toMatchObject({ op: "update", payload: expect.objectContaining({ activo: false }) });
    expect(eventos.map((e) => e.eventName)).toEqual(["aviso_editado", "aviso_desactivado"]);
    // B8: la edición audita antes y después
    expect(eventos[0].metadata).toMatchObject({ antes: expect.anything(), despues: expect.objectContaining({ titulo: input.titulo }) });
  });

  it("B8: un popup urgente para TODAS las empresas exige confirmación explícita (sin tocar la base)", async () => {
    operador = { ok: true, sb, userId: "op", email: "genesysc0d3@gmail.com" };
    const { guardarAviso } = await import("./actions");
    const r = await guardarAviso(null, input);
    expect(r).toEqual({ error: expect.stringMatching(/confirma/i) });
    expect(escrituras).toEqual([]);
    // dirigido a empresas puntuales no necesita la confirmación
    const r2 = await guardarAviso(null, { ...input, empresaIds: ["8f0e3c1a-1b2c-4d5e-8f90-a1b2c3d4e5f6"] });
    expect(r2).toEqual({ ok: true, id: "nuevo-id" });
  });

  it("N6: CUALQUIER urgente para todas (también toast o tarjeta) exige la confirmación", async () => {
    operador = { ok: true, sb, userId: "op", email: "genesysc0d3@gmail.com" };
    const { guardarAviso } = await import("./actions");
    for (const formato of ["toast", "tarjeta"]) {
      expect(await guardarAviso(null, { ...input, formato })).toEqual({ error: expect.stringMatching(/confirma/i) });
    }
    expect(escrituras).toEqual([]);
    // una novedad para todas no la necesita
    expect(await guardarAviso(null, { ...input, tipo: "novedad", formato: "toast" })).toEqual({ ok: true, id: "nuevo-id" });
  });

  it("el payload nunca se esparce: campos fuera de la allowlist no llegan a la base", async () => {
    operador = { ok: true, sb, userId: "op", email: "genesysc0d3@gmail.com" };
    const { guardarAviso } = await import("./actions");
    await guardarAviso(null, { ...input, activo: false, creado_por: "otro", id: "x" } as typeof input, { confirmadoParaTodas: true });
    const p = escrituras[0].payload as Record<string, unknown>;
    expect(p.creado_por).toBe("genesysc0d3@gmail.com");
    expect(p).not.toHaveProperty("id");
    expect(p.activo).toBe(true);
  });
});
