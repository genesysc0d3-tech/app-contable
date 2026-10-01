// ¿De quién es un folio que YA está en boletas_emitidas? (auditoría oct-2026, hallazgo 1)
//
// Las tres ramas de /api/sii-local/result que se topan con un folio ya registrado
// (camino vivo `existing` + su carrera, red anti-pérdida backfillFolioSinJobVivo + su
// carrera, folio a mano del lote) solo lo trataban como AJENO si las DOS filas tenían
// propuesta_id. Pero hay boletas con propuesta_id NULL: el reconcile del RCV
// (sii-local/reconcile, que a propósito no enlaza: el RCV no dice de qué propuesta es
// un folio) y la boleta única. Con una de esas, la rama respondía "already", cerraba
// el job y levantaba la lápida de la propuesta SIN enlazarla → revisarYaEmitida no la
// encontraba → la propuesta volvía a Listas → re-emitir = DOBLE FOLIO.
//
// Ahora, con job de propuesta y boleta existente sin propuesta, se ENLAZA (este job
// capturó ese folio: es el match confiable que al reconcile le falta) solo si:
//   · la boleta no está anulada,
//   · el monto (y el tipo, si la propuesta lo fija) calza con la propuesta — si no,
//     es un dedazo/cruce de folio,
//   · la propuesta no tiene YA otra boleta vigente (idx_boletas_propuesta_unica_vigente),
//   · el UPDATE condicional (propuesta_id IS NULL) afecta la fila: si otro la enlazó
//     entre medio, o choca con el índice único, no es nuestra.
// Cualquier "no" = AJENO: no se cierra el job ni se levanta la lápida. Un error de
// consulta = "error": tampoco se levanta nada (fail-closed), pero NO es un rechazo
// permanente (la extensión reintenta su stash).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Sb = SupabaseClient<Database>;

export type BoletaExistente = {
  id: string;
  propuesta_id: string | null;
  monto_total?: number | string | null;
  estado?: string | null;
};

export type MotivoFolioAjeno =
  | "OTRA_PROPUESTA"
  | "BOLETA_ANULADA"
  | "PROPUESTA_NO_ENCONTRADA"
  | "MONTO_NO_CALZA"
  | "TIPO_NO_CALZA"
  | "PROPUESTA_YA_TIENE_BOLETA"
  | "ENLACE_NO_APLICADO";

export type DecisionFolioExistente =
  /** La boleta ya era de esta propuesta. */
  | { tipo: "propio" }
  /** Era huérfana (propuesta_id NULL) y quedó enlazada a esta propuesta. */
  | { tipo: "enlazado" }
  /** Job sin propuesta (boleta única): lo resuelve el llamador como siempre. */
  | { tipo: "sin_propuesta" }
  | { tipo: "ajeno"; motivo: MotivoFolioAjeno }
  | { tipo: "error"; detalle: string };

/** ¿Este resultado puede cerrar el job / levantar la lápida de su propuesta? */
export function folioCierraLaPropuesta(d: DecisionFolioExistente): boolean {
  return d.tipo === "propio" || d.tipo === "enlazado" || d.tipo === "sin_propuesta";
}

export async function resolverFolioExistente(
  sb: Sb,
  args: { existing: BoletaExistente; propuestaId: string | null; tipoDte: number },
): Promise<DecisionFolioExistente> {
  const { existing, propuestaId } = args;
  if (!propuestaId) return { tipo: "sin_propuesta" };
  if (existing.propuesta_id === propuestaId) return { tipo: "propio" };
  if (existing.propuesta_id) return { tipo: "ajeno", motivo: "OTRA_PROPUESTA" };
  if (existing.estado === "anulada") return { tipo: "ajeno", motivo: "BOLETA_ANULADA" };

  try {
    const { data: prop, error: errProp } = await sb
      .from("propuestas_ia").select("total, tipo_dte").eq("id", propuestaId).maybeSingle();
    if (errProp) return { tipo: "error", detalle: errProp.message };
    if (!prop) return { tipo: "ajeno", motivo: "PROPUESTA_NO_ENCONTRADA" };
    const p = prop as { total: number | string | null; tipo_dte: number | null };
    const montoProp = Math.round(Number(p.total));
    const montoBoleta = Math.round(Number(existing.monto_total));
    if (!Number.isFinite(montoProp) || !Number.isFinite(montoBoleta) || montoProp !== montoBoleta) {
      return { tipo: "ajeno", motivo: "MONTO_NO_CALZA" };
    }
    if (p.tipo_dte != null && Number(p.tipo_dte) !== Number(args.tipoDte)) return { tipo: "ajeno", motivo: "TIPO_NO_CALZA" };

    const { data: vigente, error: errVig } = await sb
      .from("boletas_emitidas").select("id")
      .eq("propuesta_id", propuestaId).neq("estado", "anulada")
      .limit(1).maybeSingle();
    if (errVig) return { tipo: "error", detalle: errVig.message };
    if (vigente) return { tipo: "ajeno", motivo: "PROPUESTA_YA_TIENE_BOLETA" };

    const { data: enlazadas, error: errUpd } = await sb
      .from("boletas_emitidas")
      .update({ propuesta_id: propuestaId })
      .eq("id", existing.id)
      .is("propuesta_id", null)
      .select("id");
    if (errUpd) {
      // 23505 = idx_boletas_propuesta_unica_vigente: otra boleta tomó la propuesta entre medio.
      if ((errUpd as { code?: string }).code === "23505") return { tipo: "ajeno", motivo: "PROPUESTA_YA_TIENE_BOLETA" };
      return { tipo: "error", detalle: errUpd.message };
    }
    if (!enlazadas || enlazadas.length === 0) return { tipo: "ajeno", motivo: "ENLACE_NO_APLICADO" };
    return { tipo: "enlazado" };
  } catch (e) {
    return { tipo: "error", detalle: e instanceof Error ? e.message : String(e) };
  }
}
