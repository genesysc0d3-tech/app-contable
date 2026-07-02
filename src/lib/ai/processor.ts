import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { getAIProvider } from "./provider";
import { getSystemPrompt, getClassifyOnlySystemPrompt } from "./prompt";
import type {
  MovimientoExtraido,
  PropuestaExtraida,
  ProgresoIA,
  DuplicadoDetalle,
} from "./types";
import type { PreExtractedMovimiento } from "../parsers/types";
import { parseFecha } from "./fecha";
import { normalizarTipoPorEmisor, esVentaExentaEmisor } from "./tipo-emisor";
import { validarRut, formatRut } from "../rut";
import {
  loadReglas,
  classifyWithRules,
  incrementRuleUsage,
  type ClasificacionRegla,
} from "./classifier";
import { recordOpsEvent } from "../ops/events";

/** Extended propuesta with SII traceability fields used internally. */
type EnrichedPropuesta = PropuestaExtraida & {
  __fuente?: "regla_usuario" | "regla_global" | "mistral";
  __regla_id?: string | null;
};

const MISTRAL_MAX_CONFIANZA = 0.75; // Cap Mistral classifications — never auto-approve

const CHUNK_SIZE = 100;
const MAX_RETRIES = 3;
const MAX_CONCURRENT = 7;
const DB_BATCH_SIZE = 100;
const MIN_CONFIANZA = 0.6;
// Pre-stageo: una tx nace "listo" (staged, NO emitido) solo si supera este umbral Y
// viene de una regla REAL (regla_id presente). El clasificador IA (OpenCode) está
// capado en MISTRAL_MAX_CONFIANZA (0.75, nombre legacy) y el atajo "template" (asume boleta @0.95 sin match)
// NO lleva regla_id → ninguno de esos auto-stagea: quedan "pendiente" para que el
// usuario los prepare con un gesto de bulk deliberado. El Aprobar atómico
// (aprobarCartola) sigue siendo el único gatillo hacia Emitir. Banda ALTA=0.85 del visor.
const AUTO_STAGE_THRESHOLD = 0.85;

/** Sanitize a value that should be numeric but Mistral may return as "null" string */
function toNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "null" || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

/** Normalize tipo_propuesto to valid check constraint values */
const VALID_TIPOS = new Set([
  "boleta", "factura", "exenta", "gasto", "registro_crypto", "ignorar",
  "boleta_honorarios", "factura_afecta", "factura_exenta", "compraventa_crypto",
  "transferencia_p2p", "operacion_forex", "gasto_egreso", "no_comercial",
  "impuesto", "cotizacion_previsional", "remuneracion", "arriendo",
  "dividendo", "comision", "interes", "retencion", "donacion",
]);
function normTipo(val: string | null | undefined): string {
  if (!val) return "no_comercial";
  const s = val.trim().toLowerCase();
  if (VALID_TIPOS.has(s)) return s;
  // Common Mistral variations
  if (s.includes("crypto") || s.includes("bitcoin") || s.includes("usdt")) return "compraventa_crypto";
  if (s.includes("p2p") || s.includes("transferencia")) return "transferencia_p2p";
  if (s.includes("forex") || s.includes("divisa")) return "operacion_forex";
  if (s.includes("boleta") || s.includes("honorario")) return "boleta_honorarios";
  if (s.includes("factura") && (s.includes("exent") || s.includes("no afect"))) return "factura_exenta";
  if (s.includes("factura")) return "factura_afecta";
  if (s.includes("impuesto") || s.includes("f29") || s.includes("ppm") || s.includes("tgr") || s.includes("contribucion")) return "impuesto";
  if (s.includes("afp") || s.includes("isapre") || s.includes("fonasa") || s.includes("cotizacion")) return "cotizacion_previsional";
  if (s.includes("sueldo") || s.includes("remuneracion") || s.includes("finiquito")) return "remuneracion";
  if (s.includes("arriendo") || s.includes("alquiler")) return "arriendo";
  if (s.includes("dividendo") || s.includes("retiro de utilidad")) return "dividendo";
  if (s.includes("comision") || s.includes("comisiones")) return "comision";
  if (s.includes("interes") || s.includes("intereses")) return "interes";
  if (s.includes("retencion")) return "retencion";
  if (s.includes("donacion") || s.includes("donativo")) return "donacion";
  if (s.includes("gasto") || s.includes("egreso") || s.includes("pago")) return "gasto_egreso";
  return "no_comercial";
}

function getServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function updateProgreso(documentoId: string, progreso: ProgresoIA) {
  const supabase = getServiceClient();
  await supabase
    .from("documentos_subidos")
    .update({
      progreso_ia:
        progreso as unknown as Database["public"]["Tables"]["documentos_subidos"]["Update"]["progreso_ia"],
    })
    .eq("id", documentoId);
}

function splitIntoChunks(lines: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    chunks.push(lines.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

interface ChunkResult {
  index: number;
  movimientos: MovimientoExtraido[];
  propuestas: PropuestaExtraida[];
  tokens_input: number;
  tokens_output: number;
  modelo: string;
  finish_reason?: string | null;
  raw_response_length?: number;
}

async function processChunkWithRetry(
  chunkIndex: number,
  chunkText: string,
  systemPrompt: string,
  contextoEmpresa = ""
): Promise<ChunkResult> {
  const provider = getAIProvider();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await provider.extractMovimientos(
        contextoEmpresa ? `${contextoEmpresa}\n\n${chunkText}` : chunkText,
        systemPrompt
      );
      return {
        index: chunkIndex,
        movimientos: response.result.movimientos ?? [],
        propuestas: response.result.propuestas ?? [],
        tokens_input: response.tokens_input,
        tokens_output: response.tokens_output,
        modelo: response.modelo,
        finish_reason: response.finish_reason ?? null,
        raw_response_length: response.raw_response_length ?? 0,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError;
}

/**
 * Bypass-mode chunk: the movimientos are already extracted deterministically
 * by the parser. We only ask Mistral to classify each one. The returned
 * movimientos in ChunkResult echo the input (never modified) so the
 * downstream code works unchanged.
 */
async function classifyChunkWithRetry(
  chunkIndex: number,
  chunkMovs: MovimientoExtraido[],
  systemPrompt: string
): Promise<ChunkResult> {
  const provider = getAIProvider();
  if (!provider.classifyMovimientos) {
    throw new Error("AI provider does not implement classifyMovimientos — bypass mode unavailable");
  }
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await provider.classifyMovimientos(chunkMovs, systemPrompt);
      // Propuestas with movimiento_index referencing position WITHIN this chunk.
      // If Mistral dropped or mis-indexed some, we fill with defaults so every
      // movimiento has a corresponding propuesta.
      const propuestasByIdx = new Map<number, PropuestaExtraida>();
      for (const p of response.propuestas) {
        if (typeof p.movimiento_index === "number") {
          propuestasByIdx.set(p.movimiento_index, p);
        }
      }
      const completed: PropuestaExtraida[] = chunkMovs.map((m, i) => {
        const existing = propuestasByIdx.get(i);
        if (existing) {
          // Force total to match the deterministic monto — never let Mistral
          // alter the amount.
          return { ...existing, movimiento_index: i, total: m.monto };
        }
        // Fallback: if Mistral didn't return a propuesta for this index,
        // synthesize a neutral one so nothing is lost.
        return {
          movimiento_index: i,
          tipo_propuesto: m.tipo_flujo === "salida" ? "gasto_egreso" : "no_comercial",
          receptor_nombre: null,
          receptor_rut: null,
          monto_neto: m.monto,
          iva: 0,
          total: m.monto,
          confianza: 0.4,
          notas: "fallback: Mistral no devolvió propuesta para este índice",
          spread_compra: null,
          spread_venta: null,
          spread_ganancia: null,
        };
      });

      return {
        index: chunkIndex,
        movimientos: chunkMovs,
        propuestas: completed,
        tokens_input: response.tokens_input,
        tokens_output: response.tokens_output,
        modelo: response.modelo,
        finish_reason: response.finish_reason ?? null,
        raw_response_length: response.raw_response_length ?? 0,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError;
}

async function insertInBatches<T extends Record<string, unknown>>(
  table: "movimientos_raw" | "propuestas_ia",
  rows: T[]
): Promise<{ ids: string[]; error: string | null }> {
  const supabase = getServiceClient();
  const allIds: string[] = [];

  for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
    const batch = rows.slice(i, i + DB_BATCH_SIZE);
    const { data, error } = await supabase
      .from(table)
      .insert(batch as never[])
      .select("id");

    if (error) {
      return { ids: allIds, error: `Error en ${table} batch ${Math.floor(i / DB_BATCH_SIZE) + 1}: ${error.message}` };
    }
    if (data) {
      allIds.push(...data.map((r: { id: string }) => r.id));
    }
  }

  return { ids: allIds, error: null };
}

export async function procesarDocumento(
  documentoId: string,
  empresaId: string,
  contenido: string,
  ocrTokens?: { ocrTokensInput: number; ocrTokensOutput: number },
  preExtracted?: PreExtractedMovimiento[]
): Promise<{ movimientos_total: number; error?: string }> {
  const supabase = getServiceClient();
  const systemPrompt = getSystemPrompt();
  const classifyPrompt = getClassifyOnlySystemPrompt();
  const bypassMode = Array.isArray(preExtracted) && preExtracted.length > 0;

  // Contexto del contribuyente, AISLADO por empresa: se prepende al contenido
  // del flujo de extracción para que el modelo sepa quién vende/recibe y lea
  // bien dirección y montos. Nunca va en el system prompt global (compartido).
  const { data: emp } = await supabase
    .from("empresas")
    .select("razon_social, rut, giro, tipo_contribuyente")
    .eq("id", empresaId)
    .maybeSingle();
  const { data: identidades } = await supabase
    .from("empresa_identidades")
    .select("valor")
    .eq("empresa_id", empresaId);
  const aliasList = (identidades ?? []).map((i) => i.valor).filter(Boolean);
  const contextoEmpresa = emp
    ? "CONTEXTO DEL CONTRIBUYENTE (este documento es para emitir SUS boletas de venta):\n" +
      `- Razón social: «${emp.razon_social}» | RUT: ${emp.rut}` +
      (emp.giro ? ` | Giro: ${emp.giro}` : "") +
      ` | ${emp.tipo_contribuyente === "exento" ? "exento de IVA" : "afecto a IVA"}\n` +
      (aliasList.length ? `- También aparece en sus comprobantes como: ${aliasList.join(", ")}.\n` : "") +
      "- Identifica al contribuyente por su razón social, RUT o esos nombres/cuentas: dinero HACIA él (PARA/destino) = entrada; dinero DESDE él (él pagó/envió) = salida. Decide la dirección por la EVIDENCIA del comprobante (ver PASO 0), NO por defecto.\n" +
      "- Un pago recibido (entrada) NORMALMENTE es una venta a boletear: clasifícalo (compraventa_crypto / factura_afecta / factura_exenta / operacion_forex / transferencia_p2p según corresponda). EXCEPCIÓN — usa 'no_comercial' SOLO con señales CLARAS de no-venta: reembolso/devolución, préstamo/mutuo, transferencia entre cuentas PROPIAS del usuario, aporte de capital, o venta de bien personal usado (Art. 17 N°8 LIR). Una SALIDA (él pagó) es compra/gasto y NO genera boleta."
    : "";

  await supabase
    .from("documentos_subidos")
    .update({ estado: "procesando" })
    .eq("id", documentoId);

  try {
    // Build the chunked work units. In bypass mode we first try to classify
    // each movimiento with deterministic rules (user rules + global rules).
    // Only the leftover unmatched movimientos are sent to Mistral for
    // classification, capped at confianza 0.75 so they always require review.
    type MovChunk = { movs: MovimientoExtraido[] };
    type TextChunk = { text: string[] };
    const movChunks: MovChunk[] = [];
    let textChunks: TextChunk[] = [];

    // Rules engine state (only populated in bypass mode)
    let reglas: ClasificacionRegla[] = [];
    type RuleClassification = {
      propuesta: PropuestaExtraida;
      regla_id: string;
      fuente: "regla_usuario" | "regla_global";
    };
    const ruleClassifications = new Map<number, RuleClassification>();
    // Maps the position of each mov inside the flat forMistral array back
    // to its original index in preExtracted.
    const origIndexByMistralIdx: number[] = [];

    // Result containers (used by both bypass and non-bypass paths)
    const allMovimientos: MovimientoExtraido[] = [];
    const allPropuestas: EnrichedPropuesta[] = [];
    // Template propuestas (auto-classified as boleta, no AI needed)
    const templatePropuestas: EnrichedPropuesta[] = [];

    if (bypassMode) {
      const movs = preExtracted! as MovimientoExtraido[];

      // 1. Rules pass — try to classify each movimiento with user/global rules
      reglas = await loadReglas(empresaId);
      const ruleResult = classifyWithRules(movs, reglas);
      for (const c of ruleResult.clasificados) {
        ruleClassifications.set(c.movimiento_index, {
          propuesta: c.propuesta,
          regla_id: c.regla_id,
          fuente: c.fuente,
        });
      }

      // 2. Detect template format: all entries are simple (fecha+desc+monto,
      // no cargo/abono split, no n_documento). Skip AI entirely, classify
      // all as "boleta" with high confidence.
      const isTemplate = movs.length > 0 &&
        movs.every((m) => m.tipo_flujo === "entrada" && !m.n_documento);

      if (isTemplate) {
        // Auto-classify all noClasificados as "boleta"
        for (const nc of ruleResult.noClasificados) {
          templatePropuestas.push({
            movimiento_index: nc.movimiento_index,
            tipo_propuesto: "boleta" as PropuestaExtraida["tipo_propuesto"],
            receptor_nombre: null,
            receptor_rut: null,
            monto_neto: nc.movimiento.monto,
            iva: 0,
            total: nc.movimiento.monto,
            confianza: 0.95,
            // notas = detalle/glosa EDITABLE por el humano (máxima precedencia en la
            // boleta). NO meter marcadores internos acá: "clasificación automática"
            // ya vive en __fuente="regla_global". Sin edición, la glosa cae a la
            // glosa común de la cartola o a la del banco (ver armar-boleta.ts).
            notas: null,
            spread_compra: null,
            spread_venta: null,
            spread_ganancia: null,
            __fuente: "regla_global",
            __regla_id: null,
          });
        }

        // No Mistral chunks needed
        console.log(
          `[template] ${ruleResult.clasificados.length}/${movs.length} por reglas, ${ruleResult.noClasificados.length} como boleta (template)`
        );
      } else {
      // 2. Chunk only the leftover movs for Mistral classification
      const forMistral: MovimientoExtraido[] = [];
      for (const nc of ruleResult.noClasificados) {
        origIndexByMistralIdx.push(nc.movimiento_index);
        forMistral.push(nc.movimiento);
      }

      console.log(
        `[bypass+rules] ${ruleResult.clasificados.length}/${movs.length} por reglas, ${forMistral.length} a Mistral`
      );

      for (let i = 0; i < forMistral.length; i += CHUNK_SIZE) {
        movChunks.push({ movs: forMistral.slice(i, i + CHUNK_SIZE) });
      }
      }

      // Update rule usage counters (best-effort, non-blocking)
      if (ruleResult.clasificados.length > 0) {
        const ruleIds = ruleResult.clasificados.map((c) => c.regla_id);
        void incrementRuleUsage(ruleIds);
      }
    } else {
      const lines = contenido.split("\n").filter((l) => l.trim());
      const chunked = lines.length > CHUNK_SIZE ? splitIntoChunks(lines) : [lines];
      textChunks = chunked.map((t) => ({ text: t }));
    }

    const totalLotes = bypassMode ? movChunks.length : textChunks.length;

    // Process chunks in parallel, max MAX_CONCURRENT at a time
    const results: ChunkResult[] = new Array(totalLotes);
    let completedCount = 0;
    let totalMovsFound = 0;

    const runBatch = async (start: number): Promise<ChunkResult[]> => {
      if (bypassMode) {
        const batch = movChunks.slice(start, start + MAX_CONCURRENT);
        return Promise.all(
          batch.map((c, i) =>
            classifyChunkWithRetry(start + i, c.movs, classifyPrompt)
          )
        );
      } else {
        const batch = textChunks.slice(start, start + MAX_CONCURRENT);
        return Promise.all(
          batch.map((c, i) =>
            processChunkWithRetry(start + i, c.text.join("\n"), systemPrompt, contextoEmpresa)
          )
        );
      }
    };

    for (let start = 0; start < totalLotes; start += MAX_CONCURRENT) {
      const batchResults = await runBatch(start);

      for (const r of batchResults) {
        results[r.index] = r;
        completedCount++;
        totalMovsFound += r.movimientos.length;

        // Audit logging — save chunk input + Mistral response
        try {
          const chunkInputPreview = bypassMode
            ? JSON.stringify(movChunks[r.index]?.movs.slice(0, 3) ?? []).slice(0, 5000)
            : (textChunks[r.index]?.text.join("\n") ?? "").slice(0, 5000);
          const auditUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/audit_chunks`;
          await fetch(auditUrl, {
            method: "POST",
            headers: {
              "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY!,
              "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              documento_id: documentoId,
              chunk_index: r.index,
              chunk_input: chunkInputPreview,
              mistral_response: JSON.stringify({ movimientos: r.movimientos.slice(0, 3), propuestas: r.propuestas.slice(0, 3) }).slice(0, 5000),
              movimientos_count: r.movimientos.length,
              propuestas_count: r.propuestas.length,
              finish_reason: r.finish_reason ?? null,
              response_full_length: r.raw_response_length ?? 0,
              tokens_output: r.tokens_output,
            }),
          });
        } catch { /* audit is non-blocking */ }
      }

      await updateProgreso(documentoId, {
        estado: "procesando",
        lote_actual: completedCount,
        total_lotes: totalLotes,
        movimientos_encontrados: totalMovsFound,
      });
    }

    // Combine results. In bypass+rules mode, allMovimientos is the original
    // preExtracted list, and allPropuestas merges rule classifications +
    // Mistral classifications (capped at MISTRAL_MAX_CONFIANZA).
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let modelo = "";

    if (bypassMode) {
      // allMovimientos mirrors preExtracted 1:1
      allMovimientos.push(...(preExtracted as MovimientoExtraido[]));

      // Add template auto-classified propuestas (if any)
      for (const tp of templatePropuestas) {
        allPropuestas.push(tp);
      }

      // Start from rule classifications
      for (const [origIdx, rc] of ruleClassifications) {
        allPropuestas.push({
          ...rc.propuesta,
          movimiento_index: origIdx,
          __fuente: rc.fuente,
          __regla_id: rc.regla_id,
        });
      }

      // Add Mistral classifications, remapping chunk-local → original index
      // and capping confianza. Synthesize a neutral fallback if Mistral
      // dropped an index so nothing is lost.
      for (let ci = 0; ci < results.length; ci++) {
        const r = results[ci];
        if (!r) continue;
        const chunkStart = ci * CHUNK_SIZE;
        const chunkMovCount = movChunks[ci]?.movs.length ?? 0;

        const propuestasByLocalIdx = new Map<number, PropuestaExtraida>();
        for (const p of r.propuestas) {
          if (typeof p.movimiento_index === "number") {
            propuestasByLocalIdx.set(p.movimiento_index, p);
          }
        }

        for (let localIdx = 0; localIdx < chunkMovCount; localIdx++) {
          const origIdx = origIndexByMistralIdx[chunkStart + localIdx];
          if (origIdx == null) continue;
          const p = propuestasByLocalIdx.get(localIdx);
          if (p) {
            allPropuestas.push({
              ...p,
              movimiento_index: origIdx,
              confianza: Math.min(p.confianza ?? 0.5, MISTRAL_MAX_CONFIANZA),
              __fuente: "mistral",
              __regla_id: null,
            });
          } else {
            // Mistral dropped this index — add a fallback with low confidence
            const mov = allMovimientos[origIdx];
            allPropuestas.push({
              movimiento_index: origIdx,
              tipo_propuesto:
                mov.tipo_flujo === "salida" ? "gasto_egreso" : "no_comercial",
              receptor_nombre: null,
              receptor_rut: null,
              monto_neto: mov.monto,
              iva: 0,
              total: mov.monto,
              confianza: 0.4,
              notas: "Fallback: Mistral no devolvió propuesta para este movimiento",
              spread_compra: null,
              spread_venta: null,
              spread_ganancia: null,
              __fuente: "mistral",
              __regla_id: null,
            });
          }
        }

        totalTokensInput += r.tokens_input;
        totalTokensOutput += r.tokens_output;
        modelo = r.modelo;
      }

      // Sort propuestas by movimiento_index so downstream code sees them in order
      allPropuestas.sort((a, b) => a.movimiento_index - b.movimiento_index);
    } else {
      // Legacy (non-bypass) path: combine chunked text results with offset
      for (const r of results) {
        if (!r) continue;
        const offset = allMovimientos.length;
        allMovimientos.push(...r.movimientos);

        for (const p of r.propuestas) {
          allPropuestas.push({
            ...p,
            movimiento_index: p.movimiento_index + offset,
            __fuente: "mistral",
            __regla_id: null,
          });
        }

        totalTokensInput += r.tokens_input;
        totalTokensOutput += r.tokens_output;
        modelo = r.modelo;
      }
    }

    // Filter out movimientos with null/empty required fields (Mistral sometimes
    // returns nulls for summary rows, totals, or headers in cartolas)
    const validIndices: number[] = [];
    for (let i = 0; i < allMovimientos.length; i++) {
      const m = allMovimientos[i];
      if (m.descripcion && m.monto != null && m.tipo_flujo) {
        validIndices.push(i);
      }
    }

    const indexRemap = new Map<number, number>();
    validIndices.forEach((origIdx, newIdx) => indexRemap.set(origIdx, newIdx));

    let validMovimientos = validIndices.map((i) => allMovimientos[i]);
    let validPropuestas = allPropuestas
      .filter((p) => indexRemap.has(p.movimiento_index))
      .map((p) => ({ ...p, movimiento_index: indexRemap.get(p.movimiento_index)! }));

    // Filter out probable saldo/balance values extracted by mistake.
    // Rule: if a single monto is >50% of total abonos, it's a balance not a tx.
    // In bypass mode the parser already filtered the saldo column, so this
    // heuristic can only produce false positives (e.g. a legitimate $1.7M
    // transfer in a cartola full of $50K tx). Skip it.
    const totalAbonos = bypassMode
      ? 0
      : validMovimientos
          .filter((m) => m.tipo_flujo === "entrada")
          .reduce((sum, m) => sum + (toNum(m.monto) ?? 0), 0);

    // Solo tiene sentido en un extracto con VARIAS transacciones (el saldo es
    // una línea grande entre muchas chicas). Con pocos movimientos —p. ej. un
    // comprobante único de Telegram, que es 1 solo abono = 100% del total— esta
    // heurística borraría la única venta. Exigir >=5 movimientos para aplicarla.
    if (totalAbonos > 0 && validMovimientos.length >= 5) {
      const threshold = totalAbonos * 0.5;
      const saldoFilter = new Set<number>();
      for (let i = 0; i < validMovimientos.length; i++) {
        const monto = toNum(validMovimientos[i].monto) ?? 0;
        if (monto > threshold) {
          saldoFilter.add(i);
        }
      }
      if (saldoFilter.size > 0) {
        const kept: number[] = [];
        for (let i = 0; i < validMovimientos.length; i++) {
          if (!saldoFilter.has(i)) kept.push(i);
        }
        const saldoRemap = new Map<number, number>();
        kept.forEach((origIdx, newIdx) => saldoRemap.set(origIdx, newIdx));

        validMovimientos = kept.map((i) => validMovimientos[i]);
        validPropuestas = validPropuestas
          .filter((p) => saldoRemap.has(p.movimiento_index))
          .map((p) => ({ ...p, movimiento_index: saldoRemap.get(p.movimiento_index)! }));
      }
    }

    // Detect duplicates: check existing movimientos for this empresa
    // In bypass mode (template format), skip dedup to keep all rows as-is
    let indicesToKeep: number[] = [];
    let duplicadosSaltados = 0;
    let duplicadosDetalle: DuplicadoDetalle[] = [];
    let movimientosToInsert: Record<string, unknown>[] = [];
    let falsosDuplicadosWarning = false;

    if (bypassMode) {
      // Template/bypass: keep all rows, no dedup
      indicesToKeep = validMovimientos.map((_, i) => i);
      movimientosToInsert = validMovimientos.map((m) => ({
        empresa_id: empresaId,
        documento_id: documentoId,
        fecha: parseFecha(m.fecha),
        descripcion: String(m.descripcion ?? ""),
        monto: toNum(m.monto) ?? 0,
        tipo_flujo: m.tipo_flujo || "entrada",
        origen: m.origen || null,
        n_documento: m.n_documento || null,
      }));
      duplicadosSaltados = 0;
      duplicadosDetalle = [];
    } else {
    const movimientosParsed = validMovimientos.map((m) => ({
      empresa_id: empresaId,
      documento_id: documentoId,
      fecha: parseFecha(m.fecha),
      descripcion: String(m.descripcion ?? ""),
      monto: toNum(m.monto) ?? 0,
      tipo_flujo: m.tipo_flujo || "entrada",
      origen: m.origen || null,
      n_documento: m.n_documento || null,
      excel_row: m.excel_row,
      saldo: m.saldo,
    }));

    // Fetch existing movimientos with document info and n_documento
    const { data: existentes } = await supabase
      .from("movimientos_raw")
      .select("id, fecha, monto, descripcion, n_documento, documento_id, documentos_subidos(nombre_archivo, created_at)")
      .eq("empresa_id", empresaId);

    type ExistenteInfo = { id: string; n_documento: string | null; doc_nombre: string; doc_fecha: string; documento_id: string };
    const existenteByStrict = new Map<string, ExistenteInfo>();
    const existenteByLoose = new Map<string, ExistenteInfo>();

    for (const e of existentes ?? []) {
      const doc = e.documentos_subidos as unknown as { nombre_archivo: string; created_at: string } | null;
      const info: ExistenteInfo = {
        id: e.id,
        n_documento: e.n_documento,
        doc_nombre: doc?.nombre_archivo ?? "Documento desconocido",
        doc_fecha: doc?.created_at ?? "",
        documento_id: e.documento_id,
      };
      const looseKey = `${e.fecha}|${e.monto}|${e.descripcion}`;
      existenteByLoose.set(looseKey, info);
      if (e.n_documento) {
        existenteByStrict.set(`${looseKey}|${e.n_documento}`, info);
      }
    }

    // Classify n_documento: simple heuristic instead of Mistral calls
    // RUT pattern: 1-2 digits + dot + 3 digits + dot + 3 digits + dash + 1 digit/K
    // or without dots: 7-8 digits + dash + 1 digit/K
    function isRutPattern(ndoc: string): boolean {
      return /^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/.test(ndoc.trim());
    }

    function isTransactionId(ndoc: string): boolean {
      return !isRutPattern(ndoc);
    }

    // Rebuild strict map using only actual transaction IDs
    const existenteByStrictFiltered = new Map<string, ExistenteInfo>();
    for (const e of existentes ?? []) {
      if (e.n_documento && isTransactionId(e.n_documento)) {
        const looseKey = `${e.fecha}|${e.monto}|${e.descripcion}`;
        const doc = e.documentos_subidos as unknown as { nombre_archivo: string; created_at: string } | null;
        existenteByStrictFiltered.set(`${looseKey}|${e.n_documento}`, {
          id: e.id,
          n_documento: e.n_documento,
          doc_nombre: doc?.nombre_archivo ?? "Documento desconocido",
          doc_fecha: doc?.created_at ?? "",
          documento_id: e.documento_id,
        });
      }
    }

    // Track intra-batch: n_doc counts and loose counts within this file
    const batchStrictSeen = new Map<string, { firstIndex: number; count: number }>();
    const batchLooseSeen = new Map<string, { firstIndex: number; count: number }>();
    const personDayKey = new Map<string, number[]>();

    // indicesToKeep / duplicadosSaltados / duplicadosDetalle se declaran en el scope
    // EXTERNO (~líneas 622-624); acá se MUTAN (push/++), NO se re-declaran. Antes había
    // shadowing: el conteo de dedup quedaba en variables internas y nunca llegaba al
    // progreso_ia final (siempre 0) ni a la reconciliación → pérdida silenciosa.
    const looseOnlyDupCounts = new Map<string, number>();

    // Cartola filtrada solo abonos: cuando el cliente ya filtró el extracto
    // bancario para entregar al contador, todas las filas son entradas. En
    // ese caso, los "duplicados" intra-archivo (mismo monto+desc+fecha sin
    // n_doc) son típicamente pagos P2P legítimos del mismo cliente y NO
    // deben omitirse: se guardan y se marcan como info para revisión.
    // Criterio: ≥10 filas y 100% son entradas.
    const cartolaSoloAbonos =
      movimientosParsed.length >= 10 &&
      movimientosParsed.every((mp) => mp.tipo_flujo === "entrada");

    for (let i = 0; i < movimientosParsed.length; i++) {
      const m = movimientosParsed[i];
      const looseKey = `${m.fecha}|${m.monto}|${m.descripcion}`;
      // Only use n_documento as strict key if classified as transaction ID
      const isTransId = m.n_documento ? isTransactionId(m.n_documento) : false;
      const strictKey = (m.n_documento && isTransId) ? `${looseKey}|${m.n_documento}` : null;

      let shouldSkip = false;
      let isInfoWarning = false;
      let motivo = "";
      let tipo: import("./types").TipoDuplicado = "otro_doc_confirmado";
      let orig: ExistenteInfo | undefined;
      let repeticiones: number | undefined;
      let indiceConflicto: number | undefined;

      if (strictKey) {
        // Check against DB first (only transaction IDs, not RUTs)
        if (existenteByStrictFiltered.has(strictKey)) {
          shouldSkip = true;
          orig = existenteByStrictFiltered.get(strictKey)!;
          tipo = "mismo_ndoc_otro_arch";
          motivo = `N° de transacción #${m.n_documento} ya existe en '${orig.doc_nombre}' — misma operación bancaria`;
        }
        // Intra-batch strict dedup → omitir, requiere aprobación manual
        // del usuario (botón "Agregar igual" en el visor de duplicados).
        else if (batchStrictSeen.has(strictKey)) {
          shouldSkip = true;
          const seen = batchStrictSeen.get(strictKey)!;
          seen.count++;
          tipo = "mismo_ndoc_mismo_arch";
          indiceConflicto = seen.firstIndex;
          repeticiones = seen.count;
          const filaRefMsg =
            movimientosParsed[seen.firstIndex]?.excel_row ?? seen.firstIndex + 1;
          motivo = `Transferencia idéntica detectada: mismo monto, fecha y contraparte que la fila ${filaRefMsg}. Si son operaciones reales separadas (ej: pagos múltiples al mismo proveedor), aceptá manualmente.`;
        } else {
          batchStrictSeen.set(strictKey, { firstIndex: i, count: 0 });
        }
      } else {
        // No n_documento — check DB
        if (existenteByLoose.has(looseKey)) {
          shouldSkip = true;
          orig = existenteByLoose.get(looseKey)!;
          tipo = "loose_otro_arch";
          motivo = `Posible solapamiento con '${orig.doc_nombre}' (mismo monto, fecha y descripción). Si son cartolas de períodos distintos que comparten días, puede ser legítimo.`;
          looseOnlyDupCounts.set(`${m.descripcion}|${m.monto}`, (looseOnlyDupCounts.get(`${m.descripcion}|${m.monto}`) ?? 0) + 1);
        }
        // Intra-batch loose dedup
        // - Default: omitir y pedir confirmación manual (caso conservador
        //   para cartolas completas con cargos+abonos).
        // - Cartola solo-abonos: NO omitir. Pagos P2P repetidos del mismo
        //   cliente el mismo día son normales en negocios de exchange/P2P.
        //   Se guarda el movimiento y se marca como info para revisar.
        else if (batchLooseSeen.has(looseKey)) {
          const seen = batchLooseSeen.get(looseKey)!;
          seen.count++;
          tipo = "loose_mismo_arch";
          indiceConflicto = seen.firstIndex;
          const filaRefMsg =
            movimientosParsed[seen.firstIndex]?.excel_row ?? seen.firstIndex + 1;
          if (cartolaSoloAbonos) {
            isInfoWarning = true;
            motivo = `Misma fecha, monto y descripción que la fila ${filaRefMsg}. Cartola solo-abonos: se guardó como pago independiente. Verificá si son operaciones reales del mismo cliente.`;
          } else {
            shouldSkip = true;
            motivo = `Misma fecha, monto y descripción que la fila ${filaRefMsg} de este archivo. Verificar si son operaciones distintas y aceptar manualmente.`;
          }
          looseOnlyDupCounts.set(`${m.descripcion}|${m.monto}`, (looseOnlyDupCounts.get(`${m.descripcion}|${m.monto}`) ?? 0) + 1);
        } else {
          batchLooseSeen.set(looseKey, { firstIndex: i, count: 0 });
        }
      }

      if (shouldSkip || isInfoWarning) {
        if (shouldSkip) duplicadosSaltados++;

        // Validación matemática del saldo para duplicados intra-archivo.
        // SOLO usamos el resultado positivo: si la diferencia de saldos
        // entre las dos filas coincide exactamente con el monto, tenemos
        // certeza de que son dos operaciones reales y sugerimos Agregar.
        //
        // NO usamos el caso negativo: una cartola filtrada (solo abonos)
        // o una cartola con orden no-cronológico estricto puede tener
        // movimientos intercalados invisibles que rompen el cálculo. Mejor
        // no clasificar que clasificar mal y recomendar omitir algo válido.
        let saldoCheck: "operaciones_reales" | undefined;
        if (
          (tipo === "loose_mismo_arch" || tipo === "mismo_ndoc_mismo_arch") &&
          indiceConflicto !== undefined &&
          typeof m.saldo === "number" &&
          typeof movimientosParsed[indiceConflicto]?.saldo === "number"
        ) {
          const diff = Math.abs(
            (m.saldo ?? 0) - (movimientosParsed[indiceConflicto].saldo ?? 0)
          );
          // Tolerancia de 1 peso por redondeos
          if (Math.abs(diff - m.monto) <= 1) {
            saldoCheck = "operaciones_reales";
          }
        }

        duplicadosDetalle.push({
          fecha: m.fecha,
          descripcion: m.descripcion,
          monto: m.monto,
          tipo_flujo: m.tipo_flujo,
          n_documento: m.n_documento,
          tipo,
          origen_movimiento_id: orig?.id ?? "",
          origen_documento_nombre: orig?.doc_nombre ?? "Este archivo",
          origen_documento_fecha: orig?.doc_fecha ?? "",
          motivo,
          indice_archivo: i,
          indice_conflicto: indiceConflicto,
          excel_row: m.excel_row,
          excel_row_conflicto:
            indiceConflicto !== undefined
              ? movimientosParsed[indiceConflicto]?.excel_row
              : undefined,
          saldo_check: saldoCheck,
          repeticiones,
          info_only: isInfoWarning || undefined,
        });
      }

      if (!shouldSkip) {
        indicesToKeep.push(i);

        // Track person+day for type 6 detection (post-pass)
        // Extract name-like patterns from description
        const nameMatch = m.descripcion.match(/(?:DE|DESDE|A|PARA)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/);
        if (nameMatch) {
          const pdKey = `${nameMatch[1]}|${m.fecha}`;
          const indices = personDayKey.get(pdKey) ?? [];
          indices.push(i);
          personDayKey.set(pdKey, indices);
        }
      }

    }

    // Type 6: detect multiple transfers to same person same day (informational, don't skip)
    for (const [pdKey, indices] of personDayKey) {
      if (indices.length >= 2) {
        const nombre = pdKey.split("|")[0];
        // Add as informational — these are NOT skipped, just flagged
        duplicadosDetalle.push({
          fecha: movimientosParsed[indices[0]].fecha,
          descripcion: `Múltiples operaciones con '${nombre}'`,
          monto: 0,
          tipo_flujo: "entrada",
          tipo: "multi_transfer_p2p",
          origen_movimiento_id: "",
          origen_documento_nombre: "Este archivo",
          origen_documento_fecha: "",
          motivo: `Múltiples transfers a '${nombre}' el mismo día (${indices.length} operaciones) — verificar si son operaciones P2P distintas`,
          repeticiones: indices.length,
        });
      }
    }

    // Check for false-duplicate warning (>5 loose-only dups for same desc+monto)
    falsosDuplicadosWarning = Array.from(looseOnlyDupCounts.entries())
      .filter(([, count]) => count > 5)
      .length > 0;

    // Strip excel_row/saldo: those are in-memory only for dup detection,
    // movimientos_raw schema doesn't have those columns.
    movimientosToInsert = indicesToKeep.map((i) => {
      const { excel_row: _er, saldo: _s, ...row } = movimientosParsed[i];
      void _er; void _s;
      return row;
    });

    if (duplicadosSaltados > 0) {
      await updateProgreso(documentoId, {
        estado: "procesando",
        lote_actual: totalLotes,
        total_lotes: totalLotes,
        movimientos_encontrados: totalMovsFound,
        duplicados_saltados: duplicadosSaltados,
        duplicados_detalle: duplicadosDetalle,
      });
    }
    } // end else (non-bypass dedup)

    // Save movimientos_raw in batches
    const { ids: savedIds, error: movError } = await insertInBatches(
      "movimientos_raw",
      movimientosToInsert
    );

    if (movError)
      throw new Error(`Error guardando movimientos: ${movError}`);

    // Build a map from original index to new savedIds index
    const originalToNewIndex = new Map<number, number>();
    indicesToKeep.forEach((origIdx, newIdx) => {
      originalToNewIndex.set(origIdx, newIdx);
    });

    // Auto-detect clients from propuesta descriptions/receptor data
    const clienteCache = await detectAndCreateClients(
      supabase,
      empresaId,
      validPropuestas,
      validMovimientos
    );

    // Save propuestas_ia in batches, linked to saved movimiento IDs
    if (savedIds.length > 0 && validPropuestas.length > 0) {
      const propuestasToInsert = validPropuestas
        .filter((p) => originalToNewIndex.has(p.movimiento_index))
        .map((p) => {
          const newIndex = originalToNewIndex.get(p.movimiento_index)!;
          const mov = validMovimientos[p.movimiento_index];
          const clienteId = resolveClienteId(clienteCache, p, mov);
          const tipoContrib = getClienteTipo(clienteCache, clienteId);
          const esExento = tipoContrib === "exento";
          const confianza = toNum(p.confianza);
          const enriched = p as EnrichedPropuesta;
          const total = toNum(p.total);
          // Empresa exenta: un contribuyente exento no emite DTE afecto → se normaliza
          // la venta afecta (boleta/factura) a su equivalente exento (+ iva 0,
          // monto_neto = total). Punto único que corrige los 3 carriles (atajo template
          // + IA/OpenCode + reglas). No toca gasto/no_comercial ni los ya exentos.
          const tipoBase = normTipo(p.tipo_propuesto);
          const tipoNorm = normalizarTipoPorEmisor(tipoBase, emp?.tipo_contribuyente);
          const exentoFinal = esExento || esVentaExentaEmisor(tipoBase, emp?.tipo_contribuyente);
          return {
            empresa_id: empresaId,
            movimiento_id: savedIds[newIndex],
            tipo_propuesto: tipoNorm,
            receptor_nombre: p.receptor_nombre || null,
            receptor_rut: p.receptor_rut || null,
            monto_neto: exentoFinal ? total : toNum(p.monto_neto),
            iva: exentoFinal ? 0 : toNum(p.iva),
            total,
            confianza,
            // notas = detalle/glosa del humano; NO marcadores internos (se filtran a la
            // glosa de la boleta vía armar-boleta.ts). La baja confianza ya vive en la
            // columna `confianza` — la UI la marca desde ahí, no desde notas.
            notas: p.notas || null,
            // Auto-stage a "listo" SOLO con clasificación real por regla (regla_id).
            // El atajo template (boleta @0.95 sin match) nace "pendiente": el usuario
            // hace un gesto de bulk antes de que quede a un click del SII.
            estado:
              confianza != null && confianza >= AUTO_STAGE_THRESHOLD && enriched.__regla_id != null
                ? ("listo" as const)
                : ("pendiente" as const),
            spread_compra: toNum(p.spread_compra),
            spread_venta: toNum(p.spread_venta),
            spread_ganancia: toNum(p.spread_ganancia),
            cliente_id: clienteId,
            fuente_clasificacion: enriched.__fuente ?? "mistral",
            regla_id: enriched.__regla_id ?? null,
          };
        });

      const { error: propError } = await insertInBatches(
        "propuestas_ia",
        propuestasToInsert
      );

      if (propError)
        throw new Error(`Error guardando propuestas: ${propError}`);
    }

    // Track token usage (include OCR tokens if present)
    const finalTokensInput = totalTokensInput + (ocrTokens?.ocrTokensInput ?? 0);
    const finalTokensOutput = totalTokensOutput + (ocrTokens?.ocrTokensOutput ?? 0);
    const provider = getAIProvider();
    const costo = provider.getCost(finalTokensInput, finalTokensOutput);
    await supabase.from("ia_uso").insert({
      empresa_id: empresaId,
      documento_id: documentoId,
      tokens_input: finalTokensInput,
      tokens_output: finalTokensOutput,
      modelo,
      costo_usd: costo,
    });

    // Mark as completed
    const insertados = movimientosToInsert.length;
    await supabase
      .from("documentos_subidos")
      .update({
        estado: "procesado",
        movimientos_detectados: insertados,
        progreso_ia: {
          estado: "completado",
          movimientos_encontrados: allMovimientos.length,
          duplicados_saltados: duplicadosSaltados,
          duplicados_detalle: duplicadosDetalle.length > 0 ? duplicadosDetalle : undefined,
          falsos_duplicados_warning: falsosDuplicadosWarning || undefined,
        } as unknown as Database["public"]["Tables"]["documentos_subidos"]["Update"]["progreso_ia"],
      })
      .eq("id", documentoId);

    // Reconciliación: si el dedup descartó una fracción ALTA de los movimientos válidos,
    // emítelo a ops_events (antes la pérdida era silenciosa). Re-subir el mismo archivo
    // cae acá legítimamente (todo deduplicado) — es informativo (warn), no un error.
    const validosFinal = validMovimientos.length;
    const perdidosDedup = validosFinal - insertados;
    if (validosFinal > 0 && perdidosDedup > 0 && (insertados === 0 || perdidosDedup / validosFinal >= 0.5)) {
      await recordOpsEvent({
        sb: supabase,
        severity: "warn",
        source: "ia",
        eventName: "reconciliacion_dedup",
        summary: `Dedup alto: de ${validosFinal} movimientos validos se guardaron ${insertados} (${perdidosDedup} omitidos).`,
        empresaId,
        resourceType: "documento",
        resourceId: documentoId,
        metadata: {
          extraidos: allMovimientos.length,
          validos: validosFinal,
          guardados: insertados,
          duplicados: duplicadosSaltados,
        },
      });
    }

    return { movimientos_total: insertados };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await supabase
      .from("documentos_subidos")
      .update({
        estado: "error",
        progreso_ia: {
          estado: "error",
          error: errorMsg,
        } as unknown as Database["public"]["Tables"]["documentos_subidos"]["Update"]["progreso_ia"],
      })
      .eq("id", documentoId);

    return { movimientos_total: 0, error: errorMsg };
  }
}

// --- Client auto-detection ---

const RUT_REGEX = /(?:RUT\s*:?\s*)?(\d{1,2}\.?\d{3}\.?\d{3}-[\dkK])/gi;

function extractRutFromText(text: string): string | null {
  const match = RUT_REGEX.exec(text);
  RUT_REGEX.lastIndex = 0; // reset global regex
  if (!match) return null;
  const candidate = match[1];
  if (validarRut(candidate)) return formatRut(candidate);
  return null;
}

type ClienteInfo = { id: string; tipo_contribuyente: string };
type ClienteMap = Map<string, ClienteInfo>; // rut -> { id, tipo_contribuyente }

async function detectAndCreateClients(
  supabase: ReturnType<typeof getServiceClient>,
  empresaId: string,
  propuestas: PropuestaExtraida[],
  movimientos: MovimientoExtraido[]
): Promise<ClienteMap> {
  // Collect all RUTs found in propuestas and movimiento descriptions
  const rutsFound = new Map<string, string>(); // rut -> best name

  for (const p of propuestas) {
    const mov = movimientos[p.movimiento_index];
    if (!mov) continue;

    // Try receptor_rut first (from AI extraction)
    const rutFromPropuesta = p.receptor_rut
      ? validarRut(p.receptor_rut) ? formatRut(p.receptor_rut) : null
      : null;

    // Try regex on description
    const rutFromDesc = extractRutFromText(mov.descripcion);

    const rut = rutFromPropuesta || rutFromDesc;
    if (!rut) continue;

    // Use receptor_nombre if available, otherwise leave empty
    if (!rutsFound.has(rut) || (p.receptor_nombre && !rutsFound.get(rut))) {
      rutsFound.set(rut, p.receptor_nombre || "");
    }
  }

  if (rutsFound.size === 0) return new Map();

  // Fetch existing clients for this empresa
  const { data: existingClientes } = await supabase
    .from("clientes")
    .select("id, rut, tipo_contribuyente")
    .eq("empresa_id", empresaId)
    .not("rut", "is", null);

  const clienteMap: ClienteMap = new Map();
  for (const c of existingClientes ?? []) {
    if (c.rut) clienteMap.set(c.rut, { id: c.id, tipo_contribuyente: c.tipo_contribuyente ?? "afecto" });
  }

  // Create missing clients
  const toCreate: { empresa_id: string; nombre: string; rut: string }[] = [];
  for (const [rut, nombre] of rutsFound) {
    if (!clienteMap.has(rut)) {
      toCreate.push({
        empresa_id: empresaId,
        nombre: nombre || `Cliente ${rut}`,
        rut,
      });
    }
  }

  if (toCreate.length > 0) {
    const { data: created } = await supabase
      .from("clientes")
      .insert(toCreate)
      .select("id, rut, tipo_contribuyente");

    for (const c of created ?? []) {
      if (c.rut) clienteMap.set(c.rut, { id: c.id, tipo_contribuyente: c.tipo_contribuyente ?? "afecto" });
    }
  }

  return clienteMap;
}

function resolveClienteId(
  clienteMap: ClienteMap,
  propuesta: PropuestaExtraida,
  movimiento: MovimientoExtraido
): string | null {
  // Try receptor_rut from propuesta
  if (propuesta.receptor_rut && validarRut(propuesta.receptor_rut)) {
    const formatted = formatRut(propuesta.receptor_rut);
    const info = clienteMap.get(formatted);
    if (info) return info.id;
  }

  // Try regex on description
  const rutFromDesc = extractRutFromText(movimiento.descripcion);
  if (rutFromDesc) {
    const info = clienteMap.get(rutFromDesc);
    if (info) return info.id;
  }

  return null;
}

function getClienteTipo(clienteMap: ClienteMap, clienteId: string | null): string {
  if (!clienteId) return "afecto";
  for (const [, info] of clienteMap) {
    if (info.id === clienteId) return info.tipo_contribuyente;
  }
  return "afecto";
}
