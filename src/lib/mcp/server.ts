// Servidor MCP de massDTE — manejo JSON-RPC, framework-free y testeable.
//
// El conector es un COPILOTO DE REVISIÓN: lee el estado de la mesa y de los
// pendientes para que la IA del cliente (Claude, ChatGPT, etc.) le ayude con
// el check; el humano emite en la app. Las 4 barreras que impiden que emita
// (ver route.ts) empiezan acá con la #2: el catálogo NO TIENE verbo de
// emisión — "emitir" ni siquiera existe como herramienta.
//
// REGLA DE NEGOCIO (fundador, 2026-08-31): "todo lo que entra por MCP entra
// al tier". La ÚNICA (boleta/factura del formulario manual) es el canal
// gratis — sin propuesta_id, no descuenta cupo — y su fricción de a-una ES
// el modelo. Por eso: (1) jamás una tool de única (el test lo hace morder);
// (2) los write-tools futuros (staging fase 2) solo crean PROPUESTAS, que
// nacen con propuesta_id y por construcción las cuenta contarMasivas;
// (3) los endpoints de única autentican por cookie de sesión — el Bearer
// del MCP ni siquiera puede tocarlos.
//
// Protocolo: MCP streamable HTTP, respuestas JSON directas (sin SSE). Solo
// requests individuales (el spec 2025 eliminó el batching).

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export type McpToolDef = {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

export type McpTool = {
  def: McpToolDef;
  run: (args: Record<string, unknown>) => Promise<unknown>;
};

export type McpTools = Record<string, McpTool>;

export type McpRpcOutcome =
  | { status: 202 }
  | { status: 200; json: unknown };

type RpcRequest = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };

function rpcError(id: unknown, code: number, message: string): McpRpcOutcome {
  return { status: 200, json: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } };
}

function rpcResult(id: unknown, result: unknown): McpRpcOutcome {
  return { status: 200, json: { jsonrpc: "2.0", id: id ?? null, result } };
}

// Verbos VETADOS en el catálogo, con dientes en runtime (no solo en tests):
// emitir/firmar (barrera #2), unic (regla eterna de la única: el canal gratis
// jamás se automatiza) y aprobar. Si alguien registra una tool con estos
// nombres, el servidor entero se niega a atender: el error es imposible de no
// ver en el primer smoke.
//
// Las DOS manos del copiloto viven en una allowlist EXACTA de escritura
// (decisión del fundador 2026-09-01): devolver_a_revision (el freno) y
// dejar_en_emitir (el staging — deja propuestas en la pestaña Emitir; el
// botón Emitir sigue siendo un acto del humano en la app, y todo lo staged
// nace con propuesta_id ⇒ descuenta tier al emitir). Cualquier otra tool
// cuyo nombre roce los verbos vetados muere acá.
const NOMBRES_VETADOS = /emitir|emision_real|firmar|aprobar|unic/i;
const ESCRITURAS_PERMITIDAS = new Set(["devolver_a_revision", "dejar_en_emitir"]);

export async function handleMcpRpc(
  body: unknown,
  tools: McpTools,
  serverInfo = { name: "massdte", version: "0.1.0" },
): Promise<McpRpcOutcome> {
  const vetada = Object.keys(tools).find((n) => !ESCRITURAS_PERMITIDAS.has(n) && NOMBRES_VETADOS.test(n));
  if (vetada) {
    return rpcError(null, -32603, `Catálogo inválido: la herramienta "${vetada}" usa un verbo vetado (emitir/firmar/aprobar/única no existen en este conector)`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return rpcError(null, -32600, "Se espera UN request JSON-RPC 2.0 (sin batch)");
  }
  const req = body as RpcRequest;
  const method = typeof req.method === "string" ? req.method : "";
  const esNotificacion = !("id" in req);

  // Notificaciones (initialized, cancelled…): se aceptan sin cuerpo.
  if (esNotificacion) return { status: 202 };

  switch (method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
        instructions:
          "Copiloto de revisión de massDTE: lee pendientes y resúmenes para ayudar con el check. " +
          "NO emite documentos tributarios — la emisión es siempre un acto del humano en la app.",
      });
    case "ping":
      return rpcResult(req.id, {});
    case "tools/list":
      return rpcResult(req.id, { tools: Object.values(tools).map((t) => t.def) });
    case "tools/call": {
      const name = typeof req.params?.name === "string" ? req.params.name : "";
      const tool = tools[name];
      if (!tool) return rpcError(req.id, -32602, `Herramienta desconocida: ${name || "(sin nombre)"}`);
      const args =
        req.params?.arguments && typeof req.params.arguments === "object" && !Array.isArray(req.params.arguments)
          ? (req.params.arguments as Record<string, unknown>)
          : {};
      try {
        const out = await tool.run(args);
        return rpcResult(req.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (error) {
        // Error de herramienta: va como resultado isError (spec MCP), sin
        // filtrar detalles internos.
        const msg = error instanceof Error ? error.message : "Error ejecutando la herramienta";
        return rpcResult(req.id, { content: [{ type: "text", text: msg }], isError: true });
      }
    }
    default:
      return rpcError(req.id, -32601, `Método no soportado: ${method || "(sin método)"}`);
  }
}
