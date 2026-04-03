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
const MIN_CONFIANZA = 0.6;

// Service role client for server-side operations (bypasses RLS)
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
    .update({ progreso_ia: progreso as unknown as Database["public"]["Tables"]["documentos_subidos"]["Update"]["progreso_ia"] })
    .eq("id", documentoId);
}

function splitIntoChunks(lines: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
    chunks.push(lines.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

async function processChunkWithRetry(
  chunk: string,
  systemPrompt: string,
  retries = MAX_RETRIES
): Promise<{ result: AIExtractionResult; tokens_input: number; tokens_output: number; modelo: string }> {
  const provider = getAIProvider();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await provider.extractMovimientos(chunk, systemPrompt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError;
}

export async function procesarDocumento(
  documentoId: string,
  empresaId: string,
  contenido: string
): Promise<{ movimientos_total: number; error?: string }> {
  const supabase = getServiceClient();
  const systemPrompt = getSystemPrompt();

  // Mark as processing
  await supabase
    .from("documentos_subidos")
    .update({ estado: "procesando" })
    .eq("id", documentoId);

  try {
    // Split content into lines and chunk if needed
    const lines = contenido.split("\n").filter((l) => l.trim());
    const chunks = lines.length > CHUNK_SIZE ? splitIntoChunks(lines) : [lines];
    const totalLotes = chunks.length;

    const allMovimientos: MovimientoExtraido[] = [];
    const allPropuestas: PropuestaExtraida[] = [];
    let totalTokensInput = 0;
    let totalTokensOutput = 0;
    let modelo = "";

    for (let i = 0; i < chunks.length; i++) {
      await updateProgreso(documentoId, {
        estado: "procesando",
        lote_actual: i + 1,
        total_lotes: totalLotes,
        movimientos_encontrados: allMovimientos.length,
      });

      const chunkText = chunks[i].join("\n");
      const response = await processChunkWithRetry(chunkText, systemPrompt);

      modelo = response.modelo;
      totalTokensInput += response.tokens_input;
      totalTokensOutput += response.tokens_output;

      // Adjust movimiento_index offset for combined results
      const offset = allMovimientos.length;
      allMovimientos.push(...response.result.movimientos);

      for (const p of response.result.propuestas) {
        allPropuestas.push({
          ...p,
          movimiento_index: p.movimiento_index + offset,
        });
      }
    }

    // Save movimientos_raw
    const movimientosToInsert = allMovimientos.map((m) => ({
      empresa_id: empresaId,
      documento_id: documentoId,
      fecha: parseFecha(m.fecha),
      descripcion: m.descripcion,
      monto: m.monto,
      tipo_flujo: m.tipo_flujo,
      origen: m.origen,
    }));

    const { data: savedMovimientos, error: movError } = await supabase
      .from("movimientos_raw")
      .insert(movimientosToInsert)
      .select("id");

    if (movError) throw new Error(`Error guardando movimientos: ${movError.message}`);

    // Save propuestas_ia linked to saved movimientos
    if (savedMovimientos && savedMovimientos.length > 0) {
      const propuestasToInsert = allPropuestas
        .filter((p) => p.movimiento_index < savedMovimientos.length)
        .map((p) => ({
          empresa_id: empresaId,
          movimiento_id: savedMovimientos[p.movimiento_index].id,
          tipo_propuesto: p.tipo_propuesto,
          receptor_nombre: p.receptor_nombre,
          receptor_rut: p.receptor_rut,
          monto_neto: p.monto_neto,
          iva: p.iva,
          total: p.total,
          confianza: p.confianza,
          notas: p.notas,
          // Auto-flag low confidence for manual review
          estado: p.confianza < MIN_CONFIANZA ? "pendiente" as const : "pendiente" as const,
          spread_compra: p.spread_compra,
          spread_venta: p.spread_venta,
          spread_ganancia: p.spread_ganancia,
        }));

      // Add note for low confidence
      for (const prop of propuestasToInsert) {
        if (prop.confianza !== null && prop.confianza < MIN_CONFIANZA) {
          prop.notas = `[REVISION MANUAL - confianza ${Math.round((prop.confianza ?? 0) * 100)}%] ${prop.notas || ""}`.trim();
        }
      }

      await supabase.from("propuestas_ia").insert(propuestasToInsert);
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
