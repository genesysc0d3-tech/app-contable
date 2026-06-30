import { describe, expect, it } from "vitest";
import {
  destinoDesdeTextoTelegram,
  fechaDesdeTextoTelegram,
  origenDesdeTextoTelegram,
  resolverDireccionTelegram,
  resolverMontoTelegram,
  rutDesdeTextoTelegram,
  tipoVentaDesdeTextoTelegram,
} from "./deterministico";
import { mensajeLeiEsto } from "./propuestas";

describe("parser deterministico Telegram", () => {
  it("descarta cuenta/RUT como monto y elige el monto real por consenso", () => {
    const lines = [
      "BancoEstado",
      "Comprobante de Transferencia",
      "Monto transferido",
      "Cuenta RUT N° 61725277",
      "$50.600",
      "Para",
      "DOMIDOG SPA",
      "Código de transacción: 05-05-2020-ABC",
    ];

    const monto = resolverMontoTelegram(lines);

    expect(monto.decision?.monto).toBe(50600);
    expect(monto.diagnostics.candidatos_descartados).toContainEqual(
      expect.objectContaining({ valor: 61725277, motivo: "linea_cuenta_rut_codigo_saldo" }),
    );
  });

  it("acepta monto con etiqueta fuerte aunque exista un candidato medio conflictivo", () => {
    const lines = [
      "Comprobante de pago",
      "Fecha: 13/06/2026 18:53",
      "Monto",
      "$53.000",
      "Referencia $14.780.355",
      "RUT destinatario: 56.113.251-9",
    ];

    const monto = resolverMontoTelegram(lines);

    expect(monto.decision?.monto).toBe(53000);
    expect(monto.decision).not.toBeNull();
    expect(monto.diagnostics.votos.every((vote) => typeof vote.linea === "string" && vote.linea.length > 0)).toBe(true);
  });

  it("nunca convierte un codigo largo continuo en monto", () => {
    const lines = [
      "Comprobante de pago",
      "Monto",
      "147803551745",
      "Código de operación",
    ];

    const monto = resolverMontoTelegram(lines);

    expect(monto.decision).toBeNull();
    expect(monto.diagnostics.candidatos_descartados).toContainEqual(
      expect.objectContaining({ valor: 147803551745, motivo: "codigo_largo_no_monto" }),
    );
  });

  it("salta codigos largos cerca de Monto y usa el CLP real siguiente", () => {
    const lines = [
      "Comprobante de pago",
      "Monto",
      "147803551745",
      "$53.000",
    ];

    const monto = resolverMontoTelegram(lines);

    expect(monto.decision?.monto).toBe(53000);
    expect(monto.diagnostics.candidatos_descartados).toContainEqual(
      expect.objectContaining({ valor: 147803551745, motivo: "codigo_largo_no_monto" }),
    );
  });

  it("acepta montos con espacios o simbolo peso leido como S", () => {
    expect(resolverMontoTelegram(["Monto", "$ 53 000"]).decision?.monto).toBe(53000);
    expect(resolverMontoTelegram(["Monto", "S 53 000"]).decision?.monto).toBe(53000);
    expect(resolverMontoTelegram(["Monto", "$ 53.00"]).decision?.monto).toBe(53000);
    expect(resolverMontoTelegram(["Monto", "S 53.00"]).decision?.monto).toBe(53000);
  });

  it("acepta $ 53.00 como voto fuerte cerca de Monto", () => {
    const monto = resolverMontoTelegram([
      "Comprobante",
      "Monto",
      "$ 53.00",
      "Código de operación",
      "147803551745",
    ]);

    expect(monto.decision?.monto).toBe(53000);
    expect(monto.decision?.votos).toContainEqual(expect.objectContaining({ monto: 53000, fuerza: "fuerte" }));
    expect(monto.diagnostics.candidatos_descartados).toContainEqual(
      expect.objectContaining({ valor: 147803551745, motivo: "codigo_largo_no_monto" }),
    );
  });

  it("ignora fechas en codigos y usa fallback Chile", () => {
    const lines = [
      "Comprobante de transferencia",
      "Código de transacción: 05-05-2020-ABC",
      "Monto: $50.600",
    ];

    const fecha = fechaDesdeTextoTelegram(lines, "2026-06-13");

    expect(fecha).toEqual({
      fecha: "2026-06-13",
      visible: false,
      decision: "fallback_fecha_recepcion_chile",
    });
  });

  it("clasifica como entrada cuando la empresa esta en destino aunque el texto diga monto transferido", () => {
    const lines = [
      "Transferencia se ha realizado con éxito",
      "Monto transferido: $50.600",
      "Para",
      "DOMIDOG SPA",
      "Cuenta RUT N° 61725277",
    ];
    const text = lines.join("\n");
    const destino = destinoDesdeTextoTelegram(lines);
    const origen = origenDesdeTextoTelegram(lines);

    const direccion = resolverDireccionTelegram({
      text,
      destino,
      origen,
      identidades: ["DOMIDOG SPA", "56113251"],
    });

    expect(destino).toBe("DOMIDOG SPA");
    expect(direccion?.tipo_flujo).toBe("entrada");
    expect(direccion?.decision).toBe("consenso_entrada");
  });

  it("muestra en el resumen OCR el monto consensuado, no el numero de cuenta", () => {
    const ocrText = [
      "Comprobante de transferencia",
      "Monto transferido",
      "Cuenta: 61725277",
      "$50.600",
      "Fecha de la transferencia: 05/05/2020 12:47",
    ].join("\n");

    const mensaje = mensajeLeiEsto(ocrText);

    expect(mensaje).toContain("📄 <b>Comprobante leído</b>");
    expect(mensaje).toContain("<pre>Tipo: Transferencia bancaria");
    expect(mensaje).toContain("Monto: $50.600");
    expect(mensaje).not.toContain("Detalle leído");
    expect(mensaje).not.toContain("Cuenta: 61725277");
    expect(mensaje).not.toContain("• Monto");
    expect(mensaje).not.toContain("OCR");
    expect(mensaje).not.toContain("$61.725.277");
  });
});

describe("robustez determinística — tipo de venta (crypto/forex): amplio y preciso", () => {
  const crypto = [
    "Vendiste 540 USDT", "compra de 0.01 BTC", "Bitcoin", "ethereum", "ETH", "Binance P2P",
    "USDC", "OrionX", "Buda.com", "KuCoin", "Bybit", "Coinbase", "Kraken", "criptomoneda",
    "Tether", "vendí en Binance", "operación P2P", "DOGE", "Solana", "stablecoin", "Bitso", "Lemon Cash",
  ];
  for (const t of crypto) it(`crypto ✓: "${t}"`, () => expect(tipoVentaDesdeTextoTelegram(t)).toBe("compraventa_crypto"));

  const forex = ["Venta de USD 600", "cambio de divisas", "dólares", "EUR 200", "euros", "moneda extranjera", "U$S 300", "forex", "dólar"];
  for (const t of forex) it(`forex ✓: "${t}"`, () => expect(tipoVentaDesdeTextoTelegram(t)).toBe("operacion_forex"));

  const generico = [
    "Transferencia recibida $50.000", "pago de arriendo", "venta de muebles usados",
    "servicio de diseño gráfico", "abono de cliente", "honorarios", "producto importado",
  ];
  for (const t of generico) it(`genérico (null): "${t}"`, () => expect(tipoVentaDesdeTextoTelegram(t)).toBeNull());

  it("PRECISIÓN: no matchea keywords embebidas en otras palabras ni tokens cortos removidos", () => {
    expect(tipoVentaDesdeTextoTelegram("ajusdte el monto")).toBeNull(); // 'usdt' embebido
    expect(tipoVentaDesdeTextoTelegram("methods de pago")).toBeNull();   // 'eth' embebido
    expect(tipoVentaDesdeTextoTelegram("tomé sol en la playa")).toBeNull(); // 'sol' fuera de la lista
    expect(tipoVentaDesdeTextoTelegram("link de pago")).toBeNull();      // 'link' fuera de la lista
  });
});

describe("robustez determinística — RUT de la contraparte", () => {
  it("con puntos", () => expect(rutDesdeTextoTelegram("RUT 12.345.678-9")).toBe("12.345.678-9"));
  it("sin puntos", () => expect(rutDesdeTextoTelegram("rut: 12345678-9")).toBe("12345678-9"));
  it("con dígito verificador K", () => expect(rutDesdeTextoTelegram("9.876.543-K")).toBe("9.876.543-K"));
  it("RUT de 7 dígitos", () => expect(rutDesdeTextoTelegram("1.234.567-8")).toBe("1.234.567-8"));
  it("null si no hay RUT", () => expect(rutDesdeTextoTelegram("Comprador: Juan Pérez")).toBeNull());
});

describe("robustez determinística — contraparte por etiquetas amplias", () => {
  const pagadores: [string, string][] = [
    ["Comprador: Juan Pérez Soto", "Juan Pérez Soto"],
    ["Cliente: María González", "María González"],
    ["Pagador: Pedro Ramírez", "Pedro Ramírez"],
    ["De: Ana Torres", "Ana Torres"],
    ["Remitente: Luis Díaz", "Luis Díaz"],
    ["Titular: Sofía Muñoz", "Sofía Muñoz"],
  ];
  for (const [linea, esperado] of pagadores) {
    it(`origen (pagador) "${linea}"`, () => expect(origenDesdeTextoTelegram([linea])).toBe(esperado));
  }
  const receptores: [string, string][] = [
    ["Para: Carlos Soto", "Carlos Soto"],
    ["Beneficiario: Empresa SpA", "Empresa SpA"],
    ["Vendedor: Tienda XYZ", "Tienda XYZ"],
    ["Proveedor: Distribuidora ABC", "Distribuidora ABC"],
  ];
  for (const [linea, esperado] of receptores) {
    it(`destino (receptor) "${linea}"`, () => expect(destinoDesdeTextoTelegram([linea])).toBe(esperado));
  }
});
