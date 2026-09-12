/**
 * Tests de la COSTURA de F1: que los CALLERS reales (cambiarTipoPropuestas bulk +
 * editarPropuesta) efectivamente acuñen — lo que estuvo 3 meses muerto y que
 * aprender-regla.seam.test.ts NO cubre (esa solo prueba la librería). Muerden si
 * se revierte F1: sin la acuñación bulk, o reponiendo el gate viejo / quitando la
 * señal de Opción B, el spy de aprenderReglaDesdeResolucion deja de llamarse.
 *
 * vitest no resuelve el alias `@/` para imports de valor: cada `@/` de actions.ts
 * se redirige con vi.mock + vi.importActual (patrón de mock.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { aprenderSpy, RESP } = vi.hoisted(() => ({
  aprenderSpy: vi.fn(async () => ({ creada: true, actualizada: false, propagadas: 0, patron: "x" })),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RESP: {} as Record<string, { select?: unknown; update?: unknown }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dev/support-mode", () => ({ getDevSupportWriteBlock: async () => null }));
vi.mock("@/lib/audit/account", () => ({ recordCuentaAudit: vi.fn() }));
vi.mock("@/lib/auth/roles", () => ({ ROLES_EMISION: new Set(["r"]) }));
// Libs reales (redirigidas por el alias): la lógica de guard exento y montos.
vi.mock("@/lib/sii/tipo-por-carril", async () => await vi.importActual("../../../lib/sii/tipo-por-carril"));
vi.mock("@/lib/sii/montos-dte", async () => await vi.importActual("../../../lib/sii/montos-dte"));
// aprender-regla REAL (extraerPatronContraparte lo usa el dedup) salvo la acuñación, que se ESPÍA.
vi.mock("@/lib/ai/aprender-regla", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/ai/aprender-regla")>("../../../lib/ai/aprender-regla");
  return { ...actual, aprenderReglaDesdeResolucion: aprenderSpy };
});

// Cliente de AUTH: usuario válido con rol de emisión ("r", que casa con el mock de ROLES_EMISION).
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "U1" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { empresa_id: "E1", rol: "r" } }) }) }) }),
  }),
}));

// Cliente SERVICE (createServiceClient): responde según RESP por (tabla, op).
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      let op: "select" | "update" | "insert" = "select";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq", "in", "is", "ilike", "limit", "order", "maybeSingle", "single"]) b[m] = () => b;
      b.update = () => { op = "update"; return b; };
      b.insert = () => { op = "insert"; return b; };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.then = (resolve: any, reject: any) => {
        let val: unknown;
        if (op === "update") val = RESP[table]?.update ?? { error: null, count: 1 };
        else if (op === "insert") val = { error: null };
        else val = RESP[table]?.select ?? { data: [] };
        return Promise.resolve(val).then(resolve, reject);
      };
      return b;
    },
  }),
}));

import { cambiarTipoPropuestas, editarPropuesta } from "./actions";

beforeEach(() => {
  aprenderSpy.mockClear();
  for (const k of Object.keys(RESP)) delete RESP[k];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
});

describe("F1 costura — cambiarTipoPropuestas (BULK) acuña con dedup por contraparte", () => {
  it("acuña 1 vez por contraparte DISTINTA (2 glosas de JUAN + 1 de MARIA → 2 reglas)", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto", boletas_tipo_default: null } } };
    RESP["propuestas_ia"] = { select: { data: [
      { id: "p1", total: 1000, movimiento_id: "m1" },
      { id: "p2", total: 2000, movimiento_id: "m2" },
      { id: "p3", total: 3000, movimiento_id: "m3" },
    ] }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: [
      { descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" },
      { descripcion: "ABONO JUAN PEREZ 14:02", tipo_flujo: "entrada", documento_id: "d1" },
      { descripcion: "PAGO MARIA SOTO", tipo_flujo: "entrada", documento_id: "d1" },
    ] } };

    const r = await cambiarTipoPropuestas(["p1", "p2", "p3"], "exenta", "boleta");
    expect(r.ok).toBe(true);
    expect(aprenderSpy).toHaveBeenCalledTimes(2); // JUAN dedup a 1 + MARIA 1
    expect(aprenderSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      empresaId: "E1", tipoDte: 41, tipoFlujo: "entrada",
    }));
  });

  it("mesa FACTURA (33/34) NO acuña (el matcher habla boleta 39/41)", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto", facturas_tipo_default: null } } };
    RESP["propuestas_ia"] = { select: { data: [{ id: "p1", total: 1000, movimiento_id: "m1" }] }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: [{ descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" }] } };

    const r = await cambiarTipoPropuestas(["p1"], "exenta", "factura");
    expect(r.ok).toBe(true);
    expect(aprenderSpy).not.toHaveBeenCalled();
  });
});

describe("F1 Opción B — editarPropuesta aprende con SEÑAL, no en aprobación pasiva", () => {
  const movRead = { select: { data: { descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" } } };

  it("el humano CAMBIA el tipo (39 pre-estampado → 41) → acuña", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: { tipo_dte: 39, movimiento_id: "m1" } }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = movRead;
    await editarPropuesta("p1", { tipo_dte: 41 });
    expect(aprenderSpy).toHaveBeenCalledTimes(1);
  });

  it("el LLM NO supo (tipo_dte null) y el humano decide → acuña", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: { tipo_dte: null, movimiento_id: "m1" } }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = movRead;
    await editarPropuesta("p1", { tipo_dte: 41 });
    expect(aprenderSpy).toHaveBeenCalledTimes(1);
  });

  it("aprobación PASIVA (41 pre-estampado, el humano confirma 41 sin cambiar) → NO acuña (mata el eco)", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: { tipo_dte: 41, movimiento_id: "m1" } }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = movRead;
    await editarPropuesta("p1", { tipo_dte: 41 });
    expect(aprenderSpy).not.toHaveBeenCalled();
  });
});
