/**
 * (Copia del arnés de acunacion-callers.test.ts.) Fase 3: los CALLERS registran la
 * CORRECCIÓN de la regla que clasificó la fila — una llamada por acción con las reglas
 * de las filas cambiadas, y ANTES de acuñar (si la regla a prueba se da vuelta, el
 * acuñar la refuerza en vez de no hacer nada). Sin regla_id no se corrige nada.
 *
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

const { aprenderSpy, corregirSpy, buscarSpy, buscarLoteSpy, RESP } = vi.hoisted(() => ({
  corregirSpy: vi.fn(async () => ({ efectos: new Map(), avisos: [] as string[] })),
  buscarSpy: vi.fn(async (): Promise<string | null> => null),
  buscarLoteSpy: vi.fn(async (): Promise<Map<string, string>> => new Map()),
  aprenderSpy: vi.fn(async () => ({ creada: true, actualizada: false, propagadas: 0, patron: "x" })),
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

vi.mock("@/lib/ai/reglas-historial", async () => {
  const real = await vi.importActual<typeof import("../../../lib/ai/reglas-historial")>("../../../lib/ai/reglas-historial");
  return { registrarCorrecciones: corregirSpy, buscarReglaPorContraparte: buscarSpy, buscarReglasPorContrapartes: buscarLoteSpy, claveContraparte: real.claveContraparte };
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
      // `neq`: el guard de retroceso (propuestas-intocables) lee boletas_emitidas/emision_jobs.
      for (const m of ["select", "eq", "neq", "in", "is", "ilike", "limit", "order", "maybeSingle", "single"]) b[m] = () => b;
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
  corregirSpy.mockClear();
  buscarSpy.mockReset();
  buscarSpy.mockResolvedValue(null);
  buscarLoteSpy.mockReset();
  buscarLoteSpy.mockResolvedValue(new Map());
  for (const k of Object.keys(RESP)) delete RESP[k];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://x");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "k");
});

describe("Fase 3 — correcciones desde Check", () => {
  it("cambio de tipo en lote: UNA llamada con las filas que venían de reglas, antes de acuñar", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto", boletas_tipo_default: null } } };
    RESP["propuestas_ia"] = { select: { data: [
      { id: "p1", total: 1000, movimiento_id: "m1", regla_id: "r1", tipo_dte: 41 },
      { id: "p2", total: 2000, movimiento_id: "m2", regla_id: "r1", tipo_dte: 41 },
      { id: "p3", total: 3000, movimiento_id: "m3", regla_id: null, tipo_dte: null },
    ] }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: [
      { id: "m1", descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" },
      { id: "m2", descripcion: "ABONO JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" },
      { id: "m3", descripcion: "PAGO MARIA SOTO", tipo_flujo: "entrada", documento_id: "d1" },
    ] } };
    const r = await cambiarTipoPropuestas(["p1", "p2", "p3"], "afecta", "boleta", "check_lote");
    expect(r.ok).toBe(true);
    expect(corregirSpy).toHaveBeenCalledTimes(1);
    expect(corregirSpy).toHaveBeenCalledWith(expect.anything(), {
      empresaId: "E1", tipoNuevo: 39, mirada: true, // check_lote de 3 filas (≤ 25) = mirada
      filas: [
        { reglaId: "r1", tipoFila: 41, documentoId: "d1", glosa: "TRANSFERENCIA DE JUAN PEREZ", propuestaId: "p1" },
        { reglaId: "r1", tipoFila: 41, documentoId: "d1", glosa: "ABONO JUAN PEREZ", propuestaId: "p2" },
      ],
    });
    // antes de acuñar, y el acuñar lleva canal + movimiento (nacio_carril / soporte)
    const ordenCorregir = (corregirSpy.mock.invocationCallOrder as number[])[0];
    const ordenAcunar = (aprenderSpy.mock.invocationCallOrder as number[])[0];
    expect(ordenCorregir).toBeLessThan(ordenAcunar);
    expect(aprenderSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ canal: "check_lote", movimientoId: "m1" }));
  });

  it("una fila «¿?» por conflicto con la marca P2P: elegir Exenta NO corrige la regla", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: [{ id: "p1", total: 1000, movimiento_id: "m1", regla_id: "r39", fuente_clasificacion: "conflicto_marca_cartola" }] }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: [{ id: "m1", descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" }] } };
    await cambiarTipoPropuestas(["p1"], "exenta", "boleta", "check_fila");
    expect(corregirSpy).not.toHaveBeenCalled();
    RESP["propuestas_ia"] = { select: { data: { tipo_dte: null, movimiento_id: "m1", regla_id: "r39", fuente_clasificacion: "conflicto_marca_cartola" } }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: { descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" } } };
    await editarPropuesta("p1", { tipo_dte: 41 });
    expect(corregirSpy).not.toHaveBeenCalled();
  });

  it("M2: una fila cuyo 41 lo forzó el emisor exento (regla 39) no corrige la regla", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: [{ id: "p1", total: 1000, movimiento_id: "m1", regla_id: "r39", tipo_dte: 41, orig_tipo_dte_fuente: "regla_forzada_exenta" }] }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: [{ id: "m1", descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" }] } };
    await cambiarTipoPropuestas(["p1"], "afecta", "boleta", "check_fila");
    expect(corregirSpy).not.toHaveBeenCalled();
  });

  it("M3: el aviso de la regla viaja en la respuesta del cambio en lote; un lote > 25 va como NO mirado", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`);
    RESP["propuestas_ia"] = { select: { data: ids.map((id, i) => ({ id, total: 1000, movimiento_id: `m${i}`, regla_id: "r1", tipo_dte: 41 })) }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: ids.map((_, i) => ({ id: `m${i}`, descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" })) } };
    corregirSpy.mockResolvedValueOnce({ efectos: new Map(), avisos: ["Ya no estoy seguro de Juan Perez: te lo voy a preguntar."] });
    const r = await cambiarTipoPropuestas(ids, "afecta", "boleta", "check_lote");
    expect(corregirSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mirada: false }));
    expect(r.aviso).toContain("Ya no estoy seguro de Juan Perez");
  });

  it("ALTO 1: fila SIN regla_id (hermana propagada / IA previa) → se busca la regla viva por la contraparte y se corrige con el tipo de la fila", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: [
      { id: "p1", total: 1000, movimiento_id: "m1", regla_id: null, tipo_dte: 41 },
      { id: "p2", total: 1000, movimiento_id: "m2", regla_id: null, tipo_dte: 41 },
    ] }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: [
      { id: "m1", descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" },
      { id: "m2", descripcion: "ABONO JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" },
    ] } };
    const { claveContraparte } = await import("../../../lib/ai/reglas-historial");
    buscarLoteSpy.mockResolvedValue(new Map([[claveContraparte("TRANSFERENCIA DE JUAN PEREZ", "entrada")!, "r7"]]));
    await cambiarTipoPropuestas(["p1", "p2"], "afecta", "boleta", "check_fila");
    expect(buscarLoteSpy).toHaveBeenCalledTimes(1); // UNA consulta para todas las filas sin regla_id
    expect(buscarSpy).not.toHaveBeenCalled();
    expect(corregirSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      tipoNuevo: 39, mirada: true,
      filas: [
        { reglaId: "r7", tipoFila: 41, documentoId: "d1", glosa: "TRANSFERENCIA DE JUAN PEREZ", propuestaId: "p1" },
        { reglaId: "r7", tipoFila: 41, documentoId: "d1", glosa: "ABONO JUAN PEREZ", propuestaId: "p2" },
      ],
    }));
  });

  it("ALTO 1: editarPropuesta sobre una fila sin regla_id → corrige la regla viva de la contraparte", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: { tipo_dte: 41, movimiento_id: "m1", regla_id: null } }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: { descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" } } };
    buscarSpy.mockResolvedValue("r7");
    await editarPropuesta("p1", { tipo_dte: 39 });
    expect(corregirSpy).toHaveBeenCalledWith(expect.anything(), {
      empresaId: "E1", tipoNuevo: 39, mirada: true,
      filas: [{ reglaId: "r7", documentoId: "d1", tipoFila: 41, glosa: "TRANSFERENCIA DE JUAN PEREZ", propuestaId: "p1", explicita: true }],
    });
  });

  it("MEDIO: «Lista» en el detalle SIN tocar el selector (la fila ya traía 41) → la corrección va como NO explícita", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: { tipo_dte: 41, movimiento_id: "m1", regla_id: "rD" } }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: { descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" } } };
    await editarPropuesta("p1", { tipo_dte: 41 });
    expect(corregirSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      filas: [expect.objectContaining({ reglaId: "rD", propuestaId: "p1", explicita: false })],
    }));
  });

  it("sin regla_id NI regla viva de esa contraparte → no corrige", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: [{ id: "p1", total: 1000, movimiento_id: "m1", regla_id: null }] }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: [{ id: "m1", descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" }] } };
    await cambiarTipoPropuestas(["p1"], "exenta", "boleta");
    expect(corregirSpy).not.toHaveBeenCalled();
  });

  it("editarPropuesta: la persona cambia el tipo de una fila de regla → corrige esa regla", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: { tipo_dte: 41, movimiento_id: "m1", regla_id: "r1" } }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: { descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" } } };
    corregirSpy.mockResolvedValueOnce({ efectos: new Map(), avisos: ["Aprendí: desde ahora Juan Perez va como Afecta."] });
    const r = await editarPropuesta("p1", { tipo_dte: 39 });
    expect(corregirSpy).toHaveBeenCalledWith(expect.anything(), {
      empresaId: "E1", tipoNuevo: 39, mirada: true,
      filas: [{ reglaId: "r1", documentoId: "d1", tipoFila: 41, glosa: "TRANSFERENCIA DE JUAN PEREZ", propuestaId: "p1", explicita: true }],
    });
    // M3: el aviso llega a Check
    expect(r).toMatchObject({ ok: true, aviso: "Aprendí: desde ahora Juan Perez va como Afecta." });
    expect(aprenderSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ canal: "check_detalle", movimientoId: "m1" }));
  });

  it("editarPropuesta sin regla detrás → no corrige", async () => {
    RESP["empresas"] = { select: { data: { tipo_contribuyente: "afecto" } } };
    RESP["propuestas_ia"] = { select: { data: { tipo_dte: null, movimiento_id: "m1", regla_id: null } }, update: { error: null, count: 1 } };
    RESP["movimientos_raw"] = { select: { data: { descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipo_flujo: "entrada", documento_id: "d1" } } };
    await editarPropuesta("p1", { tipo_dte: 41 });
    expect(corregirSpy).not.toHaveBeenCalled();
  });
});
