import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { RateLimitRpcClient } from "../security/rate-limit-global";
import {
  LIMITE_FILAS_LECTURA,
  LIMITE_LECTURAS_POR_DIA,
  LIMITE_LECTURAS_POR_MINUTO,
  MESES_HACIA_ATRAS_MAX,
  frenarLectura,
  mensajeDeFreno,
  ventanaDelMes,
} from "./manguera";

// Un día de invierno chileno (UTC-4) y uno de verano (UTC-3), para que la
// ventana del mes se pruebe con los dos offsets y en el cruce de año.
const INVIERNO = new Date("2026-07-15T15:00:00Z");
const VERANO = new Date("2026-01-15T15:00:00Z");

describe("ventanaDelMes — la ventana es un mes DE CHILE", () => {
  it("sin argumento, el mes en curso", () => {
    const v = ventanaDelMes(undefined, INVIERNO);
    expect(v.mes).toBe("2026-07");
    // 1 de julio 00:00 Chile (UTC-4) = 04:00Z; 1 de agosto igual.
    expect(v.start).toBe("2026-07-01T04:00:00.000Z");
    expect(v.end).toBe("2026-08-01T04:00:00.000Z");
  });

  it("en verano el offset es -3 y la ventana se mueve con él", () => {
    const v = ventanaDelMes("2026-01", VERANO);
    expect(v.start).toBe("2026-01-01T03:00:00.000Z");
    expect(v.end).toBe("2026-02-01T03:00:00.000Z");
  });

  it("diciembre cierra en el 1 de enero del año siguiente", () => {
    const v = ventanaDelMes("2025-12", VERANO);
    expect(v.end.startsWith("2026-01-01")).toBe(true);
  });

  it("acepta hasta 12 meses atrás y rechaza el 13", () => {
    expect(ventanaDelMes("2025-07", INVIERNO).mes).toBe("2025-07");
    expect(() => ventanaDelMes("2025-06", INVIERNO)).toThrow(new RegExp(`${MESES_HACIA_ATRAS_MAX} meses`));
  });

  it("rechaza meses futuros y formatos malos, con un mensaje repetible", () => {
    expect(() => ventanaDelMes("2026-08", INVIERNO)).toThrow(/todavía no existe/);
    expect(() => ventanaDelMes("julio", INVIERNO)).toThrow(/YYYY-MM/);
    expect(() => ventanaDelMes("2026-13", INVIERNO)).toThrow(/YYYY-MM/);
  });
});

// Cliente RPC falso que decide POR LLAVE: así se prueba cada freno por
// separado y el bucket del aviso (1/hora) de forma independiente.
function rpcPorLlave(reglas: Record<string, boolean>, retry = 42): RateLimitRpcClient {
  return {
    rpc: async (_fn, args) => {
      const permitido = Object.entries(reglas).find(([prefijo]) => args.p_key.includes(prefijo))?.[1] ?? true;
      return { data: [{ allowed: permitido, retry_after_seconds: retry }], error: null };
    },
  };
}

describe("frenarLectura — ritmo y techo por TOKEN", () => {
  it("con todo dentro de límite, pasa", async () => {
    const f = await frenarLectura({ tokenId: "tok-1", cliente: rpcPorLlave({}) });
    expect(f).toEqual({ ok: true });
  });

  it("si el ritmo por minuto se pasó, frena por ritmo y avisa la primera vez", async () => {
    const f = await frenarLectura({ tokenId: "tok-1", cliente: rpcPorLlave({ "mcp-lectura-min": false }) });
    expect(f).toMatchObject({ ok: false, motivo: "ritmo", retryAfterSeconds: 42, avisar: true });
  });

  it("si el techo diario se pasó, frena por tope diario", async () => {
    const f = await frenarLectura({ tokenId: "tok-1", cliente: rpcPorLlave({ "mcp-lectura-dia": false }) });
    expect(f).toMatchObject({ ok: false, motivo: "tope_diario", avisar: true });
  });

  it("el aviso a ops se apaga cuando su propio bucket (1/hora) ya se usó — el bloqueo sigue", async () => {
    const f = await frenarLectura({
      tokenId: "tok-1",
      cliente: rpcPorLlave({ "mcp-lectura-min": false, "mcp-lectura-aviso": false }),
    });
    expect(f).toMatchObject({ ok: false, motivo: "ritmo", avisar: false });
  });

  it("la llave lleva el TOKEN, no el usuario: dos tokens son dos mangueras", async () => {
    const vistas: string[] = [];
    const cliente: RateLimitRpcClient = {
      rpc: async (_fn, args) => {
        vistas.push(args.p_key);
        return { data: [{ allowed: true, retry_after_seconds: 1 }], error: null };
      },
    };
    await frenarLectura({ tokenId: "tok-A", cliente });
    await frenarLectura({ tokenId: "tok-B", cliente });
    expect(vistas.some((k) => k.includes("tok-A"))).toBe(true);
    expect(vistas.some((k) => k.includes("tok-B"))).toBe(true);
  });

  it("los mensajes al asistente dicen el límite y cuándo volver", () => {
    expect(mensajeDeFreno({ ok: false, motivo: "ritmo", retryAfterSeconds: 7, avisar: false })).toContain(`${LIMITE_LECTURAS_POR_MINUTO} por minuto`);
    expect(mensajeDeFreno({ ok: false, motivo: "tope_diario", retryAfterSeconds: 7200, avisar: false })).toContain(`${LIMITE_LECTURAS_POR_DIA} lecturas por día`);
  });
});

/**
 * CENSO sobre la ruta real: la manguera solo sirve si la ruta la usa. Estos
 * asserts leen el código y fallan si alguien vuelve a leer sin ventana, sin
 * tope, sin freno, o vuelve a etiquetar las escrituras como "auth".
 */
describe("la ruta del MCP usa la manguera (censo sobre el código)", () => {
  const src = readFileSync("src/app/api/mcp/route.ts", "utf8");

  it("pendientes_emision lee con ventana de mes y tope de filas", () => {
    expect(src).toMatch(/\{ start: ventana\.start, end: ventana\.end \}/);
    expect(src).toMatch(/limit: LIMITE_FILAS_LECTURA/);
    expect(src).not.toMatch(/getPendientesEmision\([^)]*undefined,\s*\{ mesa \}\)/);
  });

  it("pendientes_emision pasa por el freno por token antes de leer", () => {
    expect(src).toMatch(/frenarLectura\(\{ tokenId: ctx\.tokenId \}\)/);
  });

  it("los eventos del conector se registran con source mcp, ya no auth", () => {
    expect(src).not.toMatch(/source: "auth"/);
    expect((src.match(/source: "mcp"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("el tope de filas es el que promete la doctrina (100)", () => {
    expect(LIMITE_FILAS_LECTURA).toBe(100);
  });
});
