import { describe, expect, it } from "vitest";
import { handleMcpRpc, MCP_PROTOCOL_VERSION, type McpTools } from "./server";
import { generarMcpToken, hashMcpToken, tokenDesdeAuthorization, MCP_TOKEN_PREFIX } from "./token";

// Protege el contrato del conector MCP: catálogo SIN verbo de emisión
// (barrera #2), JSON-RPC bien formado, y tokens que no viajan en claro.

const tools: McpTools = {
  pendientes_emision: {
    def: {
      name: "pendientes_emision",
      description: "lee pendientes",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    run: async () => ({ totales: { listas: 2 } }),
  },
  que_explota: {
    def: { name: "que_explota", description: "x", inputSchema: { type: "object" } },
    run: async () => { throw new Error("se cayó"); },
  },
};

describe("handleMcpRpc — protocolo", () => {
  it("initialize responde versión y capacidades, y declara que NO emite", async () => {
    const out = await handleMcpRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, tools);
    expect(out.status).toBe(200);
    const result = (out as { json: { result: { protocolVersion: string; instructions: string } } }).json.result;
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.instructions).toContain("NO emite");
  });

  it("tools/list expone el catálogo — y NINGUNA herramienta de emisión (barrera #2)", async () => {
    const out = await handleMcpRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tools);
    const lista = (out as { json: { result: { tools: Array<{ name: string }> } } }).json.result.tools;
    expect(lista.map((t) => t.name)).toContain("pendientes_emision");
    for (const t of lista) {
      // Tercer verbo vetado (fundador, 2026-09-01): APROBAR. La única
      // escritura permitida es DESESCALANTE (devolver_a_revision) — la IA
      // puede mandar documentos DE VUELTA al check humano, jamás hacia la
      // emisión. Aprobar escala (deja listo para emitir) y queda del lado
      // del humano en la app.
      expect(t.name).not.toMatch(/emitir|emision_real|firmar|aprobar/);
      // REGLA ETERNA del fundador (2026-08-31): la boleta/factura ÚNICA es el
      // canal gratis (sin propuesta_id → no descuenta tier) y su fricción
      // manual ES el modelo de negocio. Una tool de única en el MCP dejaría
      // a la IA convertir una cartola de 100 movs en 100 únicas gratis.
      // TODO lo que entre por MCP entra al tier: los write-tools futuros solo
      // crean PROPUESTAS (con propuesta_id ⇒ contarMasivas las cuenta).
      expect(t.name).not.toMatch(/unic/i);
    }
  });

  it("tools/call ejecuta y envuelve el resultado como content de texto", async () => {
    const out = await handleMcpRpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pendientes_emision", arguments: {} } },
      tools,
    );
    const result = (out as { json: { result: { content: Array<{ type: string; text: string }> } } }).json.result;
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ totales: { listas: 2 } });
  });

  it("las DOS manos del copiloto (freno y staging) SÍ pasan el veto de runtime", async () => {
    const conManos = {
      ...tools,
      devolver_a_revision: { def: { name: "devolver_a_revision", description: "x", inputSchema: {} }, run: async () => ({}) },
      dejar_en_emitir: { def: { name: "dejar_en_emitir", description: "x", inputSchema: {} }, run: async () => ({}) },
    };
    const out = await handleMcpRpc({ jsonrpc: "2.0", id: 8, method: "tools/list" }, conManos);
    const lista = (out as { json: { result: { tools: Array<{ name: string }> } } }).json.result.tools;
    expect(lista.map((t) => t.name)).toContain("dejar_en_emitir");
  });

  it("un catálogo con verbo vetado (aprobar/emitir/única) apaga el servidor entero", async () => {
    const saboteado = {
      ...tools,
      aprobar_propuesta: { def: { name: "aprobar_propuesta", description: "x", inputSchema: {} }, run: async () => ({}) },
    };
    const out = await handleMcpRpc({ jsonrpc: "2.0", id: 9, method: "tools/list" }, saboteado);
    const err = (out as { json: { error: { code: number; message: string } } }).json.error;
    expect(err.code).toBe(-32603);
    expect(err.message).toContain("aprobar_propuesta");
  });

  it("herramienta desconocida → error -32602, jamás ejecución", async () => {
    const out = await handleMcpRpc(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "emitir_boleta", arguments: {} } },
      tools,
    );
    expect((out as { json: { error: { code: number } } }).json.error.code).toBe(-32602);
  });

  it("un throw de herramienta sale como isError, no como excepción cruda", async () => {
    const out = await handleMcpRpc(
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "que_explota" } },
      tools,
    );
    const result = (out as { json: { result: { isError?: boolean } } }).json.result;
    expect(result.isError).toBe(true);
  });

  it("notificaciones (sin id) → 202 sin cuerpo", async () => {
    const out = await handleMcpRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, tools);
    expect(out.status).toBe(202);
  });

  it("método desconocido → -32601; batch → -32600", async () => {
    const m = await handleMcpRpc({ jsonrpc: "2.0", id: 6, method: "resources/list" }, tools);
    expect((m as { json: { error: { code: number } } }).json.error.code).toBe(-32601);
    const b = await handleMcpRpc([{ jsonrpc: "2.0", id: 7, method: "ping" }], tools);
    expect((b as { json: { error: { code: number } } }).json.error.code).toBe(-32600);
  });
});

describe("tokens — no viajan ni se guardan en claro", () => {
  it("el token generado lleva prefijo reconocible y largo suficiente", () => {
    const t = generarMcpToken();
    expect(t.startsWith(MCP_TOKEN_PREFIX)).toBe(true);
    expect(t.length).toBeGreaterThan(40);
  });

  it("el hash es estable y distinto del token", () => {
    const t = generarMcpToken();
    expect(hashMcpToken(t)).toBe(hashMcpToken(t));
    expect(hashMcpToken(t)).not.toContain(MCP_TOKEN_PREFIX);
  });

  it("solo acepta Bearer con el prefijo del conector (fail-closed)", () => {
    const t = generarMcpToken();
    expect(tokenDesdeAuthorization(`Bearer ${t}`)).toBe(t);
    expect(tokenDesdeAuthorization(`bearer ${t}`)).toBe(t);
    expect(tokenDesdeAuthorization(`Bearer otra-cosa`)).toBeNull();
    expect(tokenDesdeAuthorization(`Basic ${t}`)).toBeNull();
    expect(tokenDesdeAuthorization(null)).toBeNull();
    expect(tokenDesdeAuthorization(`Bearer ${MCP_TOKEN_PREFIX}corto`)).toBeNull();
  });
});
