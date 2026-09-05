import { NextResponse } from "next/server";
import { requireMcpAccess } from "@/lib/mcp/auth";
import { handleMcpRpc, type McpTools } from "@/lib/mcp/server";
import { getPendientesEmision, type EmpresaCtx } from "@/lib/intermediario/pendientes-emision";
import { clientIpFromRequest, rateLimitKey } from "@/lib/security/rate-limit";
import { enforceRateLimitGlobal } from "@/lib/security/rate-limit-global";
import { chileDateString } from "@/lib/chile-date";
import { recordOpsEvent } from "@/lib/ops/events";

// Conector MCP de massDTE — copiloto de revisión (lee y ORDENA; no emite).
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
// VOCABULARIO (fundador 2026-09-04): en este producto NUNCA se "aprueba" —
// se JUZGA. El acto de aprobación es apretar Emitir, y ese es del humano en la
// app. Todo lo que sale a la superficie (descripción de tools, pantalla de
// consentimiento, auditoría) dice "dejar listo" u "ordenar", jamás "aprobar".
// El valor 'aprobado' de la columna es interno y no promete nada al cliente.
//
// Las escrituras del catálogo son DOS y ambas son pre-emisión y reversibles
// (mueven documentos entre baldes, nada irreversible). La primera es
// DESESCALANTE (regla del fundador,
// 2026-09-01): devolver_a_revision mueve documentos listos DE VUELTA al
// check humano — la IA puede agregar cautela, jamás quitarla. Aprobar y
// emitir siguen siendo actos del humano en la app.
//
// Techo si roban el token: leer pendientes de UNA empresa autorizada y, como
// mucho, devolver sus documentos listos a revisión (fricción, cero daño).

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
          .select("giro, razon_social, tipo_contribuyente, boletas_tipo_default, facturas_tipo_default")
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
    dejar_en_emitir: {
      def: {
        name: "dejar_en_emitir",
        title: "Dejar en Emitir",
        description:
          "Deja LISTOS en la pestaña Emitir los documentos que ya juzgaste junto al usuario. No aprueba ni emite nada: aprobar es apretar Emitir, y ese acto es siempre del humano en la app. Úsala después de revisar con él qué corresponde documentar — cada documento que él emita descuenta de su plan como siempre.",
        inputSchema: {
          type: "object",
          properties: {
            propuesta_ids: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 50,
              description: "IDs de propuestas (los `id` de pendientes_emision) a dejar listas",
            },
            motivo: { type: "string", description: "Por qué se dejan listos (queda en la auditoría y lo ve el usuario)" },
          },
          required: ["propuesta_ids", "motivo"],
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      run: async (args) => {
        const ids = Array.isArray(args.propuesta_ids)
          ? args.propuesta_ids.filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v))
          : [];
        const motivo = typeof args.motivo === "string" ? args.motivo.trim().slice(0, 300) : "";
        if (ids.length === 0 || ids.length > 50) throw new Error("propuesta_ids: entre 1 y 50 IDs válidos");
        if (!motivo) throw new Error("motivo: obligatorio — di por qué se dejan listos");

        // Solo estados PRE-emisión suben a 'aprobado'. Lo emitido, rechazado o
        // descartado no se toca; NO se escribe cliente_id ni reglas de
        // aprendizaje (la IA externa no alimenta el sistema de reglas).
        const { count, error } = await ctx.svc
          .from("propuestas_ia")
          .update({ estado: "aprobado" }, { count: "exact" })
          .in("id", ids)
          .eq("empresa_id", ctx.empresaId)
          .in("estado", ["pendiente", "editado", "listo"]);
        if (error) throw new Error("No se pudieron dejar listas las propuestas");

        const listas = count ?? 0;
        await recordOpsEvent({
          severity: listas >= 20 ? "warn" : "info",
          source: "auth",
          eventName: "mcp_dejar_en_emitir",
          summary: `MCP dejó ${listas}/${ids.length} propuesta(s) listas en Emitir: ${motivo}`,
          empresaId: ctx.empresaId,
          usuarioId: ctx.usuarioId,
          resourceType: "propuestas_ia",
          metadata: { listas, solicitadas: ids.length, origen: "mcp", token_id: ctx.tokenId },
        });
        return {
          listas,
          solicitadas: ids.length,
          nota:
            listas === ids.length
              ? "Documentos listos y esperando en la pestaña Emitir. Aprobar y emitir es del usuario, en la app."
              : `${listas} dejada(s) lista(s); el resto no estaba en estado pre-emisión (quizás ya se emitió o fue descartada).`,
        };
      },
    },
    devolver_a_revision: {
      def: {
        name: "devolver_a_revision",
        title: "Devolver a revisión",
        description:
          "Devuelve documentos que están LISTOS para emitir al balde 'por revisar' (el check humano). Es la única escritura de este conector y solo agrega supervisión: nunca aprueba ni emite. Úsala cuando detectes algo raro en un documento listo — monto que no calza, receptor dudoso, posible duplicado — explicando el motivo.",
        inputSchema: {
          type: "object",
          properties: {
            propuesta_ids: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 50,
              description: "IDs de propuestas (los `id` de pendientes_emision) a devolver al check",
            },
            motivo: { type: "string", description: "Por qué se devuelven (queda en la auditoría y lo ve el usuario)" },
          },
          required: ["propuesta_ids", "motivo"],
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      run: async (args) => {
        const ids = Array.isArray(args.propuesta_ids)
          ? args.propuesta_ids.filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v))
          : [];
        const motivo = typeof args.motivo === "string" ? args.motivo.trim().slice(0, 300) : "";
        if (ids.length === 0 || ids.length > 50) throw new Error("propuesta_ids: entre 1 y 50 IDs válidos");
        if (!motivo) throw new Error("motivo: obligatorio — di por qué se devuelve");

        // Guard: con una emisión EN CURSO no se toca la mesa (el runner del
        // lote está leyendo lo aprobado; moverle el piso a mitad de lote es
        // pedirse un descuadre). Pausa y que el humano decida.
        const { data: jobVivo, error: jobErr } = await ctx.svc
          .from("emision_jobs")
          .select("job_id")
          .eq("empresa_id", ctx.empresaId)
          .eq("estado", "running")
          .limit(1);
        if (jobErr) throw new Error("No se pudo verificar si hay una emisión en curso");
        if (jobVivo && jobVivo.length > 0) {
          return {
            devueltas: 0,
            error: "EMISION_EN_CURSO",
            nota: "Hay una emisión corriendo en este momento; no se puede devolver nada hasta que termine. Pídele al usuario reintentar cuando cierre el lote.",
          };
        }

        // Solo estados PRE-emisión "staged" vuelven al check. Lo emitido, lo
        // descartado y lo pendiente no se tocan (idempotente por construcción).
        const { count, error } = await ctx.svc
          .from("propuestas_ia")
          .update({ estado: "pendiente" }, { count: "exact" })
          .in("id", ids)
          .eq("empresa_id", ctx.empresaId)
          .in("estado", ["aprobado", "listo"]);
        if (error) throw new Error("No se pudieron devolver los documentos");

        const devueltas = count ?? 0;
        await recordOpsEvent({
          severity: devueltas >= 20 ? "warn" : "info",
          source: "auth",
          eventName: "mcp_devolver_a_revision",
          summary: `MCP devolvió ${devueltas}/${ids.length} documento(s) a revisión: ${motivo}`,
          empresaId: ctx.empresaId,
          usuarioId: ctx.usuarioId,
          resourceType: "propuestas_ia",
          metadata: { devueltas, solicitadas: ids.length, origen: "mcp", token_id: ctx.tokenId },
        });
        return {
          devueltas,
          solicitadas: ids.length,
          nota:
            devueltas === ids.length
              ? "Documentos devueltos al balde 'por revisar'. El usuario los verá en el Check de agregados."
              : `${devueltas} devuelto(s); el resto no estaba en estado listo/aprobado (quizás ya se emitió o ya estaba en revisión).`,
        };
      },
    },
  };
}

export async function POST(request: Request) {
  // Throttle PRE-AUTH por IP (hallazgo del escéptico): sin esto, cada token
  // basura de un bot dispara un SELECT a mcp_tokens antes de cualquier
  // freno — amplificación de carga sin autenticar. Generoso para clientes
  // reales (los MCP hosts hacen pocas llamadas/min); fallback local OK acá
  // (es disponibilidad, no escritura anónima).
  const preLimited = await enforceRateLimitGlobal({
    key: rateLimitKey("mcp-preauth", clientIpFromRequest(request)),
    limit: 120,
    windowMs: 60_000,
  });
  if (preLimited) return preLimited;

  const access = await requireMcpAccess(request);
  if (!access.ok) {
    // Descubrimiento OAuth (RFC 9728): el 401 le dice al cliente MCP dónde
    // está el metadata del recurso para iniciar el flujo de autorización.
    const headers: Record<string, string> = {};
    if (access.status === 401) {
      const origin = new URL(request.url).origin;
      headers["WWW-Authenticate"] = `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`;
    }
    return NextResponse.json({ error: access.error }, { status: access.status, headers });
  }

  const limited = await enforceRateLimitGlobal({
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
