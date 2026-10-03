import type { SupabaseClient } from "@supabase/supabase-js";
import { MENSAJE_NO_PUDIMOS_REVISAR, revisarBloqueoDocumento, type SbBorrado } from "@/lib/emission/bloqueo-borrado";

/**
 * ¿Se puede reprocesar este documento AHORA? El mismo chequeo que
 * /api/procesar-documento (doble candado): con boletas emitidas o una emisión a
 * medias no se reprocesa (las emitidas nunca vuelven), y un job en curso
 * tampoco se pisa. Lo usan las respuestas del popup que cambian cómo se lee un
 * PDF ("No es una cartola" / "Leerlo como cartola"): si el reproceso no puede
 * partir, NO se guarda la decisión (quedaría un mapa que no calza con lo leído).
 */
export async function reprocesoPosible(svc: SupabaseClient | null, documentoId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!svc) return { ok: false, status: 503, error: MENSAJE_NO_PUDIMOS_REVISAR };
  const { data: movs, error } = await svc.from("movimientos_raw").select("id").eq("documento_id", documentoId);
  if (error) return { ok: false, status: 503, error: MENSAJE_NO_PUDIMOS_REVISAR };
  const bloqueo = await revisarBloqueoDocumento(svc as unknown as SbBorrado, ((movs ?? []) as { id: string }[]).map((m) => m.id));
  if ("error" in bloqueo) return { ok: false, status: 503, error: MENSAJE_NO_PUDIMOS_REVISAR };
  if (bloqueo.emitidas > 0 || bloqueo.emisionesAbiertas > 0) {
    return { ok: false, status: 409, error: "Este documento tiene boletas emitidas o una emisión a medias en el SII: no se puede volver a leer. Las emitidas nunca vuelven." };
  }
  const { data: enCurso, error: jobErr } = await svc.from("document_processing_jobs").select("id").eq("documento_id", documentoId).eq("status", "running").limit(1);
  if (jobErr) return { ok: false, status: 503, error: MENSAJE_NO_PUDIMOS_REVISAR };
  if ((enCurso ?? []).length) return { ok: false, status: 409, error: "Este documento se está procesando en este momento: espera a que termine y vuelve a intentarlo." };
  return { ok: true };
}
