import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calcularCuadre } from "./cuadre";
import {
  CONFIANZA_RECUPERADA, esAgregable, fechaIsoValida, leerCuadre, marcarAgregadas,
  movimientoRecuperado, planAgregar, propuestaRecuperada, resumenCuadre,
} from "./cuadre-mesa";
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

let n = 0;
const ids = () => `id-${++n}`;

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

  it("con una reserva previa (click anterior o corte) se reusan LOS MISMOS ids", () => {
    const c = cuadreLC();
    const reservado = { ...c, recuperacion: { desde: "2026-09-28T12:00:00Z", filas: planAgregar(c, ids) } };
    const otra = planAgregar(reservado, ids);
    expect(otra).toEqual(reservado.recuperacion.filas);
    expect(marcarAgregadas(reservado, otra).recuperacion).toBeUndefined();
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

  it("la propuesta nace pendiente, bajo 'Poner listas', sin tipo_dte ni notas", () => {
    const c = cuadreLC();
    const p = propuestaRecuperada(c.perdidas[0], { id: "p1", movimientoId: "m1", empresaId: "e1", mesa: "boleta", exento: false });
    expect(p).toMatchObject({ estado: "pendiente", tipo_propuesto: "boleta", tipo_dte: null, notas: null, receptor_rut: null, total: 80000, iva: 80000 - Math.round(80000 / 1.19) });
    expect(CONFIANZA_RECUPERADA).toBeLessThan(0.8);
    const ex = propuestaRecuperada(c.perdidas[0], { id: "p1", movimientoId: "m1", empresaId: "e1", mesa: "boleta", exento: true });
    expect(ex).toMatchObject({ tipo_propuesto: "exenta", iva: 0, monto_neto: 80000 });
    const cargo = propuestaRecuperada({ ...c.perdidas[0], tipo_flujo: "salida" }, { id: "p2", movimientoId: "m2", empresaId: "e1", mesa: "boleta", exento: false });
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
    expect(leer("CuadreCartolaLinea.tsx")).toMatch(/agregarFilasFaltantes\(documentoId\)/);
  });
  it("el server action lleva guard y upsert idempotente", () => {
    const src = leer("cuadre-actions.ts");
    expect(src).toMatch(/getDevSupportWriteBlock\(/);
    expect(src).toMatch(/ROLES_EMISION\.has/);
    expect(src).toMatch(/validarAccesoCuenta\(sb, user\.id, empresaId\)/);
    expect(src).toMatch(/\.eq\("empresa_id", empresaId\)/);
    expect(src).toMatch(/\.is\("progreso_ia->cuadre->recuperacion", null\)/);
    expect(src.match(/ignoreDuplicates: true/g)?.length).toBe(2);
  });
});
