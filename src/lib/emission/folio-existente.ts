// ¿De quién es un folio que YA está en boletas_emitidas? (auditoría oct-2026, hallazgo 1)
//
// Las ramas de /api/sii-local/result que se topan con un folio ya registrado
// (camino vivo `existing` + su carrera, red anti-pérdida backfillFolioSinJobVivo + su
// carrera, folio a mano del lote) solo lo trataban como AJENO si las DOS filas tenían
// propuesta_id. Pero el reconcile del RCV (sii-local/reconcile, que a propósito no
// enlaza: el RCV no dice de qué propuesta es un folio) deja boletas con propuesta_id
// NULL. Con una de esas, la rama respondía "already", cerraba el job y levantaba la
// lápida de la propuesta SIN enlazarla → revisarYaEmitida no la encontraba → la
// propuesta volvía a Listas → re-emitir = DOBLE FOLIO.
//
// Ahora, con job de propuesta y boleta existente sin propuesta, se ENLAZA (este job
// capturó ese folio: es el match confiable que al reconcile le falta) solo si:
//   · la boleta nació del RCV (track_id "sii-local-rcv:" o proveedor_respuesta.origen
//     "reconciliacion_rcv", lo que escribe reconcile/route.ts). Otras huérfanas NO se
//     enlazan nunca (rev. adversarial #1): la boleta ÚNICA nace sin propuesta a
//     propósito y el folio B de un doble folio se desacopló a propósito — enlazarlas a
//     una propuesta del lote le robaría la atribución en silencio,
//   · la boleta no está anulada,
//   · el monto (y el tipo, si la propuesta lo fija) calza con la propuesta — si no,
//     es un dedazo/cruce de folio. Monto 0 del RCV (el reconcile pone `?? 0` cuando
//     el Resumen no lo trae) = DESCONOCIDO: no se enlaza solo; solo la declaración
//     humana del folio a mano puede (aceptarMontoDesconocido),
//   · la propuesta no tiene YA otra boleta vigente (idx_boletas_propuesta_unica_vigente),
//   · el UPDATE condicional (propuesta_id IS NULL) afecta la fila: si otro la enlazó
//     entre medio, o choca con el índice único, no es nuestra — salvo que la otra
//     entrega la haya enlazado a ESTA misma propuesta (doble entrega simultánea del
//     stash, rev. adversarial #5): eso es "propio".
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
  track_id?: string | null;
  proveedor_respuesta?: unknown;
};

/** Error del stash para un folio que pudo ser propio (huérfana RCV sin monto): bloquea «no salió». */
export const ERROR_FOLIO_HUERFANO_SIN_MONTO = "FOLIO_HUERFANO_SIN_MONTO";

/** ¿La boleta la creó el reconcile del RCV? (lo único huérfano que se puede enlazar). */
export function esHuerfanaRcv(b: Pick<BoletaExistente, "track_id" | "proveedor_respuesta">): boolean {
  if (typeof b.track_id === "string" && b.track_id.startsWith("sii-local-rcv:")) return true;
  const pr = b.proveedor_respuesta;
  return Boolean(pr && typeof pr === "object" && (pr as { origen?: unknown }).origen === "reconciliacion_rcv");
}

export type MotivoFolioAjeno =
  | "OTRA_PROPUESTA"
  | "BOLETA_ANULADA"
  | "HUERFANA_NO_RCV"
  | "MONTO_DESCONOCIDO"
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
  args: {
    existing: BoletaExistente;
    propuestaId: string | null;
    tipoDte: number;
    /** Solo el folio a mano (declaración humana): enlaza una huérfana RCV con monto 0. */
    aceptarMontoDesconocido?: boolean;
  },
): Promise<DecisionFolioExistente> {
  const { existing, propuestaId } = args;
  if (!propuestaId) return { tipo: "sin_propuesta" };
  if (existing.propuesta_id === propuestaId) return { tipo: "propio" };
  if (existing.propuesta_id) return { tipo: "ajeno", motivo: "OTRA_PROPUESTA" };
  if (!esHuerfanaRcv(existing)) return { tipo: "ajeno", motivo: "HUERFANA_NO_RCV" };
  if (existing.estado === "anulada") return { tipo: "ajeno", motivo: "BOLETA_ANULADA" };

  try {
    const { data: prop, error: errProp } = await sb
      .from("propuestas_ia").select("total, tipo_dte").eq("id", propuestaId).maybeSingle();
    if (errProp) return { tipo: "error", detalle: errProp.message };
    if (!prop) return { tipo: "ajeno", motivo: "PROPUESTA_NO_ENCONTRADA" };
    const p = prop as { total: number | string | null; tipo_dte: number | null };
    const montoProp = Math.round(Number(p.total));
    const montoBoleta = Math.round(Number(existing.monto_total));
    if (!Number.isFinite(montoBoleta) || montoBoleta <= 0) {
      if (!args.aceptarMontoDesconocido) return { tipo: "ajeno", motivo: "MONTO_DESCONOCIDO" };
    } else if (!Number.isFinite(montoProp) || montoProp !== montoBoleta) {
      return { tipo: "ajeno", motivo: "MONTO_NO_CALZA" };
    }
    if (p.tipo_dte != null && Number(p.tipo_dte) !== Number(args.tipoDte)) return { tipo: "ajeno", motivo: "TIPO_NO_CALZA" };

    const { data: vigente, error: errVig } = await sb
      .from("boletas_emitidas").select("id")
      .eq("propuesta_id", propuestaId).neq("estado", "anulada")
      .limit(1).maybeSingle();
    if (errVig) return { tipo: "error", detalle: errVig.message };
    if (vigente) {
      // Doble entrega simultánea: la otra ya enlazó ESTA misma boleta a esta propuesta.
      if ((vigente as { id: string }).id === existing.id) return { tipo: "propio" };
      return { tipo: "ajeno", motivo: "PROPUESTA_YA_TIENE_BOLETA" };
    }

    const { data: enlazadas, error: errUpd } = await sb
      .from("boletas_emitidas")
      .update({ propuesta_id: propuestaId })
      .eq("id", existing.id)
      .is("propuesta_id", null)
      .select("id");
    if (errUpd && (errUpd as { code?: string }).code !== "23505") return { tipo: "error", detalle: errUpd.message };
    if (!errUpd && enlazadas && enlazadas.length > 0) return { tipo: "enlazado" };
    // 0 filas o 23505 (idx_boletas_propuesta_unica_vigente): alguien ganó entre medio.
    // Se relee: si la ganadora fue otra entrega de ESTA propuesta sobre ESTA boleta, es propia.
    const { data: relectura, error: errRel } = await sb
      .from("boletas_emitidas").select("id, propuesta_id").eq("id", existing.id).maybeSingle();
    if (errRel) return { tipo: "error", detalle: errRel.message };
    if ((relectura as { propuesta_id?: string | null } | null)?.propuesta_id === propuestaId) return { tipo: "propio" };
    return { tipo: "ajeno", motivo: errUpd ? "PROPUESTA_YA_TIENE_BOLETA" : "ENLACE_NO_APLICADO" };
  } catch (e) {
    return { tipo: "error", detalle: e instanceof Error ? e.message : String(e) };
  }
}
