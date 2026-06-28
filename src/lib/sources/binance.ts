/**
 * Adaptador Binance P2P (C2C) — "una fuente = una cartola".
 *
 * Trae las órdenes P2P COMPLETADAS del cliente (con su API key READ-ONLY) y las
 * normaliza a MovimientoCorrelacionable para que el motor de cruce (F3) las una
 * con el abono en CLP del banco/MP → 1 venta = 1 boleta.
 *
 * Endpoint, firma y campos según la investigación (memoria reference_exchange_apis_p2p):
 *  - GET /sapi/v1/c2c/orderMatch/listUserOrderHistory  (permiso "Enable Reading", NO merchant)
 *  - firma HMAC-SHA256; desde ~ene-2026 hay que percent-encodear el payload antes de firmar
 *  - solo 6 meses de historia, ventanas de 30 días
 *
 * normalizarOrdenesC2C es PURA y testeable. fetchC2COrders es la llamada en vivo
 * (necesita la key real del cliente para verificarse — sin probar contra Binance).
 */
import { createHmac } from "node:crypto";
import type { MovimientoCorrelacionable } from "@/lib/intermediario/correlacion";

const BASE_URL = "https://api.binance.com";
const C2C_PATH = "/sapi/v1/c2c/orderMatch/listUserOrderHistory";

export interface BinanceC2COrder {
  orderNumber: string;
  advNo?: string;
  tradeType: "BUY" | "SELL";
  asset: string;        // p.ej. "USDT"
  fiat: string;         // p.ej. "CLP"
  amount: string;       // cantidad cripto
  totalPrice: string;   // total en fiat (CLP)
  unitPrice?: string;
  orderStatus: string;  // "COMPLETED" | "PENDING" | "CANCELLED" | ...
  createTime: number;   // unix ms (UTC)
  counterPartNickName?: string;
  commission?: string;
}

/** createTime (ms UTC) → fecha/hora en día de Chile (nunca fechas peladas). */
export function fechaHoraChile(createTimeMs: number): { fecha: string; hora: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(createTimeMs)).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

/**
 * Normaliza órdenes C2C → movimientos correlacionables. Solo VENTAS completadas en
 * CLP (las que generan boleta exenta de cripto). PURA.
 */
export function normalizarOrdenesC2C(orders: BinanceC2COrder[]): MovimientoCorrelacionable[] {
  return orders
    .filter((o) => o.orderStatus === "COMPLETED" && o.tradeType === "SELL" && o.fiat === "CLP")
    .map((o) => {
      const { fecha, hora } = fechaHoraChile(Number(o.createTime));
      return {
        id: `binance:${o.orderNumber}`,
        fuente: "binance",
        montoClp: Math.round(Number(o.totalPrice)),
        fecha,
        hora,
        contraparte: o.counterPartNickName ?? null,
        codigoOperacion: o.orderNumber,
      };
    });
}

function firmar(query: string, apiSecret: string): string {
  return createHmac("sha256", apiSecret).update(query).digest("hex");
}

/**
 * Trae órdenes C2C de una ventana (≤30 días) vía la API real de Binance.
 * ⚠️ NO verificado contra Binance todavía (necesita una key read-only real del
 * cliente). La firma percent-encodea el payload antes del HMAC (cambio ~ene-2026).
 */
export async function fetchC2COrders(
  apiKey: string,
  apiSecret: string,
  opts: { tradeType?: "BUY" | "SELL"; startMs: number; endMs: number; page?: number; rows?: number },
): Promise<BinanceC2COrder[]> {
  const params: Record<string, string> = {
    tradeType: opts.tradeType ?? "SELL",
    startTimestamp: String(opts.startMs),
    endTimestamp: String(opts.endMs),
    page: String(opts.page ?? 1),
    rows: String(Math.min(100, opts.rows ?? 100)),
    timestamp: String(Date.now()),
    recvWindow: "10000",
  };
  // Payload percent-encodeado (clave del cambio ene-2026): se firma EXACTAMENTE lo
  // que se manda en la query.
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const signature = firmar(query, apiSecret);

  const res = await fetch(`${BASE_URL}${C2C_PATH}?${query}&signature=${signature}`, {
    method: "GET",
    headers: { "X-MBX-APIKEY": apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BINANCE_C2C_${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: BinanceC2COrder[] };
  return Array.isArray(json.data) ? json.data : [];
}
