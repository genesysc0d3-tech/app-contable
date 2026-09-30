import { describe, expect, it } from "vitest";
import { detectHeuristic } from "./heuristic";
import { applyAdapter } from "./apply";
import { validate } from "./validator";
import type { DescarteFila, Row } from "./types";
import { exacto, todasLasCartolas } from "./testing/sabotajes";

// Punto 4: en two_cols el saldo/cargo/abono se eligen PROBANDO la ecuación del
// saldo sobre todas las columnas numéricas candidatas (como ya hacía single_col,
// heuristic.ts:465-485 viejo), con reglas de FORMA para el rol grueso: un
// correlativo (5000, 5001…) nunca es saldo, un RUT nunca es plata, "$ 1.234" sí.
// Los casos son los que el experimento del 2026-09-30 encontró mal leídos.

const casos = new Map(todasLasCartolas().map((c) => [c.nombre, c]));

function leer(nombre: string) {
  const c = casos.get(nombre)!;
  const cfg = detectHeuristic(c.rows);
  expect(cfg, `${nombre}: la heurística no reconoció nada`).not.toBeNull();
  const d: DescarteFila[] = [];
  const lines = applyAdapter(c.rows, cfg!, d);
  return { cfg: cfg!, lines, v: validate(lines, c.rows, cfg!, d), ex: exacto(lines, c.verdad) };
}

describe("two_cols por ecuación del saldo", () => {
  it.each([
    "estado/titulos_ingles",
    "estado/titulos_genericos",
    "estado/sin_titulos",
  ])("%s: '$ 1.234.567' es plata; el saldo NO se toma como monto", (nombre) => {
    const r = leer(nombre);
    expect(r.cfg.layout ?? "two_cols").toBe("two_cols");
    expect(r.ex.detalle).toBe("");
    expect(r.v.ok).toBe(true);
  });

  it.each([
    "itau/titulos_ingles",
    "itau/titulos_genericos",
    "itau/sin_titulos",
  ])("%s: un correlativo (N° Docto 5000, 5001…) nunca es saldo", (nombre) => {
    const r = leer(nombre);
    expect(r.cfg.columns.saldo).toBe(6);
    expect(r.ex.detalle).toBe("");
    expect(r.v.ok).toBe(true);
  });

  it("bci/columna_insertada: un RUT no es plata; gana la terna que cierra la ecuación", () => {
    const r = leer("bci/columna_insertada");
    expect(r.cfg.columns.saldo).toBe(9);
    expect(r.ex.detalle).toBe("");
    expect(r.v.ok).toBe(true);
  });
});

describe("single_col por ecuación (banderas de una letra)", () => {
  it("santander/columnas_movidas: la bandera A/C cuenta para la ecuación; el saldo no es el monto", () => {
    const r = leer("santander/columnas_movidas");
    expect(r.cfg.layout).toBe("single_col");
    expect(r.cfg.columns.monto).toBe(6);
    expect(r.cfg.columns.saldo).toBe(0);
    expect(r.ex.detalle).toBe("");
  });
});

describe("transactions_log nunca toma un saldo explicado por otra columna", () => {
  it("si una columna es el saldo corrido de otra, no se lee 'todo entrada'", () => {
    const rows: Row[] = [["Fecha", "Detalle", "Col A", "Col B"]];
    let saldo = 500_000;
    for (let i = 1; i <= 10; i++) {
      const monto = 1000 * (((i * 7) % 11) + 1) + 350;
      saldo += i % 2 ? monto : -monto;
      rows.push([`${String(i).padStart(2, "0")}/09/2026`, "Movimiento de la cuenta corriente", monto, saldo]);
    }
    const cfg = detectHeuristic(rows);
    // Sin bandera de dirección no hay cómo saber qué entra y qué sale: mejor
    // no reconocer (capa siguiente / cliente) que leer todo como entrada.
    if (cfg) expect(cfg.layout).not.toBe("transactions_log");
  });
});
