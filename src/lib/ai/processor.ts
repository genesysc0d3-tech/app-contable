import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { getAIProvider } from "./provider";
import { getSystemPrompt, getClassifyOnlySystemPrompt } from "./prompt";
import { calcularCosto } from "./providers/mistral";
import type {
  MovimientoExtraido,
  PropuestaExtraida,
  ProgresoIA,
  DuplicadoDetalle,
} from "./types";
import type { PreExtractedMovimiento } from "../parsers/types";
import { parseFecha } from "./fecha";
import { validarRut, formatRut } from "../rut";

const CHUNK_SIZE = 100;
const MAX_RETRIES = 3;
const MAX_CONCURRENT = 7;
const DB_BATCH_SIZE = 100;
const MIN_CONFIANZA = 0.6;

/** Sanitize a value that should be numeric but Mistral may return as "null" string */
function toNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "null" || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

/** Normalize tipo_propuesto to valid check constraint values */
const VALID_TIPOS = new Set([
  "boleta", "factura", "gasto", "registro_crypto", "ignorar",
  "boleta_honorarios", "factura_afecta", "compraventa_crypto",
  "transferencia_p2p", "operacion_forex", "gasto_egreso", "no_comercial",
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
  if (s.includes("factura")) return "factura_afecta";
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
  systemPrompt: string
): Promise<ChunkResult> {
  const provider = getAIProvider();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await provider.extractMovimientos(
        chunkText,
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

  await supabase
    .from("documentos_subidos")
    .update({ estado: "procesando" })
    .eq("id", documentoId);

  try {
    // Build the chunked work units. In bypass mode we chunk the deterministic
    // movimientos array directly. In legacy mode we chunk text lines.
    type MovChunk = { movs: MovimientoExtraido[] };
    type TextChunk = { text: string[] };
    const movChunks: MovChunk[] = [];
    let textChunks: TextChunk[] = [];

    if (bypassMode) {
      const movs = preExtracted! as MovimientoExtraido[];
      for (let i = 0; i < movs.length; i += CHUNK_SIZE) {
        movChunks.push({ movs: movs.slice(i, i + CHUNK_SIZE) });
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
            processChunkWithRetry(start + i, c.text.join("\n"), systemPrompt)
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

    // Combine results in order, tracking offsets for propuesta indices
    const allMovimientos: MovimientoExtraido[] = [];
    const allPropuestas: PropuestaExtraida[] = [];
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let modelo = "";

    for (const r of results) {
      if (!r) continue;
      const offset = allMovimientos.length;
      allMovimientos.push(...r.movimientos);

      for (const p of r.propuestas) {
        allPropuestas.push({
          ...p,
          movimiento_index: p.movimiento_index + offset,
        });
      }

      totalTokensInput += r.tokens_input;
      totalTokensOutput += r.tokens_output;
      modelo = r.modelo;
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

    if (totalAbonos > 0) {
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
    const movimientosParsed = validMovimientos.map((m) => ({
      empresa_id: empresaId,
      documento_id: documentoId,
      fecha: parseFecha(m.fecha),
      descripcion: String(m.descripcion ?? ""),
      monto: toNum(m.monto) ?? 0,
      tipo_flujo: m.tipo_flujo || "entrada",
      origen: m.origen || null,
      n_documento: m.n_documento || null,
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

    const indicesToKeep: number[] = [];
    let duplicadosSaltados = 0;
    const duplicadosDetalle: DuplicadoDetalle[] = [];
    const looseOnlyDupCounts = new Map<string, number>();

    for (let i = 0; i < movimientosParsed.length; i++) {
      const m = movimientosParsed[i];
      const looseKey = `${m.fecha}|${m.monto}|${m.descripcion}`;
      // Only use n_documento as strict key if classified as transaction ID
      const isTransId = m.n_documento ? isTransactionId(m.n_documento) : false;
      const strictKey = (m.n_documento && isTransId) ? `${looseKey}|${m.n_documento}` : null;

      let isDuplicate = false;
      let motivo = "";
      let tipo: import("./types").TipoDuplicado = "otro_doc_confirmado";
      let orig: ExistenteInfo | undefined;
      let repeticiones: number | undefined;
      let indiceConflicto: number | undefined;

      if (strictKey) {
        // Check against DB first (only transaction IDs, not RUTs)
        if (existenteByStrictFiltered.has(strictKey)) {
          isDuplicate = true;
          orig = existenteByStrictFiltered.get(strictKey)!;
          tipo = "mismo_ndoc_otro_arch";
          motivo = `N° de transacción #${m.n_documento} ya existe en '${orig.doc_nombre}' — misma operación bancaria`;
        }
        // Intra-batch strict dedup only applies in legacy (non-bypass) mode.
        // In bypass mode, the parser guarantees 1 Excel row = 1 movimiento,
        // so two rows with the same strictKey are LEGITIMATE separate
        // transactions (e.g. multiple cargos a SKIPO same day same monto,
        // where the "n_documento" is actually the beneficiary RUT, not a
        // unique transaction ID).
        else if (!bypassMode && batchStrictSeen.has(strictKey)) {
          isDuplicate = true;
          const seen = batchStrictSeen.get(strictKey)!;
          seen.count++;
          tipo = "mismo_ndoc_mismo_arch";
          indiceConflicto = seen.firstIndex;
          repeticiones = seen.count;
          motivo = `N° de transacción #${m.n_documento} aparece ${seen.count + 1} veces en este archivo — posible error del banco o del export`;
        } else {
          batchStrictSeen.set(strictKey, { firstIndex: i, count: 0 });
        }
      } else {
        // No n_documento — check DB
        if (existenteByLoose.has(looseKey)) {
          isDuplicate = true;
          orig = existenteByLoose.get(looseKey)!;
          tipo = "loose_otro_arch";
          motivo = `Posible solapamiento con '${orig.doc_nombre}' (mismo monto, fecha y descripción). Si son cartolas de períodos distintos que comparten días, puede ser legítimo.`;
          looseOnlyDupCounts.set(`${m.descripcion}|${m.monto}`, (looseOnlyDupCounts.get(`${m.descripcion}|${m.monto}`) ?? 0) + 1);
        }
        // Intra-batch loose dedup also skipped in bypass mode — parser
        // guarantees no spurious duplication.
        else if (!bypassMode && batchLooseSeen.has(looseKey)) {
          isDuplicate = true;
          const seen = batchLooseSeen.get(looseKey)!;
          seen.count++;
          tipo = "loose_mismo_arch";
          indiceConflicto = seen.firstIndex;
          motivo = `Mismo monto y descripción en filas ${seen.firstIndex + 1} y ${i + 1} de este archivo — podrían ser personas distintas que enviaron el mismo monto. Verificar manualmente.`;
          looseOnlyDupCounts.set(`${m.descripcion}|${m.monto}`, (looseOnlyDupCounts.get(`${m.descripcion}|${m.monto}`) ?? 0) + 1);
        } else {
          batchLooseSeen.set(looseKey, { firstIndex: i, count: 0 });
        }
      }

      if (isDuplicate) {
        duplicadosSaltados++;
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
          repeticiones,
        });
      } else {
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
    const falsosDuplicadosWarning = Array.from(looseOnlyDupCounts.entries())
      .filter(([, count]) => count > 5)
      .length > 0;

    const movimientosToInsert = indicesToKeep.map((i) => movimientosParsed[i]);

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
          const confianza = toNum(p.confianza);
          const confianzaLow = confianza != null && confianza < MIN_CONFIANZA;
          return {
            empresa_id: empresaId,
            movimiento_id: savedIds[newIndex],
            tipo_propuesto: normTipo(p.tipo_propuesto),
            receptor_nombre: p.receptor_nombre || null,
            receptor_rut: p.receptor_rut || null,
            monto_neto: toNum(p.monto_neto),
            iva: toNum(p.iva),
            total: toNum(p.total),
            confianza,
            notas: confianzaLow
              ? `[REVISION MANUAL - confianza ${Math.round((confianza ?? 0) * 100)}%] ${p.notas || ""}`.trim()
              : p.notas || null,
            estado: "pendiente" as const,
            spread_compra: toNum(p.spread_compra),
            spread_venta: toNum(p.spread_venta),
            spread_ganancia: toNum(p.spread_ganancia),
            cliente_id: clienteId,
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
    const costo = calcularCosto(finalTokensInput, finalTokensOutput);
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

type ClienteMap = Map<string, string>; // rut -> cliente_id

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
    .select("id, rut")
    .eq("empresa_id", empresaId)
    .not("rut", "is", null);

  const clienteMap: ClienteMap = new Map();
  for (const c of existingClientes ?? []) {
    if (c.rut) clienteMap.set(c.rut, c.id);
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
      .select("id, rut");

    for (const c of created ?? []) {
      if (c.rut) clienteMap.set(c.rut, c.id);
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
    const id = clienteMap.get(formatted);
    if (id) return id;
  }

  // Try regex on description
  const rutFromDesc = extractRutFromText(movimiento.descripcion);
  if (rutFromDesc) {
    const id = clienteMap.get(rutFromDesc);
    if (id) return id;
  }

  return null;
}
