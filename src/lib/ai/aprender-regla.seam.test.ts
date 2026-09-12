/**
 * Tests de la COSTURA del aprendizaje: acuñar → (leer) → aplicar, y el gate de
 * calidad. Es la junta que ningún test cubría (aprender-regla.test.ts prueba solo
 * funciones puras; classifier.test.ts arma reglas a mano con patron_tipo:"contains",
 * nunca el objeto regex REAL que acuña). Por eso el loop estuvo 3 meses muerto sin
 * que un test lo cazara. Estos MUERDEN si se revierte cualquiera de los fixes F0/F1.
 */
import { describe, it, expect } from "vitest";
import {
  extraerPatronContraparte,
  regexContraparte,
  aprenderReglaDesdeResolucion,
} from "./aprender-regla";

// Doble de Supabase: registra el insert y responde a la cadena de queries que
// usa aprenderReglaDesdeResolucion (dedup select → insert). Sin DB real.
function mockSb(opts: {
  existingRule?: unknown[];
  siblings?: unknown[];
  onInsert?: (table: string, payload: unknown) => void;
} = {}) {
  const make = (table: string) => {
    let op = "select";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ["select", "eq", "in", "is", "ilike", "limit", "order", "maybeSingle"]) b[m] = () => b;
    b.insert = (p: unknown) => { op = "insert"; opts.onInsert?.(table, p); return b; };
    b.update = () => { op = "update"; return b; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.then = (resolve: any, reject: any) => {
      let val: unknown;
      if (op === "insert") val = { error: null };
      else if (op === "update") val = { error: null, count: 0 };
      else if (table === "clasificacion_reglas") val = { data: opts.existingRule ?? [] };
      else if (table === "movimientos_raw") val = { data: opts.siblings ?? [], error: null };
      else val = { data: [], error: null };
      return Promise.resolve(val).then(resolve, reject);
    };
    return b;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from: (t: string) => make(t) } as any;
}

describe("aprender-regla — gate de calidad (no acuñar eventos bancarios)", () => {
  it("SOBREGIRO CTE → null (era la ÚNICA regla que el sistema aprendió en 3 meses, y era basura)", () => {
    expect(extraerPatronContraparte("SOBREGIRO CTE")).toBeNull();
  });
  it("intereses / comisión / mantención / impuesto bancario → null", () => {
    expect(extraerPatronContraparte("ABONO INTERESES CTA CTE")).toBeNull();
    expect(extraerPatronContraparte("COMISION MANTENCION CUENTA")).toBeNull();
    expect(extraerPatronContraparte("CARGO IMPUESTO CHEQUES")).toBeNull();
  });
  it("una contraparte real SÍ se extrae", () => {
    expect(extraerPatronContraparte("TRANSFERENCIA DE JUAN PEREZ")?.patron).toBe("JUAN PEREZ");
    expect(extraerPatronContraparte("PAGO MERCADOPAGO")?.patron).toBe("MERCADOPAGO");
  });
});

describe("aprender-regla — COSTURA acuñar→aplicar (regex real, no 'contains')", () => {
  it("el patrón aprendido de una glosa matchea OTRA glosa de la misma contraparte", () => {
    const p = extraerPatronContraparte("TRANSFERENCIA DE JUAN PEREZ");
    expect(p).not.toBeNull();
    // Esto es EXACTAMENTE lo que hace ruleMatches para patron_tipo:"regex".
    const re = new RegExp(regexContraparte(p!.patron), "i");
    expect(re.test("ABONO JUAN PEREZ 14:02")).toBe(true); // otra forma, misma persona → aplica
  });
  it("NO se lleva un nombre parecido: MARIA no matchea MARIANA (límite de palabra)", () => {
    const re = new RegExp(regexContraparte("MARIA"), "i");
    expect(re.test("TRANSFERENCIA MARIANA SOTO")).toBe(false);
    expect(re.test("ABONO DE MARIA")).toBe(true);
  });
});

describe("aprender-regla — acuñación (mock SB): inserta el objeto REAL, rechaza lo que no es venta", () => {
  it("una contraparte válida INSERTA una regla regex per-empresa con la forma correcta", async () => {
    let inserted: Record<string, unknown> | null = null;
    const sb = mockSb({ onInsert: (t, p) => { if (t === "clasificacion_reglas") inserted = p as Record<string, unknown>; } });
    const r = await aprenderReglaDesdeResolucion(sb, {
      empresaId: "E1", userId: "U1", documentoId: null,
      descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipoFlujo: "entrada", tipoDte: 41,
    });
    expect(r.creada).toBe(true);
    expect(inserted).toMatchObject({
      empresa_id: "E1", patron_tipo: "regex", tipo_dte: 41, tipo_propuesto: "exenta", prioridad: 50,
    });
    // El objeto REAL que se guarda es regex, no substring — lo que classifier.test.ts nunca probó.
    expect((inserted as unknown as { patron: string }).patron).toBe(regexContraparte("JUAN PEREZ"));
  });

  it("un SOBREGIRO CTE NO inserta regla (gate de calidad F0)", async () => {
    let inserts = 0;
    const sb = mockSb({ onInsert: () => { inserts++; } });
    const r = await aprenderReglaDesdeResolucion(sb, {
      empresaId: "E1", userId: "U1", documentoId: null,
      descripcion: "SOBREGIRO CTE", tipoFlujo: "entrada", tipoDte: 41,
    });
    expect(r.creada).toBe(false);
    expect(inserts).toBe(0);
  });

  it("un PRÉSTAMO con nombre NO inserta regla (gate detectaNoBoletar antes del insert)", async () => {
    let inserts = 0;
    const sb = mockSb({ onInsert: () => { inserts++; } });
    const r = await aprenderReglaDesdeResolucion(sb, {
      empresaId: "E1", userId: "U1", documentoId: null,
      descripcion: "TRANSFERENCIA JUAN PEREZ PRESTAMO", tipoFlujo: "entrada", tipoDte: 41,
    });
    expect(r.creada).toBe(false);
    expect(inserts).toBe(0);
  });
});
