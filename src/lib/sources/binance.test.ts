import { describe, it, expect } from "vitest";
import { normalizarOrdenesC2C, fechaHoraChile, binanceAdapter, type BinanceC2COrder } from "./binance";
import { getSourceAdapter, listSourceAdapters } from "./index";

const order = (over: Partial<BinanceC2COrder> = {}): BinanceC2COrder => ({
  orderNumber: "O1",
  tradeType: "SELL",
  asset: "USDT",
  fiat: "CLP",
  amount: "100",
  totalPrice: "95000",
  orderStatus: "COMPLETED",
  createTime: Date.parse("2026-06-14T18:30:00Z"),
  counterPartNickName: "juanp",
  ...over,
});

describe("normalizarOrdenesC2C", () => {
  it("toma solo VENTAS completadas en CLP y mapea los campos", () => {
    const out = normalizarOrdenesC2C([order()]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "binance:O1",
      fuente: "binance",
      montoClp: 95000,
      contraparte: "juanp",
      codigoOperacion: "O1",
    });
    expect(out[0].fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out[0].hora).toMatch(/^\d{2}:\d{2}$/);
  });

  it("excluye pendientes, compras y no-CLP", () => {
    const out = normalizarOrdenesC2C([
      order({ orderNumber: "P", orderStatus: "PENDING" }),
      order({ orderNumber: "B", tradeType: "BUY" }),
      order({ orderNumber: "U", fiat: "USD" }),
    ]);
    expect(out).toHaveLength(0);
  });
});

describe("fechaHoraChile", () => {
  it("convierte UTC → día de Chile cruzando el límite de día (UTC-4 en junio)", () => {
    expect(fechaHoraChile(Date.parse("2026-06-15T02:00:00Z"))).toEqual({ fecha: "2026-06-14", hora: "22:00" });
  });
});

describe("binanceAdapter (contrato SourceAdapter)", () => {
  it("expone id/nombre/credencialesRequeridas", () => {
    expect(binanceAdapter.id).toBe("binance");
    expect(binanceAdapter.nombre).toBe("Binance P2P");
    expect(binanceAdapter.credencialesRequeridas).toEqual(["apiKey", "apiSecret"]);
  });
  it("fetchMovimientos sin credenciales falla (no llama a la API)", async () => {
    await expect(binanceAdapter.fetchMovimientos({}, { desdeMs: 0, hastaMs: 1 })).rejects.toThrow(/CREDENCIALES/);
  });
});

describe("registro de fuentes", () => {
  it("getSourceAdapter resuelve binance y null para desconocidas", () => {
    expect(getSourceAdapter("binance")).toBe(binanceAdapter);
    expect(getSourceAdapter("no-existe")).toBeNull();
  });
  it("listSourceAdapters incluye binance", () => {
    expect(listSourceAdapters().map((a) => a.id)).toContain("binance");
  });
});
