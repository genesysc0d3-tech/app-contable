// ¿Se puede abrir un job de emisión para esta propuesta? Candado anti-doble-folio
// de /api/emision/jobs, extraído para testearlo sin red.
//
// FALLA CERRADA (2026-09-28): antes cada consulta leía solo `{ data }`. Si Supabase
// fallaba (timeout, pool lleno), `data` venía null y el control se SALTABA: una
// propuesta ya emitida podía volver al portal y sacar un segundo folio. Ahora un
// error de consulta = no se emite (el lote lo marca fallida y se reintenta).

import type { SupabaseClient } from "@supabase/supabase-js";

type Sb = SupabaseClient;

export type PropuestaEmitible =
  | { ok: true }
  | { ok: false; status: 409 | 500; error: string; detalle: string };

const CONSULTA_FALLIDA: PropuestaEmitible = {
  ok: false,
  status: 500,
  error: "PROPUESTA_CHECK_FAILED",
  detalle: "No pudimos confirmar si esta boleta ya fue emitida. No se emitió; inténtalo de nuevo.",
};

/** (a) ¿la propuesta YA tiene boleta vigente? (carrera única↔lote, 2 pestañas, 2 personas). */
export async function revisarYaEmitida(sb: Sb, propuestaId: string): Promise<PropuestaEmitible> {
  const { data, error } = await sb
    .from("boletas_emitidas")
    .select("id")
    .eq("propuesta_id", propuestaId)
    .neq("estado", "anulada")
    .limit(1)
    .maybeSingle();
  if (error) return CONSULTA_FALLIDA;
  if (data) return { ok: false, status: 409, error: "PROPUESTA_YA_EMITIDA", detalle: "Esta boleta ya fue emitida." };
  return { ok: true };
}

/**
 * Chequeo completo ANTES de tomar el candado: ya emitida → a medias → en vuelo.
 * El orden importa: "ya emitida" es el código que el lote salta sin pausar.
 */
export async function revisarPropuestaEmitible(sb: Sb, propuestaId: string, ahora = new Date()): Promise<PropuestaEmitible> {
  const ya = await revisarYaEmitida(sb, propuestaId);
  if (!ya.ok) return ya;

  // (b1) ¿quedó "a medias" (lápida)? Bloqueo INCONDICIONAL hasta recuperar el folio.
  const { data: enRevision, error: errRevision } = await sb
    .from("emision_jobs")
    .select("job_id")
    .eq("propuesta_id", propuestaId)
    .eq("estado", "revision_pendiente")
    .limit(1)
    .maybeSingle();
  if (errRevision) return CONSULTA_FALLIDA;
  if (enRevision) {
    return { ok: false, status: 409, error: "REVISION_PENDIENTE", detalle: "Esta boleta quedó a medias en el SII. Recupera su folio antes de re-emitir." };
  }

  // (b2) ¿hay un job aún EN VUELO (no expirado)? Acotado a no-expirados para no
  // bloquear una propuesta para siempre si un intento crasheó pre-emit.
  const { data: enVuelo, error: errVuelo } = await sb
    .from("emision_jobs")
    .select("job_id")
    .eq("propuesta_id", propuestaId)
    .in("estado", ["created", "running"])
    .gt("expires_at", ahora.toISOString())
    .limit(1)
    .maybeSingle();
  if (errVuelo) return CONSULTA_FALLIDA;
  if (enVuelo) {
    return { ok: false, status: 409, error: "EMISION_EN_CURSO", detalle: "Ya hay una emisión en curso para esta boleta." };
  }
  return { ok: true };
}
