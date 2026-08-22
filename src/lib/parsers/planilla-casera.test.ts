import { describe, expect, it } from "vitest";
import { detectHeuristic } from "./heuristic";
import { applyAdapter } from "./apply";
import { validate } from "./validator";
import type { Row } from "./types";

/**
 * Caso real (planilla M&E 2026-08-22, replicado sintético): libro de ventas
 * casero con fechas NATIVAS de Excel (Date), sin columna de descripción,
 * monto CLP + comisión conviviendo en cada fila, negativos (bolívares),
 * filas fantasma y columnas basura. Antes: invisible para los detectores →
 * capa legacy → IA (3 días de errores 500). Ahora: transactions_log directo.
 */

function filaVenta(n: number, dia: number, montoCLP: number): Row {
  // [N°, fecha Date, monto CLP, vacío, comisión, bolívares negativos]
  return [n, new Date(2026, 7, dia) as unknown as string, montoCLP, "", Math.round(montoCLP * 0.03), -(montoCLP / 208.75)] as unknown as Row;
}

function planillaCasera(): Row[] {
  const rows: Row[] = [[], []]; // 2 filas vacías arriba (como la real)
  for (let i = 0; i < 40; i++) {
    rows.push(filaVenta(i + 3, 8 + (i % 12), 10000 + i * 3500));
  }
  // Filas fantasma al final (la real traía 1.005)
  for (let i = 0; i < 30; i++) rows.push([]);
  return rows;
}

describe("planilla casera fecha+monto (sin descripción)", () => {
  it("detecta transactions_log con la columna CLP como monto", () => {
    const cfg = detectHeuristic(planillaCasera());
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBe("transactions_log");
    expect(cfg!.columns.monto).toBe(2);        // CLP, no la comisión ni el N°
    expect(cfg!.columns.fecha).toBe(1);
    expect(cfg!.columns.descripcion).toBe(-1); // sin glosa: válido
    expect(cfg!.default_tipo_flujo).toBe("entrada");
  });

  it("extrae todas las filas como ENTRADA con el monto CLP y pasa el validador", () => {
    const rows = planillaCasera();
    const cfg = detectHeuristic(rows)!;
    const lines = applyAdapter(rows, cfg);
    expect(lines).toHaveLength(40);
    expect(lines.every((l) => l.tipo === "ENTRADA")).toBe(true);
    expect(lines[0].monto).toBe(10000);
    expect(lines[0].fecha).toBe("2026-08-08");
    expect(validate(lines, rows, cfg).ok).toBe(true);
  });

  it("two_cols NO se roba el par monto+comisión (exclusividad dura)", () => {
    // Regresión del bug: two_cols elegía CLP como cargo y comisión como abono
    // (conviven en cada fila → no son cargo/abono) y extraía basura validada.
    const cfg = detectHeuristic(planillaCasera())!;
    expect(cfg.layout).not.toBe("two_cols");
  });

  it("una cartola two_cols real (cargo XOR abono) sigue siendo two_cols", () => {
    const rows: Row[] = [["Fecha", "Descripción", "Cargo", "Abono", "Saldo"]];
    let saldo = 1_000_000;
    for (let i = 0; i < 10; i++) {
      const esCargo = i % 2 === 0;
      const monto = 20000 + i * 1000;
      saldo += esCargo ? -monto : monto;
      rows.push([
        `0${(i % 9) + 1}/08/2026`,
        `Movimiento bancario número ${i} de prueba`,
        esCargo ? monto : "",
        esCargo ? "" : monto,
        saldo,
      ] as unknown as Row);
    }
    const cfg = detectHeuristic(rows);
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBe("two_cols");
  });

  it("sin descripción Y con montos sucios (<90% monetarios) NO adivina", () => {
    // Sin glosa el umbral del monto sube a 90%: una columna donde ~15% de los
    // valores no son montos plausibles (IDs chicos mezclados) no se adjudica.
    const rows: Row[] = [[], []];
    for (let i = 0; i < 20; i++) {
      const monto = i % 6 === 0 ? 7 : 15000 + i * 1000; // ~17% basura
      rows.push([i + 1, new Date(2026, 7, 8 + (i % 10)) as unknown as string, monto] as unknown as Row);
    }
    const cfg = detectHeuristic(rows);
    if (cfg && cfg.layout === "transactions_log") {
      expect(cfg.columns.descripcion).not.toBe(-1);
    }
  });

  it("fechas como serial de Excel también se detectan", () => {
    const rows: Row[] = [[]];
    for (let i = 0; i < 12; i++) {
      // 46251 ≈ 2026-08-17 (serial Excel)
      rows.push([i + 1, 46240 + i, 25000 + i * 500] as unknown as Row);
    }
    const cfg = detectHeuristic(rows);
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBe("transactions_log");
    expect(cfg!.columns.fecha).toBe(1);
  });
});
