import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calcularCuadre } from "./cuadre";
import {
  CONFIANZA_RECUPERADA, esAgregable, fechaIsoValida, leerCuadre, marcarAgregadas, motivoTexto,
  movimientoRecuperado, planAgregar, propuestaRecuperada, resumenCuadre,
} from "./cuadre-mesa";
import { idsRecuperacion, uuidV5 } from "./cuadre-ids";
import type { CensoCartola } from "@/lib/parsers/types";

const censo = (over: Partial<CensoCartola> = {}): CensoCartola => ({
  hoja: "Hoja 1", filas_con_monto: 4, leidas: 4, descartes: [], otras_hojas_con_datos: [], ...over,
});
const fila = (excel_row: number, monto: number, tipo_flujo = "entrada", descripcion = `glosa ${excel_row}`) =>
  ({ excel_row, fecha: "2026-09-04", monto, tipo_flujo, descripcion });

/** Caso LC 2026-09-27 en chico: 2 abonos sin nombre del pagador que no llegaron. */
const cuadreLC = () => calcularCuadre({
  censo: censo(),
  leidas: [fila(2, 100), fila(320, 80000, "entrada", ""), fila(439, 170000, "entrada", ""), fila(5, 30, "salida")],
  filasGuardadas: [2, 5], filasDuplicadas: [], db: { movimientos: 2, propuestas: 2 },
});

const ids = idsRecuperacion("doc-lc");

describe("resumen del cuadre para el visor", () => {
  it("caso LC → 'Faltan 2 por $250.000', 2 de 4 en la mesa, con la lista", () => {
    const r = resumenCuadre(cuadreLC());
    expect(r.estado).toBe("faltan");
    expect(r.faltan).toBe(2);
    expect(r.montoFaltan).toBe(250000);
    expect(r.enSuLugar).toBe(2);
    expect(r.esperadas).toBe(4);
    expect(r.abonos).toBe(250100);
    expect(r.cargos).toBe(30);
    expect(r.filas.map((f) => [f.excelRow, f.glosa, f.monto, f.motivo, f.agregable])).toEqual([
      [320, "Abono sin glosa en la cartola", 80000, "No llegó a la mesa", true],
      [439, "Abono sin glosa en la cartola", 170000, "No llegó a la mesa", true],
    ]);
  });

  it("todo cuadra → 'N de N' y cuenta las repetidas como en su lugar", () => {
    const c = calcularCuadre({
      censo: censo(), leidas: [fila(2, 100), fila(3, 100)],
      filasGuardadas: [2], filasDuplicadas: [3], db: { movimientos: 1, propuestas: 1 },
    });
    const r = resumenCuadre(c);
    expect(r.estado).toBe("cuadra");
    expect([r.enSuLugar, r.esperadas, r.duplicadas]).toEqual([2, 2, 1]);
  });

  it("sin pérdidas pero la DB no confirma → no_calza (no se disfraza de ✓)", () => {
    const c = calcularCuadre({
      censo: censo(), leidas: [fila(2, 100)], filasGuardadas: [2], filasDuplicadas: [], db: { movimientos: 1, propuestas: 0 },
    });
    expect(resumenCuadre(c).estado).toBe("no_calza");
  });

  it("leerCuadre tolera basura y documentos sin cuadre", () => {
    expect(leerCuadre(null)).toBeNull();
    expect(leerCuadre({ estado: "completado" })).toBeNull();
    expect(leerCuadre({ cuadre: { perdidas: "x" } })).toBeNull();
    const c = cuadreLC();
    expect(leerCuadre(JSON.parse(JSON.stringify({ estado: "completado", cuadre: c })))?.perdidas).toHaveLength(2);
  });
});

describe("qué filas se pueden agregar solas", () => {
  it("fecha real + dirección + plata", () => {
    const base = { excel_row: 9, fecha: "2026-09-04", monto: 5000, tipo_flujo: "entrada", motivo: "no_guardada", descripcion: "x" };
    expect(esAgregable(base)).toBe(true);
    expect(esAgregable({ ...base, fecha: null, motivo: "sin_fecha" })).toBe(false);
    expect(esAgregable({ ...base, tipo_flujo: null, motivo: "tipo_desconocido" })).toBe(false);
    expect(esAgregable({ ...base, monto: 0 })).toBe(false);
  });
  it("una fecha imposible no pasa (32/13)", () => {
    expect(fechaIsoValida("2026-13-32")).toBe(false);
    expect(fechaIsoValida("2026-02-30")).toBe(false);
    expect(fechaIsoValida("2026-09-04")).toBe(true);
  });
  it("las no agregables se listan igual, pero no entran al plan", () => {
    const c = calcularCuadre({
      censo: censo({ descartes: [{ excel_row: 9, motivo: "sin_fecha", legitimo: false, fecha: null, monto: 5000, tipo_flujo: "entrada", descripcion: "x" }] }),
      leidas: [fila(2, 100), fila(3, 700)], filasGuardadas: [2], filasDuplicadas: [], db: { movimientos: 1, propuestas: 1 },
    });
    const r = resumenCuadre(c);
    expect([r.faltan, r.agregables]).toEqual([2, 1]);
    expect(r.filas.find((f) => f.excelRow === 9)?.motivo).toBe("Sin fecha");
    expect(planAgregar(c, ids).map((p) => c.perdidas[p.idx].excel_row)).toEqual([3]);
  });
});

describe("Agregarlos: idempotente y deja la cartola cuadrada", () => {
  it("después de agregar → '4 de 4 ✓' y un segundo click no agrega nada", () => {
    const c = cuadreLC();
    const plan = planAgregar(c, ids);
    expect(plan).toHaveLength(2);
    const final = marcarAgregadas(c, plan, new Date("2026-09-28T12:00:00Z"));
    const r = resumenCuadre(final);
    expect(r.estado).toBe("cuadra");
    expect([r.enSuLugar, r.esperadas]).toEqual([4, 4]);
    expect(final.ok).toBe(true);
    expect(final.monto_perdido).toBe(0);
    expect(final.db).toEqual({ movimientos: 4, propuestas: 4, ok: true });
    expect(final.perdidas.every((p) => p.agregada)).toBe(true);
    expect(planAgregar(final, ids)).toEqual([]);
    // Marcar de nuevo lo mismo no infla lo guardado.
    expect(marcarAgregadas(final, plan).guardadas).toBe(4);
  });

  it("dos pestañas con la MISMA foto vieja → cero duplicados (ids deterministas)", () => {
    const foto = cuadreLC();
    const planA = planAgregar(foto, idsRecuperacion("doc-lc"));
    const planB = planAgregar(JSON.parse(JSON.stringify(foto)), idsRecuperacion("doc-lc"));
    // Simula la tabla con upsert ignoreDuplicates por id.
    const tabla = new Map<string, unknown>();
    for (const f of [...planA, ...planB]) {
      if (!tabla.has(f.movimiento_id)) tabla.set(f.movimiento_id, f);
    }
    expect(tabla.size).toBe(2);
    expect(planB).toEqual(planA);
    // Movimiento y propuesta nunca comparten id; otro documento, otros ids.
    expect(planA[0].movimiento_id).not.toBe(planA[0].propuesta_id);
    expect(planAgregar(foto, idsRecuperacion("otro-doc"))[0].movimiento_id).not.toBe(planA[0].movimiento_id);
  });

  it("uuid v5 correcto (vector conocido de RFC 4122: DNS 'www.example.com')", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("el movimiento nace con la forma del processor y la glosa rellena", () => {
    const c = cuadreLC();
    const m = movimientoRecuperado(c.perdidas[0], { id: "m1", empresaId: "e1", documentoId: "d1" });
    expect(m).toEqual({
      id: "m1", empresa_id: "e1", documento_id: "d1", fecha: "2026-09-04",
      descripcion: "Abono sin glosa en la cartola", monto: 80000, tipo_flujo: "entrada",
      origen: "cartola_preparseada", n_documento: null,
    });
  });

  it("la propuesta nace NEUTRA como el fallback del processor: nunca boleta afecta por defecto", () => {
    const c = cuadreLC();
    const p = propuestaRecuperada(c.perdidas[0], { id: "p1", movimientoId: "m1", empresaId: "e1", mesa: "boleta" });
    expect(p).toMatchObject({
      estado: "pendiente", tipo_propuesto: "no_comercial", tipo_dte: null, notas: null,
      receptor_rut: null, total: 80000, monto_neto: 80000, iva: 0, confianza: 0.4,
    });
    expect(CONFIANZA_RECUPERADA).toBeLessThan(0.8);
    const cargo = propuestaRecuperada({ ...c.perdidas[0], tipo_flujo: "salida" }, { id: "p2", movimientoId: "m2", empresaId: "e1", mesa: "boleta" });
    expect(cargo).toMatchObject({ tipo_propuesto: "gasto_egreso", iva: 0 });
  });
});

// Test de FUENTE: el botón llega al server action y el server action tiene el
// mismo guard que el resto de la mesa (rol, cuenta, empresa, modo soporte) y
// escribe idempotente.
describe("cableado del cuadre", () => {
  const v5 = join(__dirname, "../../app/(app)/escritorio/v5");
  const leer = (f: string) => readFileSync(join(v5, f), "utf8");
  it("el visor de la cartola muestra el cuadre y recarga la mesa al agregar", () => {
    expect(leer("VeredictoCartola.tsx")).toMatch(/<CuadreCartolaLinea documentoId=\{doc\.id\} resumen=\{resCuadre\}/);
    expect(leer("MesaTab.tsx")).toMatch(/onCuadreAgregado=\{reload\}/);
    // Con 0 propuestas (se perdió todo) el visor igual aparece: ahí vive el botón.
    expect(leer("MesaTab.tsx")).toMatch(/\(selProps\.length > 0 \|\| selCuadreFaltan\)/);
    expect(leer("VeredictoCartola.tsx")).toMatch(/En tu cartola: Abonos/);
    expect(leer("CuadreCartolaLinea.tsx")).toMatch(/agregarFilasFaltantes\(documentoId\)/);
  });
  it("el server action lleva guard y upsert idempotente", () => {
    const src = leer("cuadre-actions.ts");
    expect(src).toMatch(/getDevSupportWriteBlock\(/);
    expect(src).toMatch(/ROLES_EMISION\.has/);
    expect(src).toMatch(/validarAccesoCuenta\(sb, user\.id, empresaId\)/);
    expect(src).toMatch(/\.eq\("empresa_id", empresaId\)/);
    expect(src).toMatch(/planAgregar\(cuadre, idsRecuperacion\(documentoId\)\)/);
    expect(src).not.toMatch(/randomUUID/);
    // Relee progreso_ia justo antes de escribir el cuadre final.
    expect(src).toMatch(/const \{ data: fresco \}[\s\S]*marcarAgregadas\(leerCuadre\(progresoFresco\)/);
    expect(src.match(/ignoreDuplicates: true/g)?.length).toBe(2);
  });
});

describe("esAgregable — solo filas bien leídas que no llegaron a la mesa (revisión final)", () => {
  const base = { fila: 12, fecha: "2026-09-04", monto: 170000, tipo_flujo: "entrada", descripcion: "Transf", legitimo: false } as const;
  it("no_guardada con fecha real → sí", () => {
    expect(esAgregable({ ...base, motivo: "no_guardada" } as never)).toBe(true);
  });
  it("fecha_fuera_de_rango trae una ISO válida (1999/2091) → NUNCA se agrega", () => {
    expect(esAgregable({ ...base, fecha: "1999-06-14", motivo: "fecha_fuera_de_rango" } as never)).toBe(false);
    expect(esAgregable({ ...base, fecha: "2091-01-01", motivo: "fecha_fuera_de_rango" } as never)).toBe(false);
  });
  it("fecha_imposible → no", () => {
    expect(esAgregable({ ...base, motivo: "fecha_imposible" } as never)).toBe(false);
  });
  it("los motivos nuevos tienen su texto", () => {
    expect(motivoTexto("fecha_imposible")).toBe("Fecha imposible");
    expect(motivoTexto("fecha_fuera_de_rango")).toBe("Fecha fuera de rango");
  });
});
