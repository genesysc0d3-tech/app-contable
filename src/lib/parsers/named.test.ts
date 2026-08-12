import { describe, expect, it } from "vitest";
import { detectByNames } from "./named";

describe("detectByNames — detección por nombres de encabezado", () => {
  it("plantilla Fecha + Glosa + Monto → transactions_log (entrada por defecto)", () => {
    const cfg = detectByNames([
      ["Fecha", "Glosa", "Monto"],
      ["14/06/2026", "Venta", "1000"],
    ]);
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBe("transactions_log");
    expect(cfg!.default_tipo_flujo).toBe("entrada");
    expect(cfg!.header_row).toBe(0);
    expect(cfg!.skip_rows_before_data).toBe(1);
    expect(cfg!.columns).toMatchObject({
      fecha: 0,
      descripcion: 1,
      monto: 2,
      cargo: 2,
      abono: 2,
      n_documento: -1,
      saldo: -1,
    });
  });

  it("el match de encabezados es case-insensitive", () => {
    const cfg = detectByNames([
      ["FECHA", "glosa", "Monto"],
      ["14/06/2026", "Venta", "1000"],
    ]);
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBe("transactions_log");
  });

  it("cartola Fecha + Descripción + Cargo + Abono + Saldo + Documento → two_cols con todas las columnas", () => {
    const cfg = detectByNames([
      ["Fecha", "Descripción de la operación", "N° Documento", "Cargo", "Abono", "Saldo"],
      ["14/06/2026", "Pago", "123", "", "1000", "5000"],
    ]);
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBeUndefined(); // sin layout explícito → el motor asume two_cols
    expect(cfg!.columns).toMatchObject({
      fecha: 0,
      descripcion: 1,
      n_documento: 2,
      cargo: 3,
      abono: 4,
      saldo: 5,
    });
  });

  it("reconoce sinónimos Débito/Crédito como cargo/abono; sin doc ni saldo → -1", () => {
    const cfg = detectByNames([
      ["Fecha", "Descripción", "Débito", "Crédito"],
      ["14/06/2026", "Pago", "1000", ""],
    ]);
    expect(cfg).not.toBeNull();
    expect(cfg!.columns.cargo).toBe(2);
    expect(cfg!.columns.abono).toBe(3);
    expect(cfg!.columns.n_documento).toBe(-1);
    expect(cfg!.columns.saldo).toBe(-1);
  });

  it("encabezado en una fila posterior (hay títulos arriba) → header_row/skip correctos", () => {
    const cfg = detectByNames([
      ["Banco XYZ"],
      ["Cartola junio 2026"],
      ["Fecha", "Glosa", "Monto"],
      ["14/06/2026", "Venta", "1000"],
    ]);
    expect(cfg).not.toBeNull();
    expect(cfg!.header_row).toBe(2);
    expect(cfg!.skip_rows_before_data).toBe(3);
  });

  it("sin encabezados reconocibles → null", () => {
    expect(detectByNames([["Col A", "Col B"], ["1", "2"]])).toBeNull();
  });

  it("fecha + glosa pero sin monto ni cargo/abono → null (no inventa layout)", () => {
    expect(
      detectByNames([
        ["Fecha", "Glosa", "Total"],
        ["14/06/2026", "Venta", "1000"],
      ]),
    ).toBeNull();
  });
});

describe("detectByNames — formato 'Mis Movimientos' (Fecha Transacción + Egreso/Ingreso)", () => {
  // Caso real de beta 2026-08-12: banco exporta "Fecha Transacción, Fecha
  // Contable, Descripción, Egreso (-), Ingreso (+), Saldo" con fechas como
  // números seriales de Excel.
  const rows = [
    [null, null, "Mis Movimientos"],
    ["Fecha Transacción", "Fecha Contable", "Descripción", "Egreso (-)", "Ingreso (+)", "Saldo"],
    [46245, 46245, "Comision Unica Por Plan", 6076, "", 798023],
    [46245, 46246, "Transferencia recibida de", "", 40000, 804099],
  ];

  it("detecta el header y mapea egreso→cargo, ingreso→abono", () => {
    const cfg = detectByNames(rows as never);
    expect(cfg).not.toBeNull();
    expect(cfg!.header_row).toBe(1);
    expect(cfg!.skip_rows_before_data).toBe(2);
    expect(cfg!.columns.fecha).toBe(0); // Fecha Transacción, no la Contable
    expect(cfg!.columns.descripcion).toBe(2);
    expect(cfg!.columns.cargo).toBe(3);
    expect(cfg!.columns.abono).toBe(4);
    expect(cfg!.columns.saldo).toBe(5);
  });
});
