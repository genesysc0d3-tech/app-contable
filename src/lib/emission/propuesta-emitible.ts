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
  | {
      ok: false; status: 409 | 500; error: string; detalle: string;
      /** Solo en PROPUESTA_YA_EMITIDA: la boleta que ya existe. Permite a la
       *  verificación de una emisión incierta cerrarla como emitida con su folio. */
      folio?: number | null; boletaId?: string | null;
    };

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
    .select("id, folio")
    .eq("propuesta_id", propuestaId)
    .neq("estado", "anulada")
    .limit(1)
    .maybeSingle();
  if (error) return CONSULTA_FALLIDA;
  if (data) {
    const fila = data as { id: string; folio: number | null };
    return { ok: false, status: 409, error: "PROPUESTA_YA_EMITIDA", detalle: "Esta boleta ya fue emitida.", folio: fila.folio ?? null, boletaId: fila.id };
  }
  return { ok: true };
}

/** (b1) ¿quedó "a medias" (lápida)? Bloqueo INCONDICIONAL hasta recuperar el folio. */
async function revisarLapida(sb: Sb, propuestaId: string): Promise<PropuestaEmitible> {
  const { data, error } = await sb
    .from("emision_jobs")
    .select("job_id")
    .eq("propuesta_id", propuestaId)
    .eq("estado", "revision_pendiente")
    .limit(1)
    .maybeSingle();
  if (error) return CONSULTA_FALLIDA;
  if (data) {
    return { ok: false, status: 409, error: "REVISION_PENDIENTE", detalle: "Esta boleta quedó a medias en el SII. Recupera su folio antes de re-emitir." };
  }
  return { ok: true };
}

/**
 * Re-chequeo CON EL CANDADO TOMADO: ya emitida + lápida. El chequeo previo corre sin
 * candado; entre medio otra persona pudo terminar la boleta (emitida) o dejarla a
 * medias (el lote suelta el candado al sellar la lápida). "En vuelo" no se mira: el
 * job recién creado por el candado es el propio.
 */
export async function revisarPostCandado(sb: Sb, propuestaId: string): Promise<PropuestaEmitible> {
  const ya = await revisarYaEmitida(sb, propuestaId);
  if (!ya.ok) return ya;
  return revisarLapida(sb, propuestaId);
}

/** (b2) ¿hay un job aún EN VUELO (no expirado)? Acotado a no-expirados para no
 *  bloquear una propuesta para siempre si un intento crasheó pre-emit. */
async function revisarEnVuelo(sb: Sb, propuestaId: string, ahora: Date): Promise<PropuestaEmitible> {
  const { data, error } = await sb
    .from("emision_jobs")
    .select("job_id")
    .eq("propuesta_id", propuestaId)
    .in("estado", ["created", "running"])
    .gt("expires_at", ahora.toISOString())
    .limit(1)
    .maybeSingle();
  if (error) return CONSULTA_FALLIDA;
  if (data) return { ok: false, status: 409, error: "EMISION_EN_CURSO", detalle: "Ya hay una emisión en curso para esta boleta." };
  return { ok: true };
}

/**
 * Chequeo completo ANTES de tomar el candado: ya emitida → a medias → en vuelo.
 * Las tres consultas van EN PARALELO (plan-costo-vercel §6 PR 3: una ida a la base
 * en vez de tres por boleta) pero se JUZGAN en este orden, así la precedencia de
 * códigos es la de siempre: "ya emitida" es el código que el lote salta sin pausar.
 */
export async function revisarPropuestaEmitible(sb: Sb, propuestaId: string, ahora = new Date()): Promise<PropuestaEmitible> {
  const [ya, lapida, vuelo] = await Promise.all([
    revisarYaEmitida(sb, propuestaId),
    revisarLapida(sb, propuestaId),
    revisarEnVuelo(sb, propuestaId, ahora),
  ]);
  for (const r of [ya, lapida, vuelo]) if (!r.ok) return r;
  return { ok: true };
}
