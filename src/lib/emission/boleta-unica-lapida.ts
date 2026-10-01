// Lápida de la BOLETA ÚNICA (seguridad de emisión 2026-09-30, adversarial H1).
//
// El lote amarra su lápida a la propuesta (lapida.ts). La boleta única no tiene
// propuesta: su única reja era el candado de cuenta, que se mantiene solo hasta el
// TTL (locks.ts). Y peor: con `emision_incierta` (el puerto de la extensión murió
// después de mandar FILL_AND_EMIT) la vista cerraba el job `failed`, el server
// soltaba el candado y el botón Emitir volvía → re-emisión a ciegas, posible doble
// boleta.
//
// Regla: cualquier aviso donde el SII PUDO haber emitido sella el job como
// `revision_pendiente`. Mientras la empresa tenga una boleta única así (posterior al
// corte), el POST de /api/emision/jobs no abre otra boleta única: primero se resuelve
// (folio capturado/escrito → `completed`, o "revisé el SII y no salió" → `failed`).
//
// Acotado a jobs nuevos: en prod no hay ninguna boleta única en revision_pendiente
// (SELECT 2026-09-30), así que el corte no deja a nadie trabado de golpe.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Sb = SupabaseClient<Database>;

export const BOLETA_UNICA_LAPIDA_DESDE = "2026-09-30T00:00:00Z";

export type JobBoletaUnica = { estado: string; propuesta_id: string | null; created_at: string };

export function esLapidaBoletaUnica(job: JobBoletaUnica): boolean {
  if (job.propuesta_id) return false; // el lote tiene su propia lápida (lapida.ts)
  if (job.estado !== "revision_pendiente") return false;
  return Date.parse(job.created_at) >= Date.parse(BOLETA_UNICA_LAPIDA_DESDE);
}

export const MENSAJE_INCIERTA =
  "La conexión con la ventana del SII se cortó justo después de mandar la boleta: pudo haberse emitido. Revisa el SII antes de seguir y no vuelvas a emitir: si ves el folio, recupéralo o escríbelo; si no salió, márcalo.";

export type CierrePorStatus = {
  /** Cómo cerrar el job en el server (null = no cerrar: sigue en curso). */
  cerrar: "failed" | "cancelled" | "revision_pendiente" | null;
  /** Estado que muestra el panel (result_needs_review mantiene Emitir bloqueado). */
  estadoUi: string;
  mensaje?: string;
};

/**
 * Qué hace la boleta única con un APP_CONTABLE_SII_JOB_STATUS de la extensión.
 * `emision_incierta` lo manda la extensión 0.2.8+ (background.js): puerto muerto sin
 * respuesta tras FILL_AND_EMIT. `result_needs_review` = emitió o pudo emitir y no
 * confirmó el folio. Ambos son "a medias": lápida, nunca `failed`.
 */
export function cierreBoletaUnicaPorStatus(msg: { status?: string | null; emision_incierta?: boolean | null; message?: string | null }): CierrePorStatus {
  const st = msg.status ?? "";
  if (st === "error" && msg.emision_incierta === true) {
    return { cerrar: "revision_pendiente", estadoUi: "result_needs_review", mensaje: MENSAJE_INCIERTA };
  }
  if (st === "result_needs_review") return { cerrar: "revision_pendiente", estadoUi: "result_needs_review" };
  if (st === "error") return { cerrar: "failed", estadoUi: "error" };
  if (st === "cancelled") return { cerrar: "cancelled", estadoUi: "cancelled" };
  return { cerrar: null, estadoUi: st || "error" };
}

export type ResultadoLapida =
  | { ok: true }
  | { ok: false; status: 409; error: "BOLETA_A_MEDIAS"; jobId: string; detalle: string }
  | { ok: false; status: 500; error: "LAPIDA_QUERY_FAILED"; detalle: string };

export const DETALLE_BOLETA_A_MEDIAS =
  "Hay una boleta anterior que quedó a medias en el SII (pudo haberse emitido). Antes de emitir otra, revísala: recupera o escribe su folio, o marca que no salió.";

/** ¿La empresa tiene una boleta única a medias sin resolver? Fail-closed. */
export async function buscarLapidaBoletaUnica(sb: Sb, empresaId: string): Promise<ResultadoLapida> {
  const { data, error } = await sb
    .from("emision_jobs")
    .select("job_id, estado, propuesta_id, created_at")
    .eq("empresa_id", empresaId)
    .is("propuesta_id", null)
    .eq("estado", "revision_pendiente")
    .gte("created_at", BOLETA_UNICA_LAPIDA_DESDE)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return { ok: false, status: 500, error: "LAPIDA_QUERY_FAILED", detalle: error.message };
  const job = (data ?? []).find((j) => esLapidaBoletaUnica(j as JobBoletaUnica)) as { job_id: string } | undefined;
  if (!job) return { ok: true };
  return { ok: false, status: 409, error: "BOLETA_A_MEDIAS", jobId: job.job_id, detalle: DETALLE_BOLETA_A_MEDIAS };
}

/**
 * Un folio quedó registrado para este job (captura tardía, Recuperar, folio a mano):
 * la lápida de boleta única pasa a `completed` y se suelta el candado que retenía.
 * Best-effort, como liftRevisionTombstone del lote.
 */
export async function levantarLapidaBoletaUnica(sb: Sb, jobId: string | null | undefined): Promise<void> {
  if (!jobId) return;
  try {
    await sb
      .from("emision_jobs")
      .update({ estado: "completed", estado_visible: "completed", updated_at: new Date().toISOString() })
      .eq("job_id", jobId)
      .eq("estado", "revision_pendiente")
      .is("propuesta_id", null);
    await sb.from("emision_locks").delete().eq("job_id", jobId);
  } catch {
    /* best-effort: el folio ya quedó registrado */
  }
}

export type ResultadoDeclaracion =
  | { ok: true }
  | { ok: false; status: number; error: string; detalle: string };

/**
 * "Revisé el SII y no salió" para una boleta única a medias. Mismos controles que el
 * lote (result/route.ts): solo sobre una lápida real, nunca si el server ya tiene un
 * folio capturado para ese intento, y el UPDATE re-filtra por estado (si entre medio
 * llegó el folio, no se pisa). Suelta el candado que la lápida retenía.
 */
export async function declararNoSalioBoletaUnica(
  sb: Sb,
  job: { job_id: string; cuenta_id: string; estado: string; propuesta_id: string | null; created_at: string },
): Promise<ResultadoDeclaracion> {
  if (!esLapidaBoletaUnica(job)) {
    return { ok: false, status: 409, error: "JOB_SIN_LAPIDA", detalle: "Este intento no está a medias." };
  }
  const { data: conFolio, error: errRes } = await sb
    .from("sii_local_resultados")
    .select("folio")
    .eq("job_id", job.job_id)
    .not("folio", "is", null)
    .limit(1);
  if (errRes) return { ok: false, status: 500, error: "RESULTADOS_QUERY_FAILED", detalle: errRes.message };
  const folio = (conFolio ?? [])[0] as { folio?: number } | undefined;
  if (folio) {
    return {
      ok: false, status: 409, error: "FOLIO_CAPTURADO",
      detalle: `El SII devolvió el folio ${folio.folio} para este intento: la boleta sí salió. Usa Recuperar o escribe ese folio.`,
    };
  }
  const { data: cerrados, error: errUpd } = await sb
    .from("emision_jobs")
    .update({
      estado: "failed",
      estado_visible: "failed",
      status_message: "Declarado por la persona: revisó el SII y la boleta no salió",
      updated_at: new Date().toISOString(),
    })
    .eq("job_id", job.job_id)
    .eq("estado", "revision_pendiente")
    .is("propuesta_id", null)
    .select("job_id");
  if (errUpd) return { ok: false, status: 500, error: "DECLARACION_FALLIDA", detalle: errUpd.message };
  if ((cerrados ?? []).length === 0) {
    return { ok: false, status: 409, error: "NADA_QUE_CERRAR", detalle: "Esta boleta cambió de estado mientras la marcabas (llegó su folio). Recarga y revísala." };
  }
  await sb.from("emision_locks").delete().eq("cuenta_id", job.cuenta_id).eq("job_id", job.job_id);
  return { ok: true };
}
