import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENCODE_GO_CHAT_URL,
  MODELO_ESTRUCTURA,
  configDesdeRespuesta,
  decidirDosOpiniones,
  estructuraIaActiva,
  formaDeCelda,
  grillaEnmascarada,
  mapaPorIA,
} from "./estructura-ia";
import type { Row } from "./types";
import { todasLasCartolas } from "./testing/sabotajes";

// Punto 9: DeepSeek (OpenCode Go) como SEGUNDA OPINIÓN del mapa. Sin red: el
// fetch es un doble. La prueba con DeepSeek real vive en
// scripts/comparar-lector-deepseek.ts (fuera de CI).

beforeEach(() => { delete process.env.LECTOR_ESTRUCTURA_IA; });

describe("grilla ENMASCARADA", () => {
  const rows: Row[] = [
    ["Nombre: EMPRESA FICTICIA SPA   Rut: 11.111.111-1"],
    ["Fecha", "Descripción", "Cargos", "Abonos", "Saldo"],
    ["01/09/2026", "Transferencia de Juan Pérez 12.345.678-9", "", "150.000", 1_150_000],
    ["02/09/2026", "Pago proveedor Beta Ltda", "40.000", "", 1_110_000],
    ["03/09/2026", "Abono cliente María Soto", "", "$ 25.000", 1_135_000],
  ];
  const g = grillaEnmascarada(rows);

  it("no viaja ningún nombre, RUT ni glosa real", () => {
    for (const secreto of ["EMPRESA", "FICTICIA", "11.111.111-1", "Juan", "Pérez", "12.345.678-9", "Beta", "María", "Soto", "Transferencia", "proveedor"]) {
      expect(g).not.toContain(secreto);
    }
  });
  it("tampoco viaja ningún monto real (solo su forma)", () => {
    for (const monto of ["150.000", "40.000", "25.000", "1150000", "1110000", "1135000"]) expect(g).not.toContain(monto);
    expect(g).toContain("[3] 93.93"); // "150.000" → forma
    expect(g).toContain("[4] #7"); // número tipado de 7 dígitos
  });
  it("los TÍTULOS sí viajan (son el formato del banco, no datos)", () => {
    expect(g).toContain("fila 1: [0] Fecha | [1] Descripción | [2] Cargos | [3] Abonos | [4] Saldo");
  });
  it("las banderas de dirección (A/C, Cargo/Abono) viajan tal cual: no identifican a nadie", () => {
    expect(formaDeCelda("A")).toBe("A");
    expect(formaDeCelda("Cargo")).toBe("Cargo");
    expect(formaDeCelda("Transf de EMPRESA")).toBe("Aa5 a2 A7");
  });
});

describe("mapaPorIA: proveedor fijo, timeout y fallas", () => {
  const cartola = todasLasCartolas().find((c) => c.nombre === "chile/base")!;
  const respuesta = (args: Record<string, unknown>) => new Response(JSON.stringify({
    choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }],
  }), { status: 200 });

  it("llama a DeepSeek por OpenCode Go con session id y User-Agent (nunca Fireworks)", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => respuesta({
      layout: "two_cols", header_row: 5, primera_fila_datos: 6, date_format: "dd/mm/yyyy", number_format: "chilean",
      fecha: 0, descripcion: 1, n_documento: -1, cargo: 3, abono: 4, saldo: 5, monto: -1, tipo_flujo_col: -1, razon: "x",
    }));
    const r = await mapaPorIA(cartola.rows, { fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: "k" });
    expect(r.cfg?.columns).toMatchObject({ fecha: 0, descripcion: 1, cargo: 3, abono: 4, saldo: 5 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(OPENCODE_GO_CHAT_URL);
    expect(String(url)).not.toMatch(/fireworks/i);
    const h = init!.headers as Record<string, string>;
    expect(h["x-opencode-session"]).toBeTruthy();
    expect(h["User-Agent"]).toMatch(/massdte/);
    const body = JSON.parse(String(init!.body));
    expect(body.model).toBe(MODELO_ESTRUCTURA);
    expect(body.tool_choice.function.name).toBe("mapa_cartola");
    expect(body.tools[0].function.strict).toBe(true);
    // Ni una glosa real en lo que se manda.
    expect(String(init!.body)).not.toContain("EMPRESA ALFA");
  });

  it("si tarda más que el timeout, se sigue sin IA (cfg null, error timeout)", async () => {
    const lento = ((_: unknown, init?: RequestInit) => new Promise((_ok, fail) => {
      init?.signal?.addEventListener("abort", () => fail(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })) as unknown as typeof fetch;
    const r = await mapaPorIA(cartola.rows, { fetchImpl: lento, apiKey: "k", timeoutMs: 20 });
    expect(r.cfg).toBeNull();
    expect(r.error).toBe("timeout");
  });

  it("HTTP 500, sin tool_call o índices fuera de rango → null, nunca lanza", async () => {
    const f500 = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    expect((await mapaPorIA(cartola.rows, { fetchImpl: f500, apiKey: "k" })).cfg).toBeNull();
    const malo = (async () => respuesta({ layout: "two_cols", header_row: 0, primera_fila_datos: 1, date_format: "x", number_format: "chilean",
      fecha: 0, descripcion: 1, n_documento: -1, cargo: 99, abono: 4, saldo: -1, monto: -1, tipo_flujo_col: -1, razon: "" })) as unknown as typeof fetch;
    expect((await mapaPorIA(cartola.rows, { fetchImpl: malo, apiKey: "k" })).cfg).toBeNull();
  });

  it("sin API key no llama a nadie", async () => {
    const f = vi.fn();
    const prev = process.env.OPENCODE_GO_API_KEY;
    delete process.env.OPENCODE_GO_API_KEY;
    const r = await mapaPorIA(cartola.rows, { fetchImpl: f as unknown as typeof fetch });
    if (prev !== undefined) process.env.OPENCODE_GO_API_KEY = prev;
    expect(r.cfg).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("el flag LECTOR_ESTRUCTURA_IA está apagado por defecto", () => {
    expect(estructuraIaActiva({})).toBe(false);
    expect(estructuraIaActiva({ LECTOR_ESTRUCTURA_IA: "1" })).toBe(true);
  });

  it("el number_format NO se le cree a la IA: sale de las celdas", () => {
    const c = todasLasCartolas().find((x) => x.nombre === "chile/montos_formato_ingles")!;
    const cfg = configDesdeRespuesta({ layout: "two_cols", header_row: 5, primera_fila_datos: 6, date_format: "dd/mm/yyyy", number_format: "chilean",
      fecha: 0, descripcion: 1, n_documento: -1, cargo: 3, abono: 4, saldo: 5, monto: -1, tipo_flujo_col: -1 }, c.rows);
    expect(cfg?.number_format).toBe("generic");
  });
});

describe("política de DOS OPINIONES", () => {
  const e = (firma: string, sello: "saldo" | "total_banco" | "sin_comprobar", valido = true) => ({ firma, sello, valido });
  it("iguales → el lector, sin disputa", () => {
    expect(decidirDosOpiniones(e("a", "saldo"), e("a", "saldo"))).toEqual({ elegido: "lector", disputa: null });
    expect(decidirDosOpiniones(e("a", "sin_comprobar"), e("a", "sin_comprobar"))).toEqual({ elegido: "lector", disputa: null });
  });
  it("distintos → gana el ÚNICO con prueba", () => {
    expect(decidirDosOpiniones(e("a", "sin_comprobar"), e("b", "saldo")).elegido).toBe("ia");
    expect(decidirDosOpiniones(e("a", "total_banco"), e("b", "sin_comprobar")).elegido).toBe("lector");
  });
  it("distintos y ninguno (o ambos) con prueba → provisorio con disputa (se pregunta al cliente)", () => {
    expect(decidirDosOpiniones(e("a", "sin_comprobar"), e("b", "sin_comprobar")).disputa).toBeTruthy();
    expect(decidirDosOpiniones(e("a", "saldo"), e("b", "saldo")).disputa).toBeTruthy();
  });
  it("solo uno válido → ese; la IA sola sin prueba deja disputa visible", () => {
    expect(decidirDosOpiniones(e("a", "sin_comprobar"), null)).toEqual({ elegido: "lector", disputa: null });
    const soloIa = decidirDosOpiniones(null, e("b", "sin_comprobar"));
    expect(soloIa.elegido).toBe("ia");
    expect(soloIa.disputa).toBeTruthy();
    expect(decidirDosOpiniones(null, null).elegido).toBeNull();
  });
});
