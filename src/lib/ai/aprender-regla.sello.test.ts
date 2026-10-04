/**
 * Fase 1 medición — la PROPAGACIÓN (aprender-al-clasificar voltea a los hermanos
 * de la misma contraparte) es una decisión que el humano NO miró fila a fila: va
 * sellada como `propagacion`, abierta=false, con quién la gatilló, un solo lote
 * para todos los trozos y lote_n = cuántos hermanos calzaron. Así se puede medir
 * "error de propagación" (hermanos que después un humano corrigió).
 */
import { describe, expect, it } from "vitest";
import { aprenderReglaDesdeResolucion } from "./aprender-regla";

function sbCaptura(siblings: Array<{ id: string; descripcion: string }>, reglaInsertada: { id: string } | null = null) {
  const updates: Array<Record<string, unknown>> = [];
  const make = (table: string) => {
    let op = "select";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ["select", "eq", "in", "is", "ilike", "limit", "order", "maybeSingle"]) b[m] = () => b;
    b.insert = () => { op = "insert"; return b; };
    b.update = (p: Record<string, unknown>) => { op = "update"; if (table === "propuestas_ia") updates.push(p); return b; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.then = (resolve: any) => {
      const val = op === "insert" ? { data: table === "clasificacion_reglas" ? reglaInsertada : null, error: null }
        : op === "update" ? { error: null, count: 50 }
        : table === "movimientos_raw" ? { data: siblings, error: null }
        : { data: [], error: null };
      return Promise.resolve(val).then(resolve);
    };
    return b;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: { from: (t: string) => make(t) } as any, updates };
}

describe("propagación sellada", () => {
  it("120 hermanos → 3 trozos con el MISMO lote, canal propagacion, abierta=false, por=U1, lote_n=120", async () => {
    const siblings = Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, descripcion: `TRANSFERENCIA DE JUAN PEREZ ${i}` }));
    const { sb, updates } = sbCaptura(siblings);
    const r = await aprenderReglaDesdeResolucion(sb, {
      empresaId: "E1", userId: "U1", documentoId: "D1",
      descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipoFlujo: "entrada", tipoDte: 41,
    });
    expect(r.propagadas).toBe(150);
    expect(updates).toHaveLength(3);
    expect(new Set(updates.map((u) => u.decision_lote)).size).toBe(1);
    for (const u of updates) {
      expect(u).toMatchObject({
        tipo_dte: 41, decision_canal: "propagacion", decision_abierta: false,
        decision_por: "U1", decision_lote_n: 120,
      });
    }
  });
  it("ALTO 1: la propagación LIGA las hermanas a la regla que dice ese tipo (regla_id), con el sello de propagación", async () => {
    const siblings = [{ id: "m1", descripcion: "TRANSFERENCIA DE JUAN PEREZ 1" }];
    const { sb, updates } = sbCaptura(siblings, { id: "rNueva" });
    await aprenderReglaDesdeResolucion(sb, {
      empresaId: "E1", userId: "U1", documentoId: "D1",
      descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipoFlujo: "entrada", tipoDte: 41,
    });
    expect(updates[0]).toMatchObject({ regla_id: "rNueva", tipo_dte: 41, decision_canal: "propagacion" });
  });
});
