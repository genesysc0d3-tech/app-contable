import { createClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";
import { getAIProvider } from "./provider";
import { getSystemPrompt } from "./prompt";
import { calcularCosto } from "./providers/mistral";
import type {
  AIExtractionResult,
  MovimientoExtraido,
  PropuestaExtraida,
  ProgresoIA,
  DuplicadoDetalle,
} from "./types";
import { parseFecha } from "./fecha";
import { validarRut, formatRut } from "../rut";

const CHUNK_SIZE = 50;
const MAX_RETRIES = 3;
const MAX_CONCURRENT = 3;
const DB_BATCH_SIZE = 100;
const MIN_CONFIANZA = 0.6;

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
  ocrTokens?: { ocrTokensInput: number; ocrTokensOutput: number }
): Promise<{ movimientos_total: number; error?: string }> {
  const supabase = getServiceClient();
  const systemPrompt = getSystemPrompt();

  await supabase
    .from("documentos_subidos")
    .update({ estado: "procesando" })
    .eq("id", documentoId);

  try {
    const lines = contenido.split("\n").filter((l) => l.trim());
    const chunks =
      lines.length > CHUNK_SIZE ? splitIntoChunks(lines) : [lines];
    const totalLotes = chunks.length;

    // Process chunks in parallel, max MAX_CONCURRENT at a time
    const results: ChunkResult[] = new Array(chunks.length);
    let completedCount = 0;
    let totalMovsFound = 0;

    for (let start = 0; start < chunks.length; start += MAX_CONCURRENT) {
      const batch = chunks.slice(start, start + MAX_CONCURRENT);
      const promises = batch.map((chunk, i) => {
        const chunkIndex = start + i;
        return processChunkWithRetry(
          chunkIndex,
          chunk.join("\n"),
          systemPrompt
        );
      });

      const batchResults = await Promise.all(promises);

      for (const r of batchResults) {
        results[r.index] = r;
        completedCount++;
        totalMovsFound += r.movimientos.length;
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

    const validMovimientos = validIndices.map((i) => allMovimientos[i]);
    const validPropuestas = allPropuestas
      .filter((p) => indexRemap.has(p.movimiento_index))
      .map((p) => ({ ...p, movimiento_index: indexRemap.get(p.movimiento_index)! }));

    // Detect duplicates: check existing movimientos for this empresa
    const movimientosParsed = validMovimientos.map((m) => ({
      empresa_id: empresaId,
      documento_id: documentoId,
      fecha: parseFecha(m.fecha),
      descripcion: m.descripcion,
      monto: m.monto,
      tipo_flujo: m.tipo_flujo,
      origen: m.origen,
    }));

    // Fetch existing movimientos with their document info for duplicate detail
    const { data: existentes } = await supabase
      .from("movimientos_raw")
      .select("id, fecha, monto, descripcion, documento_id, documentos_subidos(nombre_archivo, created_at)")
      .eq("empresa_id", empresaId);

    const existenteMap = new Map<string, { id: string; doc_nombre: string; doc_fecha: string }>();
    for (const e of existentes ?? []) {
      const key = `${e.fecha}|${e.monto}|${e.descripcion}`;
      const doc = e.documentos_subidos as unknown as { nombre_archivo: string; created_at: string } | null;
      existenteMap.set(key, {
        id: e.id,
        doc_nombre: doc?.nombre_archivo ?? "Documento desconocido",
        doc_fecha: doc?.created_at ?? "",
      });
    }

    const indicesToKeep: number[] = [];
    let duplicadosSaltados = 0;
    const duplicadosDetalle: DuplicadoDetalle[] = [];
    const seenKeys = new Set(existenteMap.keys());

    for (let i = 0; i < movimientosParsed.length; i++) {
      const m = movimientosParsed[i];
      const key = `${m.fecha}|${m.monto}|${m.descripcion}`;
      if (seenKeys.has(key)) {
        duplicadosSaltados++;
        const orig = existenteMap.get(key);
        duplicadosDetalle.push({
          fecha: m.fecha,
          descripcion: m.descripcion,
          monto: m.monto,
          tipo_flujo: m.tipo_flujo,
          origen_movimiento_id: orig?.id ?? "",
          origen_documento_nombre: orig?.doc_nombre ?? "Mismo lote",
          origen_documento_fecha: orig?.doc_fecha ?? "",
        });
      } else {
        indicesToKeep.push(i);
        seenKeys.add(key); // prevent intra-batch duplicates too
      }
    }

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
          const isLow = p.confianza != null && p.confianza < MIN_CONFIANZA;
          const mov = validMovimientos[p.movimiento_index];
          const clienteId = resolveClienteId(clienteCache, p, mov);
          return {
            empresa_id: empresaId,
            movimiento_id: savedIds[newIndex],
            tipo_propuesto: p.tipo_propuesto,
            receptor_nombre: p.receptor_nombre,
            receptor_rut: p.receptor_rut,
            monto_neto: p.monto_neto,
            iva: p.iva,
            total: p.total,
            confianza: p.confianza,
            notas: isLow
              ? `[REVISION MANUAL - confianza ${Math.round((p.confianza ?? 0) * 100)}%] ${p.notas || ""}`.trim()
              : p.notas,
            estado: "pendiente" as const,
            spread_compra: p.spread_compra,
            spread_venta: p.spread_venta,
            spread_ganancia: p.spread_ganancia,
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
