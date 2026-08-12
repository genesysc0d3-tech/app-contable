import { describe, expect, it } from "vitest";
import {
  applyAdapter,
  linesToPreExtracted,
  normalizeDate,
  parseChileanNumber,
  serializeLines,
} from "./apply";
import type { AdapterConfig, ParsedLine, Row } from "./types";

// --- Config factories (override puntual con `over`) -----------------------

const twoCols = (over: Partial<AdapterConfig> = {}): AdapterConfig => ({
  header_row: 0,
  skip_rows_before_data: 1,
  date_format: "dd/mm/yyyy",
  number_format: "chilean",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 },
  ...over,
});

const singleCol = (over: Partial<AdapterConfig> = {}): AdapterConfig => ({
  header_row: 0,
  skip_rows_before_data: 1,
  date_format: "dd-mm-yyyy",
  number_format: "chilean",
  layout: "single_col",
  columns: { fecha: 0, descripcion: 1, n_documento: 2, cargo: -1, abono: -1, saldo: -1, monto: 3, tipo_flujo_col: 4 },
  ...over,
});

const txLog = (over: Partial<AdapterConfig> = {}): AdapterConfig => ({
  header_row: 0,
  skip_rows_before_data: 1,
  date_format: "dd/mm/yyyy",
  number_format: "chilean",
  layout: "transactions_log",
  columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: -1, abono: -1, saldo: -1, monto: 2 },
  ...over,
});

// --- parseChileanNumber ----------------------------------------------------

describe("parseChileanNumber — montos CLP con separadores chilenos", () => {
  it("vacío / null / undefined / espacios → 0", () => {
    expect(parseChileanNumber(null)).toBe(0);
    expect(parseChileanNumber(undefined)).toBe(0);
    expect(parseChileanNumber("")).toBe(0);
    expect(parseChileanNumber("   ")).toBe(0);
  });

  it("quita puntos de miles", () => {
    expect(parseChileanNumber("1.600.000")).toBe(1_600_000);
    expect(parseChileanNumber("80.000")).toBe(80_000);
  });

  it("acepta números crudos", () => {
    expect(parseChileanNumber(5000)).toBe(5000);
    expect(parseChileanNumber(0)).toBe(0);
  });

  it("ignora símbolos de moneda y espacios internos", () => {
    expect(parseChileanNumber("$ 1.000")).toBe(1000);
    expect(parseChileanNumber(" 250 ")).toBe(250);
  });

  it("respeta el signo negativo (cargos)", () => {
    expect(parseChileanNumber("-1.500")).toBe(-1500);
  });

  it("la COMA es decimal chileno → corta la fracción (no ×100)", () => {
    // '.' = miles, ',' = decimal. '53.000,00' = 53000, NO 5.300.000.
    expect(parseChileanNumber("1.234,56")).toBe(1234);
    expect(parseChileanNumber("53.000,00")).toBe(53000);
    expect(parseChileanNumber("-1.500,99")).toBe(-1500);
  });

  it("números crudos con fracción → redondea (celdas xlsx, no ×10)", () => {
    expect(parseChileanNumber(53000)).toBe(53000);
    expect(parseChileanNumber(53000.5)).toBe(53001);
    expect(parseChileanNumber(53000.55)).toBe(53001);
  });

  it("texto no numérico → 0", () => {
    expect(parseChileanNumber("abc")).toBe(0);
    expect(parseChileanNumber("-")).toBe(0); // parseInt('-') = NaN → 0
  });
});

// --- normalizeDate ---------------------------------------------------------

describe("normalizeDate — a ISO yyyy-mm-dd", () => {
  it("dd/mm/yyyy y dd-mm-yyyy → ISO con padding", () => {
    expect(normalizeDate("14/06/2026", "dd/mm/yyyy")).toBe("2026-06-14");
    expect(normalizeDate("14-06-2026", "dd-mm-yyyy")).toBe("2026-06-14");
    expect(normalizeDate("4/6/2026", "dd/mm/yyyy")).toBe("2026-06-04");
  });

  it("formato 'unknown' usa la heurística dd/mm/yyyy", () => {
    expect(normalizeDate("14/06/2026", "unknown")).toBe("2026-06-14");
  });

  it("año de 2 dígitos: pivote en 50 (>50 = 19xx, <=50 = 20xx)", () => {
    expect(normalizeDate("14/06/26", "dd/mm/yyyy")).toBe("2026-06-14");
    expect(normalizeDate("14/06/99", "dd/mm/yyyy")).toBe("1999-06-14");
    expect(normalizeDate("14/06/50", "dd/mm/yyyy")).toBe("2050-06-14");
    expect(normalizeDate("14/06/51", "dd/mm/yyyy")).toBe("1951-06-14");
  });

  it("yyyy-mm-dd con padding", () => {
    expect(normalizeDate("2026-06-14", "yyyy-mm-dd")).toBe("2026-06-14");
    expect(normalizeDate("2026/6/4", "yyyy-mm-dd")).toBe("2026-06-04");
  });

  it("último recurso: parsea dd/mm/yyyy aunque el formato declarado sea yyyy-mm-dd", () => {
    expect(normalizeDate("14/06/2026", "yyyy-mm-dd")).toBe("2026-06-14");
  });

  it("null / vacío → ''", () => {
    expect(normalizeDate(null, "dd/mm/yyyy")).toBe("");
    expect(normalizeDate("", "dd/mm/yyyy")).toBe("");
  });

  it("no parseable → devuelve el string tal cual (no inventa fecha)", () => {
    expect(normalizeDate("no-es-fecha", "dd/mm/yyyy")).toBe("no-es-fecha");
  });
});

// --- applyAdapter: two_cols ------------------------------------------------

describe("applyAdapter — layout two_cols (cargo/abono separados)", () => {
  const rows: Row[] = [
    ["Fecha", "Glosa", "Cargo", "Abono", "Saldo"], // header (se salta)
    ["14/06/2026", "Pago cliente", "", "100.000", "500.000"], // abono → ENTRADA
    ["15/06/2026", "Compra insumos", "20.000", "", "480.000"], // cargo → SALIDA
    ["16/06/2026", "Saldo inicial", "", "", "500.000"], // ambos 0 → metadata, se salta
    ["17/06/2026", "Fila rara", "5.000", "3.000", "x"], // ambos != 0 → ambiguo, se salta
    ["", "Sin fecha", "", "9.000", ""], // sin fecha → se salta
  ];

  it("clasifica abono=ENTRADA y cargo=SALIDA, normaliza fecha y monto", () => {
    const lines = applyAdapter(rows, twoCols());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ tipo: "ENTRADA", fecha: "2026-06-14", monto: 100_000, descripcion: "Pago cliente", saldo: 500_000 });
    expect(lines[1]).toMatchObject({ tipo: "SALIDA", fecha: "2026-06-15", monto: 20_000, descripcion: "Compra insumos", saldo: 480_000 });
  });

  it("excel_row es 1-based sobre la fila original (cuenta las filas saltadas)", () => {
    const lines = applyAdapter(rows, twoCols());
    expect(lines[0].excel_row).toBe(2); // rows[1]
    expect(lines[1].excel_row).toBe(3); // rows[2]
  });

  it("n_documento '' cuando la columna no existe (-1)", () => {
    const lines = applyAdapter(rows, twoCols());
    expect(lines[0].n_documento).toBe("");
  });

  it("respeta skip_rows_before_data (no toma encabezado ni filas previas como dato)", () => {
    const lines = applyAdapter(rows, twoCols({ skip_rows_before_data: 2 }));
    expect(lines).toHaveLength(1);
    expect(lines[0].descripcion).toBe("Compra insumos");
  });

  it("sin columna saldo (-1) → saldo undefined", () => {
    const cfg = twoCols({ columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: -1 } });
    const lines = applyAdapter(rows, cfg);
    expect(lines[0].saldo).toBeUndefined();
  });
});

// --- applyAdapter: single_col ----------------------------------------------

describe("applyAdapter — layout single_col (monto + columna tipo)", () => {
  const rows: Row[] = [
    ["Fecha", "Desc", "NDoc", "Monto", "Tipo"],
    ["14-06-2026", "Venta", "D001", "50.000", "Abono"], // palabra → ENTRADA
    ["15-06-2026", "Giro", "D002", "30.000", "Cargo"], // palabra → SALIDA
    ["16-06-2026", "Letra A", "D003", "10.000", "A"], // letra única → ENTRADA
    ["17-06-2026", "Letra C", "D004", "12.000", "C"], // letra única → SALIDA
    ["18-06-2026", "Tipo ilegible", "D005", "9.000", "???"], // tipo no reconocido → se salta
    ["19-06-2026", "Monto cero", "D006", "0", "Abono"], // monto 0 → se salta
  ];

  it("clasifica por la columna tipo (palabra y letra única) y captura n_documento", () => {
    const lines = applyAdapter(rows, singleCol());
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.tipo)).toEqual(["ENTRADA", "SALIDA", "ENTRADA", "SALIDA"]);
    expect(lines[0]).toMatchObject({ monto: 50_000, descripcion: "Venta", n_documento: "D001", fecha: "2026-06-14" });
  });

  it("salta filas con tipo no reconocido o monto cero", () => {
    const lines = applyAdapter(rows, singleCol());
    expect(lines.find((l) => l.descripcion === "Tipo ilegible")).toBeUndefined();
    expect(lines.find((l) => l.descripcion === "Monto cero")).toBeUndefined();
  });

  it("si falta la columna monto o tipo_flujo_col en la config → no extrae nada", () => {
    const cfg = singleCol({ columns: { fecha: 0, descripcion: 1, n_documento: 2, cargo: -1, abono: -1, saldo: -1 } });
    expect(applyAdapter(rows, cfg)).toHaveLength(0);
  });
});

// --- applyAdapter: transactions_log ----------------------------------------

describe("applyAdapter — layout transactions_log (una columna monto, sin flag)", () => {
  const rows: Row[] = [
    ["Fecha", "Desc", "Monto"],
    ["14/06/2026", "Venta crypto", "75.000"],
    ["15/06/2026", "Otra venta", "12.000"],
  ];

  it("sin default_tipo_flujo → ENTRADA implícita", () => {
    const lines = applyAdapter(rows, txLog());
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.tipo === "ENTRADA")).toBe(true);
    expect(lines[0].monto).toBe(75_000);
  });

  it("default_tipo_flujo 'salida' → SALIDA", () => {
    const lines = applyAdapter(rows, txLog({ default_tipo_flujo: "salida" }));
    expect(lines.every((l) => l.tipo === "SALIDA")).toBe(true);
  });

  it("sin columna monto → no extrae nada", () => {
    const cfg = txLog({ columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: -1, abono: -1, saldo: -1 } });
    expect(applyAdapter(rows, cfg)).toHaveLength(0);
  });
});

// --- applyAdapter: comportamiento común ------------------------------------

describe("applyAdapter — comportamiento común", () => {
  it("convierte objetos Date (cellDates) a ISO local sin pasar por normalizeDate", () => {
    const rows: Row[] = [
      ["Fecha", "Glosa", "Cargo", "Abono", "Saldo"],
      [new Date(2026, 5, 14) as unknown as string, "Con Date", "", "100.000", "0"], // mes 5 = junio
    ];
    const lines = applyAdapter(rows, twoCols());
    expect(lines).toHaveLength(1);
    expect(lines[0].fecha).toBe("2026-06-14");
  });

  it("salta filas vacías y filas cuya fecha no parece fecha", () => {
    const rows: Row[] = [
      ["Fecha", "Glosa", "Cargo", "Abono", "Saldo"],
      [], // fila vacía
      ["texto-no-fecha", "x", "", "100.000", "0"], // fecha inválida
      ["14/06/2026", "válida", "", "100.000", "0"],
    ];
    const lines = applyAdapter(rows, twoCols());
    expect(lines).toHaveLength(1);
    expect(lines[0].descripcion).toBe("válida");
  });

  it("sin filas de datos → arreglo vacío", () => {
    expect(applyAdapter([["solo header"]], twoCols())).toEqual([]);
  });
});

// --- linesToPreExtracted ---------------------------------------------------

describe("linesToPreExtracted — a formato MovimientoExtraido (bypass de IA)", () => {
  const base: ParsedLine[] = [
    { tipo: "ENTRADA", fecha: "2026-06-14", monto: 100_000, descripcion: "Venta", n_documento: "D1", excel_row: 2, saldo: 500_000 },
    { tipo: "SALIDA", fecha: "2026-06-15", monto: 20_000, descripcion: "Compra", n_documento: "", excel_row: 3 },
  ];

  it("mapea tipo→tipo_flujo, marca origen y convierte n_documento '' a null", () => {
    const out = linesToPreExtracted(base);
    expect(out[0]).toEqual({
      fecha: "2026-06-14",
      descripcion: "Venta",
      monto: 100_000,
      tipo_flujo: "entrada",
      origen: "cartola_preparseada",
      n_documento: "D1",
      excel_row: 2,
      saldo: 500_000,
    });
    expect(out[1].tipo_flujo).toBe("salida");
    expect(out[1].n_documento).toBeNull(); // '' → null
    expect(out[1].saldo).toBeUndefined();
  });
});

// --- serializeLines --------------------------------------------------------

describe("serializeLines — texto autodescriptivo para el procesador/IA", () => {
  const lines: ParsedLine[] = [
    { tipo: "ENTRADA", fecha: "2026-06-14", monto: 100_000, descripcion: "Venta", n_documento: "D1" },
    { tipo: "SALIDA", fecha: "2026-06-15", monto: 20_000, descripcion: "Compra", n_documento: "" },
  ];

  it("incluye encabezado con la hoja y una línea por movimiento (TIPO|FECHA|MONTO|DESC|NDOC)", () => {
    const out = serializeLines(lines, "Cartola");
    expect(out).toContain("--- Hoja: Cartola (cartola pre-parseada) ---");
    expect(out).toContain("TIPO viene pre-clasificado");
    expect(out).toContain("ENTRADA|2026-06-14|100000|Venta|D1");
    expect(out).toContain("SALIDA|2026-06-15|20000|Compra|");
  });

  it("sin líneas → solo encabezado", () => {
    const out = serializeLines([], "Vacía");
    expect(out.startsWith("--- Hoja: Vacía (cartola pre-parseada) ---")).toBe(true);
    expect(out.trimEnd().endsWith("NO invertir.")).toBe(true);
  });
});

describe("applyAdapter — fechas como número serial de Excel", () => {
  const cfg = {
    header_row: 0,
    skip_rows_before_data: 1,
    date_format: "dd/mm/yyyy" as const,
    number_format: "chilean" as const,
    columns: { fecha: 0, descripcion: 1, n_documento: -1, cargo: 2, abono: 3, saldo: 4 },
  };

  it("convierte el serial a yyyy-mm-dd (46245 = 2026-08-11)", () => {
    const lines = applyAdapter(
      [
        ["Fecha", "Descripción", "Egreso", "Ingreso", "Saldo"],
        [46245, "Transferencia recibida", "", 40000, 804099],
        [45292, "Abono antiguo", "", 1000, 1000],
      ] as never,
      cfg,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].fecha).toBe("2026-08-11");
    expect(lines[0].tipo).toBe("ENTRADA");
    expect(lines[0].monto).toBe(40000);
    expect(lines[1].fecha).toBe("2024-01-01");
  });

  it("números fuera del rango de fechas plausibles NO se tratan como fecha", () => {
    const lines = applyAdapter(
      [
        ["Fecha", "Descripción", "Egreso", "Ingreso", "Saldo"],
        [12345, "monto suelto en col fecha", "", 40000, 0],
        [99999, "otro fuera de rango", "", 50000, 0],
      ] as never,
      cfg,
    );
    expect(lines).toHaveLength(0);
  });
});
