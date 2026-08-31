// Techo DIARIO de trabajos de IA por empresa (auditoría interna #3).
//
// NO es cuota de producto ni toca el pricing: es un cortafuegos anti-abuso
// muy por encima de cualquier uso legítimo (la cuota comercial sigue midiendo
// EMISIÓN, ver lib/pagos/metering). Sin esto el pipeline caro (subir → OCR →
// N llamadas de IA) no tenía ningún techo ACUMULADO: los límites por minuto
// se gotean 24/7 (20/min = 28.800 documentos/día por cuenta).
//
// El día es día de CHILE (los cron de Vercel corren en UTC, ver
// feedback_timezone_chile) y el conteo va con service client: la tabla de
// jobs es deny-all bajo RLS.

// Import relativo a propósito: vitest no resuelve el alias @/ y este módulo
// tiene test propio.
import { chileDayStartUtc } from "../chile-date";

const TOPE_DEFAULT = 150;

export function topeJobsIaDia(): number {
  const raw = Number(process.env.MASSDTE_TOPE_JOBS_IA_DIA);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : TOPE_DEFAULT;
}

// Cliente mínimo estructural para poder testear la decisión sin Supabase real.
export type JobsCountClient = {
  from: (table: "document_processing_jobs") => {
    select: (cols: string, opts: { count: "exact"; head: true }) => {
      eq: (col: "empresa_id", val: string) => {
        gte: (col: "created_at", val: string) => PromiseLike<{ count: number | null; error: { message: string } | null }>;
      };
    };
  };
};

export type ResultadoTopeIa =
  | { ok: true; usados: number; tope: number }
  | { ok: false; usados: number; tope: number };

export async function verificarTopeDiarioIa(sb: JobsCountClient, empresaId: string): Promise<ResultadoTopeIa> {
  const tope = topeJobsIaDia();
  const { count, error } = await sb
    .from("document_processing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .gte("created_at", chileDayStartUtc());
  if (error || count == null) {
    // Fail-open CONSCIENTE y distinto del gate de MFA: esto es un cortafuegos
    // de COSTO, no una barrera de datos. Si el conteo falla, no botamos la
    // subida legítima — los rate-limits por minuto siguen de pie.
    return { ok: true, usados: -1, tope };
  }
  return count >= tope ? { ok: false, usados: count, tope } : { ok: true, usados: count, tope };
}

export function respuestaTopeIa(resultado: Extract<ResultadoTopeIa, { ok: false }>) {
  return {
    ok: false as const,
    error: "TOPE_DIARIO_IA",
    detalle: `Alcanzaste el tope diario de procesamiento (${resultado.tope} documentos hoy). Se reinicia a medianoche de Chile; si es uso real, escríbenos y lo subimos.`,
  };
}
