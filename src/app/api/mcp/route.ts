import { NextResponse } from "next/server";
import { requireMcpAccess } from "@/lib/mcp/auth";
import { handleMcpRpc, type McpTools } from "@/lib/mcp/server";
import { getPendientesEmision, type EmpresaCtx } from "@/lib/intermediario/pendientes-emision";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { chileDateString } from "@/lib/chile-date";

// Conector MCP de massDTE — copiloto de revisión (fase 1, solo lectura).
//
// Las 4 barreras independientes que impiden que este canal emita:
//  1. IDENTIDAD (lib/mcp/auth.ts): el token hereda veto/membresía/plan con
//     validarAccesoCuenta; la empresa se DERIVA del usuario, jamás viene
//     como argumento.
//  2. CATÁLOGO (lib/mcp/server.ts + acá): no existe herramienta de emisión.
//  3. ROL: aunque alguien agregara una, la emisión real (emitir-boleta/lote)
//     exige ROLES_EMISION + cuota + write-block de soporte por SU ruta.
//  4. CRIPTO: emitir exige la bóveda SII (llave partida), que solo se abre
//     con la sesión-navegador del propio usuario. Este servidor no la tiene.
//
// Techo si roban el token: leer pendientes de UNA empresa autorizada.

function construirTools(ctx: Awaited<ReturnType<typeof requireMcpAccess>> & { ok: true }): McpTools {
  return {
    pendientes_emision: {
      def: {
        name: "pendientes_emision",
        title: "Pendientes de emisión",
        description:
          "Lista los documentos agregados en la mesa (boletas o facturas) con su balde: listas para emitir, por revisar, o bloqueadas (y por qué). Úsala para ayudar con el check antes de que el usuario emita en la app.",
        inputSchema: {
          type: "object",
          properties: {
            mesa: { type: "string", enum: ["boleta", "factura"], description: "Mesa a consultar (default: boleta)" },
          },
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      run: async (args) => {
        const mesa = args.mesa === "factura" ? ("factura" as const) : ("boleta" as const);
        const { data: empresa } = await ctx.svc
          .from("empresas")
          .select("giro, razon_social, tipo_contribuyente")
          .eq("id", ctx.empresaId)
          .maybeSingle();
        const empresaCtx = (empresa as EmpresaCtx | null) ?? { giro: null, razon_social: "", tipo_contribuyente: null };
        const result = await getPendientesEmision(ctx.svc, ctx.empresaId, empresaCtx, undefined, { mesa });
        return {
          mesa,
          totales: result.totales,
          items: result.items,
          nota: "Este conector no emite: la emisión es un acto del humano en la app (pestaña Emitir).",
        };
      },
    },
    resumen_del_mes: {
      def: {
        name: "resumen_del_mes",
        title: "Resumen del mes",
        description:
          "Cuenta y suma los documentos EMITIDOS con massDTE en el mes en curso (facturas por folio, boletas incluidas). Espejo del lado massDTE del cuadre RCV.",
        inputSchema: { type: "object", properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      run: async () => {
        const mes = chileDateString().slice(0, 7);
        const { data, error } = await ctx.svc
          .from("boletas_emitidas")
          .select("monto_total, tipo_dte, estado, folio, fecha_emision")
          .eq("empresa_id", ctx.empresaId)
          .gte("fecha_emision", `${mes}-01`)
          .limit(2000);
        if (error) throw new Error("No se pudo leer lo emitido del mes");
        const emitidas = (data ?? []).filter((b) => b.estado !== "anulada");
        const total = emitidas.reduce((sum, b) => sum + (typeof b.monto_total === "number" ? b.monto_total : 0), 0);
        const porTipo: Record<string, number> = {};
        for (const b of emitidas) {
          const k = String(b.tipo_dte ?? "39");
          porTipo[k] = (porTipo[k] ?? 0) + 1;
        }
        return { mes, documentos: emitidas.length, monto_total: total, por_tipo_dte: porTipo };
      },
    },
  };
}

export async function POST(request: Request) {
  const access = await requireMcpAccess(request);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const limited = enforceRateLimit({
    key: rateLimitKey("mcp", access.usuarioId),
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } }, { status: 400 });
  }

  const outcome = await handleMcpRpc(body, construirTools(access));
  if (!("json" in outcome)) return new Response(null, { status: 202 });
  return NextResponse.json(outcome.json, { status: outcome.status });
}

// Sin stream SSE en fase 1: el transporte streamable HTTP permite responder
// JSON directo y rechazar GET.
export async function GET() {
  return NextResponse.json({ error: "SSE no soportado; usa POST JSON-RPC" }, { status: 405 });
}

export const dynamic = "force-dynamic";
