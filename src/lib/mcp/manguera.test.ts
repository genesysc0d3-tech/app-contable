import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { RateLimitRpcClient } from "../security/rate-limit-global";
import {
  DIA_MS,
  LIMITE_ESCRITURAS_POR_DIA,
  LIMITE_FILAS_LECTURA,
  LIMITE_LECTURAS_POR_DIA,
  LIMITE_LECTURAS_POR_MINUTO,
  MESES_HACIA_ATRAS_MAX,
  MINUTO_MS,
  PAGINA_MAX,
  frenarEscritura,
  frenarLectura,
  mensajeDeFreno,
  paginaAOffset,
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

  it("diciembre cierra en el 1 de enero del año siguiente, a la hora de Chile", () => {
    const v = ventanaDelMes("2025-12", VERANO);
    expect(v.end).toBe("2026-01-01T03:00:00.000Z");
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

describe("paginaAOffset — páginas de 100, tope = el mes entero del plan más grande", () => {
  it("default página 1, offset 0", () => {
    expect(paginaAOffset(undefined)).toEqual({ pagina: 1, offset: 0 });
  });
  it("la página N empieza en (N-1)×100", () => {
    expect(paginaAOffset(3)).toEqual({ pagina: 3, offset: 2 * LIMITE_FILAS_LECTURA });
    expect(paginaAOffset("2")).toEqual({ pagina: 2, offset: LIMITE_FILAS_LECTURA });
  });
  it("30 páginas × 100 = 3.000 = la cuota mensual de Business; la 31 se rechaza", () => {
    expect(PAGINA_MAX * LIMITE_FILAS_LECTURA).toBe(3000);
    expect(paginaAOffset(PAGINA_MAX).offset).toBe(2900);
    expect(() => paginaAOffset(PAGINA_MAX + 1)).toThrow(/máximo/);
  });
  it("rechaza 0, negativos y no enteros", () => {
    for (const malo of [0, -1, 1.5, "abc"]) expect(() => paginaAOffset(malo)).toThrow(/entero/);
  });
});

// Cliente RPC falso que decide POR LLAVE y además GRABA con qué límite y
// ventana lo llamaron: así los tests fijan los números, no solo la decisión.
type Llamada = { key: string; limit: number; windowMs: number };
function rpcEspia(reglas: Record<string, boolean> = {}, retry = 42): RateLimitRpcClient & { llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  return {
    llamadas,
    rpc: async (_fn, args) => {
      llamadas.push({ key: args.p_key, limit: args.p_limit, windowMs: args.p_window_ms });
      const permitido = Object.entries(reglas).find(([prefijo]) => args.p_key.includes(prefijo))?.[1] ?? true;
      return { data: [{ allowed: permitido, retry_after_seconds: retry }], error: null };
    },
  };
}
const rpcQueFalla: RateLimitRpcClient = { rpc: async () => ({ data: null, error: { message: "boom" } }) };

describe("frenarLectura — ritmo y techo por TOKEN, con los números fijados", () => {
  it("con todo dentro de límite pasa, y pidió exactamente 10/min y 30/día", async () => {
    const c = rpcEspia();
    expect(await frenarLectura({ tokenId: "tok-1", cliente: c })).toEqual({ ok: true });
    const min = c.llamadas.find((l) => l.key.includes("mcp-lectura-min:tok-1"));
    const dia = c.llamadas.find((l) => l.key.includes("mcp-lectura-dia:tok-1"));
    expect(min).toMatchObject({ limit: LIMITE_LECTURAS_POR_MINUTO, windowMs: MINUTO_MS });
    expect(dia).toMatchObject({ limit: LIMITE_LECTURAS_POR_DIA, windowMs: DIA_MS });
    expect(LIMITE_LECTURAS_POR_MINUTO).toBe(10);
    expect(LIMITE_LECTURAS_POR_DIA).toBe(30);
    expect(DIA_MS).toBe(86_400_000);
  });

  it("si el ritmo por minuto se pasó, frena por ritmo, avisa la primera vez y NO gasta el cupo del día", async () => {
    const c = rpcEspia({ "mcp-lectura-min": false });
    const f = await frenarLectura({ tokenId: "tok-1", cliente: c });
    expect(f).toMatchObject({ ok: false, motivo: "ritmo", retryAfterSeconds: 42, avisar: true });
    expect(c.llamadas.some((l) => l.key.includes("mcp-lectura-dia"))).toBe(false);
  });

  it("si el techo diario se pasó, frena por tope diario", async () => {
    const f = await frenarLectura({ tokenId: "tok-1", cliente: rpcEspia({ "mcp-lectura-dia": false }) });
    expect(f).toMatchObject({ ok: false, motivo: "tope_diario", avisar: true });
  });

  it("el aviso a ops se apaga cuando su propio bucket (1/hora) ya se usó — el bloqueo sigue", async () => {
    const f = await frenarLectura({ tokenId: "tok-1", cliente: rpcEspia({ "mcp-lectura-min": false, "mcp-lectura-aviso": false }) });
    expect(f).toMatchObject({ ok: false, motivo: "ritmo", avisar: false });
  });

  it("FAIL-CLOSED: si el bucket compartido no responde, NO se lee (antes caía a memoria por instancia)", async () => {
    const f = await frenarLectura({ tokenId: "tok-1", cliente: rpcQueFalla });
    expect(f.ok).toBe(false);
  });

  it("la llave lleva el TOKEN, no el usuario: dos tokens son dos mangueras", async () => {
    const c = rpcEspia();
    await frenarLectura({ tokenId: "tok-A", cliente: c });
    await frenarLectura({ tokenId: "tok-B", cliente: c });
    expect(c.llamadas.some((l) => l.key.includes("tok-A"))).toBe(true);
    expect(c.llamadas.some((l) => l.key.includes("tok-B"))).toBe(true);
  });
});

describe("frenarEscritura — techo diario de documentos MOVIDOS por token", () => {
  it("cobra por DOCUMENTO: 7 ids son 7 hits contra el mismo techo de 40/día", async () => {
    const c = rpcEspia();
    expect(await frenarEscritura({ tokenId: "tok-1", cuantos: 7, cliente: c })).toEqual({ ok: true });
    const hits = c.llamadas.filter((l) => l.key.includes("mcp-escritura-dia:tok-1"));
    expect(hits).toHaveLength(7);
    expect(hits[0]).toMatchObject({ limit: LIMITE_ESCRITURAS_POR_DIA, windowMs: DIA_MS });
    expect(LIMITE_ESCRITURAS_POR_DIA).toBe(40);
  });

  it("al pasarse, frena con motivo tope_escrituras y avisa", async () => {
    const f = await frenarEscritura({ tokenId: "tok-1", cuantos: 3, cliente: rpcEspia({ "mcp-escritura-dia": false }) });
    expect(f).toMatchObject({ ok: false, motivo: "tope_escrituras", avisar: true });
  });

  it("FAIL-CLOSED también para escribir", async () => {
    const f = await frenarEscritura({ tokenId: "tok-1", cuantos: 1, cliente: rpcQueFalla });
    expect(f.ok).toBe(false);
  });
});

describe("mensajes al asistente: dicen el límite y cuándo volver", () => {
  it("ritmo / tope diario / tope de escrituras", () => {
    expect(mensajeDeFreno({ ok: false, motivo: "ritmo", retryAfterSeconds: 7, avisar: false })).toContain(`${LIMITE_LECTURAS_POR_MINUTO} por minuto`);
    expect(mensajeDeFreno({ ok: false, motivo: "tope_diario", retryAfterSeconds: 7200, avisar: false })).toContain(`${LIMITE_LECTURAS_POR_DIA} lecturas por día`);
    expect(mensajeDeFreno({ ok: false, motivo: "tope_escrituras", retryAfterSeconds: 7200, avisar: false })).toContain(`${LIMITE_ESCRITURAS_POR_DIA} documentos`);
  });
});

/**
 * CENSO sobre la ruta real: la manguera solo sirve si la ruta la usa. Estos
 * asserts leen el código y fallan si alguien vuelve a leer sin ventana, sin
 * página, sin freno, escribe sin freno, o re-etiqueta los eventos.
 */
describe("la ruta del MCP usa la manguera (censo sobre el código)", () => {
  const src = readFileSync("src/app/api/mcp/route.ts", "utf8");

  it("pendientes_emision lee con ventana de mes, página y tope de filas", () => {
    expect(src).toMatch(/\{ start: ventana\.start, end: ventana\.end \}/);
    expect(src).toMatch(/limit: LIMITE_FILAS_LECTURA, offset/);
    expect(src).toMatch(/paginaAOffset\(args\.pagina\)/);
    expect(src).toMatch(/hay_mas: result\.hayMas/);
  });

  it("la lectura frena y LANZA si el freno no pasa (no basta con llamarlo)", () => {
    expect(src).toMatch(/const freno = await frenarLectura\(\{ tokenId: ctx\.tokenId \}\);\s*if \(!freno\.ok\) \{[\s\S]*?throw new Error\(mensajeDeFreno\(freno\)\)/);
  });

  it("las DOS escrituras frenan por documento y lanzan", () => {
    const frenos = src.match(/const frenoW = await frenarEscritura\(\{ tokenId: ctx\.tokenId, cuantos: ids\.length \}\);\s*if \(!frenoW\.ok\) \{[\s\S]*?throw new Error\(mensajeDeFreno\(frenoW\)\)/g) ?? [];
    expect(frenos).toHaveLength(2);
  });

  it("los eventos del conector van con source mcp y con el token como resourceId (no en metadata, que lo redacta)", () => {
    expect(src).not.toMatch(/source: "auth"/);
    // En METADATA no: el sanitizador de ops redacta cualquier clave con "token".
    // Como COLUMNA de asistente_observaciones sí (es el enlace al conector).
    expect(src).not.toMatch(/metadata: \{[^}]*token_id/);
    expect((src.match(/resourceId: ctx\.tokenId/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("los textos que lee el modelo ya no mienten", () => {
    expect(src).not.toMatch(/la única escritura/);
    expect(src).not.toMatch(/lo ve el usuario/);
    expect(src).toMatch(/posiblemente_truncado/); // resumen_del_mes avisa el corte de 2.000
  });
});
