/**
 * Fase 3 — acuñar con historial: una regla NUEVA nace a prueba, sin el tercero en el
 * nombre, con de dónde nació y su soporte (la cartola que la enseñó). Re-acuñar suma
 * veces_acunada (no veces_aplicada) y NUNCA pisa el tipo de una regla existente: eso
 * es una corrección (reglas-historial.ts), que baja de nivel en vez de pisar.
 */
import { describe, expect, it } from "vitest";
import { aprenderReglaDesdeResolucion } from "./aprender-regla";

type Op = { tabla: string; op: string; payload?: Record<string, unknown>; opciones?: unknown };

function fakeSb(o: { hint?: string | null; previa?: Record<string, unknown> | null } = {}) {
  const ops: Op[] = [];
  const sb = {
    from(tabla: string) {
      let op = "select";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "eq", "limit", "in", "is", "ilike", "order", "neq", "not"]) b[m] = () => b;
      b.insert = (payload: Record<string, unknown>) => { op = "insert"; ops.push({ tabla, op, payload }); return b; };
      b.update = (payload: Record<string, unknown>) => { op = "update"; ops.push({ tabla, op, payload }); return b; };
      b.upsert = (payload: Record<string, unknown>, opciones: unknown) => { op = "upsert"; ops.push({ tabla, op, payload, opciones }); return b; };
      const res = () => {
        if (op === "insert" && tabla === "clasificacion_reglas") return { data: { id: "nueva" }, error: null };
        if (op !== "select") return { data: null, error: null, count: 0 };
        if (tabla === "clasificacion_reglas") return { data: o.previa ? [o.previa] : [], error: null };
        if (tabla === "documentos_subidos") return { data: { tipo_operacion_hint: o.hint ?? null }, error: null };
        return { data: [], error: null };
      };
      b.maybeSingle = () => Promise.resolve(res());
      b.single = () => Promise.resolve(res());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.then = (ok: any, ko: any) => Promise.resolve(res()).then(ok, ko);
      return b;
    },
  };
  return { sb: sb as never, ops };
}

const base = {
  empresaId: "E1", userId: "U1", documentoId: "D1", movimientoId: "M1",
  descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipoFlujo: "entrada" as const, canal: "check_detalle",
};

describe("acuñar una regla NUEVA", () => {
  it("nace a_prueba, nombre SIN el tercero, veces_acunada=1, con hint/canal/documento de origen", async () => {
    const { sb, ops } = fakeSb({ hint: "ventas_servicios" });
    const r = await aprenderReglaDesdeResolucion(sb, { ...base, tipoDte: 41 });
    expect(r.creada).toBe(true);
    const ins = ops.find((x) => x.tabla === "clasificacion_reglas" && x.op === "insert")!.payload!;
    expect(ins).toMatchObject({
      estado: "a_prueba", nombre: "Contraparte aprendida · Exenta", veces_acunada: 1,
      nacio_hint: "ventas_servicios", nacio_carril: "check_detalle", documento_origen_id: "D1",
      tipo_dte: 41, confianza: 0.95, aprendida_bajo_marca: false,
    });
    expect(String(ins.nombre)).not.toMatch(/juan|perez/i);
    expect(ins).not.toHaveProperty("veces_aplicada");
  });
  it("deja su soporte: la cartola (y el movimiento) que la enseñó, rol acuno", async () => {
    const { sb, ops } = fakeSb();
    await aprenderReglaDesdeResolucion(sb, { ...base, tipoDte: 39 });
    const sop = ops.find((x) => x.tabla === "clasificacion_regla_soportes");
    expect(sop?.op).toBe("upsert");
    expect(sop?.payload).toMatchObject({ regla_id: "nueva", documento_id: "D1", empresa_id: "E1", movimiento_id: "M1", rol: "acuno" });
  });
  it("Afecta sobre cartola P2P en lote chico → aprendida_bajo_marca (ya no confianza 0.99)", async () => {
    const { sb, ops } = fakeSb({ hint: "p2p_cripto" });
    await aprenderReglaDesdeResolucion(sb, { ...base, tipoDte: 39, tamanoLote: 3 });
    const ins = ops.find((x) => x.tabla === "clasificacion_reglas" && x.op === "insert")!.payload!;
    expect(ins).toMatchObject({ aprendida_bajo_marca: true, confianza: 0.95 });
  });
});

describe("re-acuñar una regla EXISTENTE (dedup)", () => {
  it("mismo tipo: suma veces_acunada (no veces_aplicada) y no toca el tipo", async () => {
    const previa = { id: "r1", tipo_dte: 41, estado: "firme", activa: true, veces_acunada: 2, aprendida_bajo_marca: false };
    const { sb, ops } = fakeSb({ previa });
    const r = await aprenderReglaDesdeResolucion(sb, { ...base, tipoDte: 41 });
    expect(r.actualizada).toBe(true);
    const upd = ops.find((x) => x.tabla === "clasificacion_reglas" && x.op === "update")!.payload!;
    expect(upd).toMatchObject({ veces_acunada: 3 });
    expect(upd).not.toHaveProperty("veces_aplicada");
    expect(upd).not.toHaveProperty("tipo_dte");
    expect(upd).not.toHaveProperty("estado");
  });
  it("tipo DISTINTO: NO pisa el tipo de la regla (eso es una corrección, no un acuñar)", async () => {
    const previa = { id: "r1", tipo_dte: 41, estado: "firme", activa: true, veces_acunada: 2, aprendida_bajo_marca: false };
    const { sb, ops } = fakeSb({ previa });
    const r = await aprenderReglaDesdeResolucion(sb, { ...base, tipoDte: 39 });
    expect(r.actualizada).toBe(false);
    const upds = ops.filter((x) => x.tabla === "clasificacion_reglas" && x.op === "update");
    for (const u of upds) expect(u.payload).not.toHaveProperty("tipo_dte");
  });
  it("una DESHECHA que se vuelve a enseñar renace a prueba con el tipo nuevo y sin el tercero", async () => {
    const previa = { id: "r1", tipo_dte: 41, estado: "deshecha", activa: false, veces_acunada: 1, aprendida_bajo_marca: false };
    const { sb, ops } = fakeSb({ previa });
    await aprenderReglaDesdeResolucion(sb, { ...base, tipoDte: 39 });
    const upd = ops.find((x) => x.tabla === "clasificacion_reglas" && x.op === "update")!.payload!;
    expect(upd).toMatchObject({ estado: "a_prueba", activa: true, tipo_dte: 39, nombre: "Contraparte aprendida · Afecta", veces_acunada: 2 });
  });
});
