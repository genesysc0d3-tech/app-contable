import { describe, expect, it } from "vitest";
import { validate } from "./validator";
import type { AdapterConfig, ParsedLine, Row } from "./types";

// Línea válida base; `over` ajusta lo puntual.
const L = (over: Partial<ParsedLine> = {}): ParsedLine => ({
  tipo: "ENTRADA",
  fecha: "2026-06-14",
  monto: 1000,
  descripcion: "mov",
  n_documento: "",
  ...over,
});

const hasError = (r: ReturnType<typeof validate>, frag: string) =>
  r.errors.some((e) => e.includes(frag));
const hasWarn = (r: ReturnType<typeof validate>, frag: string) =>
  r.warnings.some((w) => w.includes(frag));

describe("validate — checks bloqueantes (errores)", () => {
  it("set válido → ok, sin errores", () => {
    const r = validate([L(), L({ tipo: "SALIDA", monto: 2000 })]);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("sin filas → check_1_min_rows", () => {
    const r = validate([]);
    expect(r.ok).toBe(false);
    expect(hasError(r, "check_1_min_rows")).toBe(true);
  });

  it("fecha vacía o demasiado corta → check_2_bad_dates", () => {
    expect(hasError(validate([L({ fecha: "" })]), "check_2_bad_dates")).toBe(true);
    expect(hasError(validate([L({ fecha: "2026" })]), "check_2_bad_dates")).toBe(true);
  });

  it("monto 0 o negativo → check_3_zero_monto", () => {
    expect(hasError(validate([L({ monto: 0 })]), "check_3_zero_monto")).toBe(true);
    expect(hasError(validate([L({ monto: -5 })]), "check_3_zero_monto")).toBe(true);
  });

  it("monto demente (>= 100 mil millones, anti-saldo) → check_4_max_monto_insane", () => {
    const r = validate([L({ monto: 100_000_000_000 })]);
    expect(r.ok).toBe(false);
    expect(hasError(r, "check_4_max_monto_insane")).toBe(true);
  });

  it("demasiadas filas (> 5000) → check_5_too_many_rows", () => {
    const lines = Array.from({ length: 5001 }, () => L());
    expect(hasError(validate(lines), "check_5_too_many_rows")).toBe(true);
  });
});

describe("validate — stats", () => {
  it("cuenta entradas/salidas, suma por tipo y calcula min/max/mediana", () => {
    const r = validate([
      L({ tipo: "ENTRADA", monto: 100 }),
      L({ tipo: "ENTRADA", monto: 300 }),
      L({ tipo: "SALIDA", monto: 200 }),
      L({ tipo: "SALIDA", monto: 400 }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.stats).toMatchObject({
      rows: 4,
      entradas: 2,
      salidas: 2,
      sumEntradas: 400,
      sumSalidas: 600,
      minMonto: 100,
      maxMonto: 400,
      medianMonto: 300,
    });
  });
});

describe("validate — warnings no bloqueantes (>= 20 filas)", () => {
  it("un outlier muy por encima de la mediana → warn_outlier_monto, pero ok", () => {
    const lines: ParsedLine[] = [
      ...Array.from({ length: 20 }, (_, i) =>
        L({ tipo: i % 2 ? "SALIDA" : "ENTRADA", monto: 1000 }),
      ),
      L({ monto: 100_000 }),
    ];
    const r = validate(lines);
    expect(r.ok).toBe(true);
    expect(hasWarn(r, "warn_outlier_monto")).toBe(true);
  });

  it("ratio de tipo_flujo extremo (todo entrada) → warn_extreme_ratio, pero ok", () => {
    const r = validate(Array.from({ length: 20 }, () => L({ monto: 1000 })));
    expect(r.ok).toBe(true);
    expect(hasWarn(r, "warn_extreme_ratio")).toBe(true);
  });
});

describe("validate — check_6 saldo monotonía (solo two_cols con saldo)", () => {
  const cfg: AdapterConfig = {
    header_row: 0,
    skip_rows_before_data: 1,
    date_format: "dd/mm/yyyy",
    number_format: "chilean",
    layout: "two_cols",
    columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 },
  };
  const validLines = [L(), L({ tipo: "SALIDA", monto: 2000 })];

  it("saldo que cuadra con cargo/abono → sin error de monotonía", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargo", "Abono", "Saldo"]];
    let saldo = 1_000_000;
    for (let k = 0; k < 12; k++) {
      saldo += 10_000;
      rows.push([`0${(k % 9) + 1}/06/2026`, "mov", "", "10000", String(saldo)]);
    }
    const r = validate(validLines, rows, cfg);
    expect(r.ok).toBe(true);
    expect(hasError(r, "check_6_saldo_monotonia")).toBe(false);
  });

  it("saldo que NO cuadra (> 20% falla) → check_6_saldo_monotonia", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargo", "Abono", "Saldo"]];
    for (let k = 0; k < 12; k++) {
      // abono 500.000 pero saldo plano: la ecuación de saldo corriente falla
      rows.push([`0${(k % 9) + 1}/06/2026`, "mov", "", "500000", "1000000"]);
    }
    const r = validate(validLines, rows, cfg);
    expect(r.ok).toBe(false);
    expect(hasError(r, "check_6_saldo_monotonia")).toBe(true);
  });

  it("el mismo saldo inconsistente en layout single_col NO dispara check_6 (guard de layout)", () => {
    const rows: Row[] = [["Fecha", "Glosa", "Cargo", "Abono", "Saldo"]];
    for (let k = 0; k < 12; k++) {
      rows.push([`0${(k % 9) + 1}/06/2026`, "mov", "", "500000", "1000000"]);
    }
    const r = validate(validLines, rows, { ...cfg, layout: "single_col" });
    expect(r.ok).toBe(true);
    expect(hasError(r, "check_6_saldo_monotonia")).toBe(false);
  });
});
