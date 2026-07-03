import { describe, it, expect } from "vitest";
import { redactForAI, clienteToken, assertApprovedDataProcessor, payloadSeguroParaIA, maskRut } from "./egress";
import { OpenCodeGoProvider } from "./providers/opencodego";

describe("maskRut — enmascara cuerpo, deja últimos 3 + DV (auditoría #26)", () => {
  it("enmascara un RUT con puntos", () => {
    expect(maskRut("18.512.171-2")).toBe("••.•••.171-2");
  });
  it("enmascara un RUT sin puntos y con DV k", () => {
    expect(maskRut("9876543-k")).toBe("••.•••.543-k");
  });
  it("vacío/nulo devuelve vacío; basura sin forma de RUT → [RUT]", () => {
    expect(maskRut("")).toBe("");
    expect(maskRut(null)).toBe("");
    expect(maskRut("no-es-rut")).toBe("[RUT]");
  });
});

describe("redactForAI — minimización", () => {
  it("enmascara RUT (con y sin puntos)", () => {
    expect(redactForAI("Pago RUT 12.345.678-9")).toBe("Pago RUT [RUT]");
    expect(redactForAI("rut 9876543-k aquí")).toBe("rut [RUT] aquí");
  });

  it("enmascara nombre de persona tras preposición (2+ palabras)", () => {
    expect(redactForAI("Transferencia a Andrea Marion por $18.000")).toBe("Transferencia a [NOMBRE] por $18.000");
    expect(redactForAI("Transferencia recibida de Nataly Madeleine Flores Camus")).toBe("Transferencia recibida de [NOMBRE]");
  });

  it("PRESERVA keywords de clasificación (cripto/forex)", () => {
    expect(redactForAI("Compra USDT Binance P2P")).toBe("Compra USDT Binance P2P");
    expect(redactForAI("servicio de asesoría")).toBe("servicio de asesoría");
  });

  it("enmascara números de cuenta largos", () => {
    expect(redactForAI("Cuenta 001234567890")).toBe("Cuenta [NUM]");
    expect(redactForAI("monto $53.000")).toBe("monto $53.000"); // montos con punto: no se tocan
  });
});

describe("clienteToken — seudónimo estable no reversible", () => {
  it("mismo seed → mismo token; distintos → distintos", () => {
    expect(clienteToken("Andrea Marion")).toBe(clienteToken("andrea marion")); // case-insensitive
    expect(clienteToken("Andrea")).not.toBe(clienteToken("Nataly"));
  });
  it("vacío → anon", () => {
    expect(clienteToken("")).toBe("anon");
    expect(clienteToken(null)).toBe("anon");
  });
});

describe("assertApprovedDataProcessor — gate fail-closed", () => {
  it("acepta procesadores zero-retention aprobados", () => {
    expect(() => assertApprovedDataProcessor("opencodego", "deepseek-v4-flash")).not.toThrow();
    expect(() => assertApprovedDataProcessor("opencodego", "minimax-m3")).not.toThrow();
  });
  it("rechaza DeepSeek directo y desconocidos (fail-closed)", () => {
    expect(() => assertApprovedDataProcessor("deepseek", "deepseek-chat")).toThrow(/NO_APROBADO/);
    expect(() => assertApprovedDataProcessor("openai", "gpt-x")).toThrow(/NO_APROBADO/);
  });
});

describe("gate cableado en el provider (fail-closed, no solo el test)", () => {
  it("OpenCode Go con modelo aprobado SÍ se construye", () => {
    const prevKey = process.env.OPENCODE_GO_API_KEY;
    const prevModel = process.env.OPENCODE_GO_MODEL;
    process.env.OPENCODE_GO_API_KEY = "test-key";
    process.env.OPENCODE_GO_MODEL = "deepseek-v4-flash";
    try {
      expect(() => new OpenCodeGoProvider()).not.toThrow();
    } finally {
      process.env.OPENCODE_GO_API_KEY = prevKey;
      process.env.OPENCODE_GO_MODEL = prevModel;
    }
  });
});

describe("payloadSeguroParaIA — solo lo mínimo seudonimizado", () => {
  it("nunca incluye RUT ni nombre real", () => {
    const out = payloadSeguroParaIA({
      id: "abcdef12-3456", descripcion: "Transferencia a Andrea Marion", total: 18000,
      fecha: "2026-06-13", tipoDte: 41, receptorNombre: "Andrea Marion", receptorRut: "12.345.678-9",
    });
    const blob = JSON.stringify(out);
    expect(blob).not.toContain("Andrea Marion");
    expect(blob).not.toContain("12.345.678-9");
    expect(out.glosa).toBe("Transferencia a [NOMBRE]");
    expect(out.tipo).toBe("exenta");
    expect(out.cliente).toMatch(/^c/);
  });
});
