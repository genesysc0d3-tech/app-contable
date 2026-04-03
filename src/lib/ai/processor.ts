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
} from "./types";
import { parseFecha } from "./fecha";

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
  contenido: string
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

    // Save movimientos_raw in batches
    const movimientosToInsert = allMovimientos.map((m) => ({
      empresa_id: empresaId,
      documento_id: documentoId,
      fecha: parseFecha(m.fecha),
      descripcion: m.descripcion,
      monto: m.monto,
      tipo_flujo: m.tipo_flujo,
      origen: m.origen,
    }));

    const { ids: savedIds, error: movError } = await insertInBatches(
      "movimientos_raw",
      movimientosToInsert
    );

    if (movError)
      throw new Error(`Error guardando movimientos: ${movError}`);

    // Save propuestas_ia in batches, linked to saved movimiento IDs
    if (savedIds.length > 0 && allPropuestas.length > 0) {
      const propuestasToInsert = allPropuestas
        .filter((p) => p.movimiento_index >= 0 && p.movimiento_index < savedIds.length)
        .map((p) => {
          const isLow = p.confianza != null && p.confianza < MIN_CONFIANZA;
          return {
            empresa_id: empresaId,
            movimiento_id: savedIds[p.movimiento_index],
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
          };
        });

      const { error: propError } = await insertInBatches(
        "propuestas_ia",
        propuestasToInsert
      );

      if (propError)
        throw new Error(`Error guardando propuestas: ${propError}`);
    }

    // Track token usage
    const costo = calcularCosto(totalTokensInput, totalTokensOutput);
    await supabase.from("ia_uso").insert({
      empresa_id: empresaId,
      documento_id: documentoId,
      tokens_input: totalTokensInput,
      tokens_output: totalTokensOutput,
      modelo,
      costo_usd: costo,
    });

    // Mark as completed
    await supabase
      .from("documentos_subidos")
      .update({
        estado: "procesado",
        movimientos_detectados: allMovimientos.length,
        progreso_ia: {
          estado: "completado",
          movimientos_encontrados: allMovimientos.length,
        } as unknown as Database["public"]["Tables"]["documentos_subidos"]["Update"]["progreso_ia"],
      })
      .eq("id", documentoId);

    return { movimientos_total: allMovimientos.length };
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
