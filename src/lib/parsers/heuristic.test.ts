import { describe, expect, it } from "vitest";
import { detectHeuristic, findTransactionBlockStart } from "./heuristic";
import type { Row } from "./types";

describe("findTransactionBlockStart — primer bloque de >=3 filas tipo movimiento", () => {
  it("devuelve el índice de la primera de 3 filas consecutivas (saltando encabezados)", () => {
    const rows: Row[] = [
      ["Reporte cartola", ""],
      ["Fecha", "Monto"],
      ["01/06/2026", "1000"],
      ["02/06/2026", "2000"],
      ["03/06/2026", "3000"],
    ];
    expect(findTransactionBlockStart(rows)).toBe(2);
  });

  it("menos de 3 filas consecutivas → -1", () => {
    const rows: Row[] = [["01/06/2026", "1000"], ["02/06/2026", "2000"]];
    expect(findTransactionBlockStart(rows)).toBe(-1);
  });

  it("una fila no-movimiento reinicia el conteo", () => {
    const rows: Row[] = [
      ["01/06/2026", "1000"], // tx
      ["02/06/2026", "2000"], // tx (solo 2, se corta)
      ["sin", "datos"], // reinicia
      ["03/06/2026", "3000"], // tx
      ["04/06/2026", "4000"], // tx
      ["05/06/2026", "5000"], // tx → bloque desde aquí
    ];
    expect(findTransactionBlockStart(rows)).toBe(3);
  });

  it("requiere una fecha: filas con solo números (sin fecha) no son movimiento", () => {
    const rows: Row[] = [
      ["Cargo", "Abono"],
      ["1000", "2000"],
      ["3000", "4000"],
      ["5000", "6000"],
    ];
    expect(findTransactionBlockStart(rows)).toBe(-1);
  });

  it("sin filas → -1", () => {
    expect(findTransactionBlockStart([])).toBe(-1);
  });
});

describe("detectHeuristic — detección estructural de layout", () => {
  it("cartola con cargo/abono separados → layout two_cols", () => {
    const banco: Row[] = [
      ["Fecha", "Descripción", "Cargo", "Abono", "Saldo"],
      ["02/06/2026", "Transferencia recibida", "", "100000", "1100000"],
      ["03/06/2026", "Pago proveedor", "40000", "", "1060000"],
      ["04/06/2026", "Compra insumos", "60000", "", "1000000"],
      ["05/06/2026", "Abono cliente", "", "250000", "1250000"],
      ["06/06/2026", "Giro cajero", "50000", "", "1200000"],
      ["07/06/2026", "Deposito efectivo", "", "80000", "1280000"],
    ];
    const cfg = detectHeuristic(banco);
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBe("two_cols");
    expect(cfg!.date_format).toBe("dd/mm/yyyy");
    expect(cfg!.header_row).toBe(0);
    expect(cfg!.skip_rows_before_data).toBe(1);
    expect(cfg!.columns).toMatchObject({ fecha: 0, descripcion: 1, cargo: 2, abono: 3, saldo: 4 });
  });

  it("una columna de monto + columna de tipo (Abono/Cargo) → layout single_col", () => {
    const conTipo: Row[] = [
      ["Fecha", "Glosa", "Monto", "Tipo"],
      ["01/06/2026", "Venta producto importado", "50000", "Abono"],
      ["02/06/2026", "Pago a proveedor local", "30000", "Cargo"],
      ["03/06/2026", "Cobro servicio mensual", "45000", "Abono"],
      ["04/06/2026", "Compra de mercaderia", "20000", "Cargo"],
      ["05/06/2026", "Deposito de un cliente", "60000", "Abono"],
    ];
    const cfg = detectHeuristic(conTipo);
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBe("single_col");
    expect(cfg!.columns.fecha).toBe(0);
    expect(cfg!.columns.descripcion).toBe(1);
    expect(cfg!.columns.monto).toBe(2);
    expect(cfg!.columns.tipo_flujo_col).toBe(3);
  });

  it("solo fecha + glosa + monto (sin flag, sin saldo) → layout transactions_log, entrada por defecto", () => {
    const ventas: Row[] = [
      ["Fecha", "Concepto", "Monto"],
      ["01/06/2026", "Venta USDT P2P Binance", "75000"],
      ["02/06/2026", "Venta USDT P2P Binance", "82000"],
      ["03/06/2026", "Venta USDT P2P Binance", "68000"],
      ["04/06/2026", "Compraventa cripto wallet", "91000"],
    ];
    const cfg = detectHeuristic(ventas);
    expect(cfg).not.toBeNull();
    expect(cfg!.layout).toBe("transactions_log");
    expect(cfg!.default_tipo_flujo).toBe("entrada");
    expect(cfg!.columns.fecha).toBe(0);
    expect(cfg!.columns.descripcion).toBe(1);
    expect(cfg!.columns.monto).toBe(2);
    expect(cfg!.columns.saldo).toBe(-1);
  });

  it("sin bloque de movimientos (no es cartola) → null", () => {
    const noCartola: Row[] = [
      ["Concepto", "Valor"],
      ["Saldo inicial", "sin datos"],
      ["Total", "mas texto"],
    ];
    expect(detectHeuristic(noCartola)).toBeNull();
  });

  it("menos de 3 movimientos → null (no alcanza para inferir)", () => {
    const corta: Row[] = [
      ["Fecha", "Glosa", "Monto"],
      ["01/06/2026", "Venta", "1000"],
      ["02/06/2026", "Venta", "2000"],
    ];
    expect(detectHeuristic(corta)).toBeNull();
  });
});

// Incidente 2026-09-23: cartolas BancoEstado con fechas "20260923" / "02/09".
describe("BancoEstado: fechas yyyymmdd y dd/mm sin año SÍ parecen cartola", () => {
  it("cartola con FECHA yyyymmdd + CARGOS/ABONOS → se detecta", () => {
    const rows = [
      ["ESTADO DE CUENTA"], [], ["FECHA", "DOCUMENTO", "CODIGO", "DESCRIPCION", "CARGOS", "ABONOS"],
      ["20260923", "000000101", "", "TRANSFERENCIA DE A", "", 39300],
      ["20260923", "000000102", "", "TRANSFERENCIA DE B", "", 50000],
      ["20260922", "000000103", "", "PAGO SERVICIO", 12000, ""],
      ["20260922", "000000104", "", "TRANSFERENCIA DE C", "", 70000],
      ["20260921", "000000105", "", "COMISION", 1500, ""],
      ["20260920", "000000106", "", "TRANSFERENCIA DE D", "", 80000],
      ["20260920", "000000107", "", "TRANSFERENCIA DE E", "", 90000],
      ["20260919", "000000108", "", "PAGO LUZ", 20000, ""],
    ];
    const cfg = detectHeuristic(rows);
    expect(cfg).not.toBeNull();
    expect(cfg!.columns.fecha).toBe(0);
    expect(cfg!.columns.abono).toBe(5);
    // DOCUMENTO es un correlativo, no el saldo
    expect(cfg!.columns.saldo).toBe(-1);
  });
  it("hoja Movimientos con Fecha dd/mm (sin año) → se detecta", () => {
    const rows = [
      ["Fecha", "Sucursal", "N° Cuenta", "Alias", "N° Cartola", "N° Operación", "Descripción", "Depósitos / Abonos"],
      ["02/09", "OFICINA", "00123456", "Cta", 113, "000111", "Transferencia de A", 39300],
      ["03/09", "OFICINA", "00123456", "Cta", 113, "000112", "Transferencia de B", 50000],
      ["03/09", "OFICINA", "00123456", "Cta", 113, "000113", "Transferencia de C", 70000],
      ["04/09", "OFICINA", "00123456", "Cta", 113, "000114", "Transferencia de D", 32850],
    ];
    const cfg = detectHeuristic(rows);
    expect(cfg).not.toBeNull();
    expect(cfg!.columns.fecha).toBe(0);
    // el monto es "Depósitos / Abonos", NO el N° de Operación (7 dígitos, crecientes)
    expect(cfg!.columns.monto).toBe(7);
  });
  it("un N° de cuenta de 8 dígitos que no es fecha válida no se toma por fecha", () => {
    const rows = [["99887766", "algo", 1000], ["99887766", "algo", 2000], ["99887766", "algo", 3000]];
    expect(detectHeuristic(rows)).toBeNull();
  });
});
