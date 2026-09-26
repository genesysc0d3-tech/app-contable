import { describe, expect, it } from "vitest";
import { detectHeuristic } from "./heuristic";
import { applyAdapter } from "./apply";
import { validate } from "./validator";
import type { AdapterConfig, Row } from "./types";

// Incidente LC 2026-09-26: cartola BCI "Movimientos Detallado" (.xlsx). Lo más
// nuevo ARRIBA, "Ingreso (+)" a la IZQUIERDA de "Egreso (-)", fechas como Date
// nativo (cellDates) y una columna "Código de transacción" (hash sin espacios)
// más larga que la glosa. La heurística vieja invirtió ingreso/egreso, tomó el
// hash como descripción, y el check de saldo se saltó todas las filas porque
// buscaba fechas en TEXTO. Datos 100% sintéticos.
function cartolaBci(n = 40): Row[] {
  const header = [
    "Fecha de transacción", "Hora transacción", "Fecha contable", "Código de transacción",
    "Código Transferencia", "Tipo de transacción", "Numero serie", "Glosa detalle",
    "Ingreso (+)", "Egreso (-)", "Saldo contable", "Nombre",
  ];
  // Se construye de lo más VIEJO a lo más nuevo y después se invierte (así lo exporta BCI).
  const asc: Row[] = [];
  let saldo = 1_000_000;
  for (let i = 0; i < n; i++) {
    const esEgreso = i % 7 === 3;
    const monto = 10_000 + ((i * 7919) % 90) * 1_000;
    saldo += esEgreso ? -monto : monto;
    const dia = 1 + Math.floor(i / 2);
    // Row no declara Date, pero XLSX con cellDates:true sí las entrega (así llegan en prod).
    asc.push(([
      new Date(Date.UTC(2026, 8, dia, 12)), `1${i % 10}:00`, new Date(Date.UTC(2026, 8, dia, 12)),
      `D5D76EB61DB98F697D346006F73B22F26229444E|90107169656710${String(10000 + i)}`,
      `0021425${String(10000 + i)}`, "TRANSFERENCIA", null,
      esEgreso ? `Transferencia a Persona Ficticia ${i}` : `Transferencia recibida de Cliente Ficticio ${i}`,
      esEgreso ? null : monto, esEgreso ? monto : null, saldo, `Persona Ficticia ${i}`,
    ] as unknown) as Row);
  }
  return [header, ...asc.reverse()];
}

describe("cartola BCI Movimientos Detallado (incidente LC 2026-09-26)", () => {
  it("la heurística toma la glosa (no el código) y orienta ingreso/egreso por el saldo", () => {
    const rows = cartolaBci();
    const cfg = detectHeuristic(rows)!;
    expect(cfg).not.toBeNull();
    expect(cfg.columns.descripcion).toBe(7); // "Glosa detalle", no el hash de la col 3
    expect(cfg.columns.abono).toBe(8); // "Ingreso (+)"
    expect(cfg.columns.cargo).toBe(9); // "Egreso (-)"
    const lines = applyAdapter(rows, cfg);
    const v = validate(lines, rows, cfg);
    expect(v.ok).toBe(true);
    const recibidas = lines.filter((l) => /recibida/.test(String(l.descripcion)));
    expect(recibidas.length).toBeGreaterThan(0);
    expect(recibidas.every((l) => l.tipo === "ENTRADA")).toBe(true);
  });

  it("el validador rechaza el adaptador invertido aunque las fechas vengan como Date", () => {
    const rows = cartolaBci();
    const invertido: AdapterConfig = {
      layout: "two_cols",
      columns: { fecha: 0, descripcion: 3, n_documento: 4, cargo: 8, abono: 9, saldo: 10 },
      header_row: 0,
      date_format: "unknown",
      number_format: "chilean",
      skip_rows_before_data: 1,
    } as AdapterConfig;
    const v = validate(applyAdapter(rows, invertido), rows, invertido);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/check_6_saldo_monotonia/);
  });

  it("sin saldo, el encabezado decide la orientación", () => {
    const rows = cartolaBci().map((r) => r.map((c, i) => (i === 10 ? null : c)));
    const cfg = detectHeuristic(rows)!;
    expect(cfg).not.toBeNull();
    expect(cfg.columns.abono).toBe(8);
    expect(cfg.columns.cargo).toBe(9);
  });
});
