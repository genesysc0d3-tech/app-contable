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
//
// "Arregla todo" (oct-2026), además:
//   · DEL JOB: una boleta que registró ESTE mismo job (track_id / proveedor_respuesta.
//     job_id, mismo criterio que jobSiLaBoletaEsSuya) es propia aunque no tenga
//     propuesta — p. ej. la reentrega del folio B desacoplado con el ack perdido (B2).
//   · BOLETA ÚNICA (job sin propuesta) con jobId: antes devolvía "sin_propuesta" y el
//     camino vivo cerraba el job `completed` con un folio de OTRO documento → la boleta
//     real del intento quedaba sin registrar. Ahora es ajena salvo que sea del job o
//     una huérfana del RCV que se ADOPTA (proveedor_respuesta.job_id, UPDATE
//     condicional) con el monto del intento.
//   · MONTO DESCONOCIDO (RCV con monto 0, solo por declaración humana): además la
//     fecha de la boleta debe caer a ±1 día de la fecha Chile del intento (M2), y el
//     enlace deja evento en ops — un folio mal leído no se enlaza en silencio.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { recordOpsEvent } from "@/lib/ops/events";

type Sb = SupabaseClient<Database>;

export type BoletaExistente = {
  id: string;
  propuesta_id: string | null;
  monto_total?: number | string | null;
  estado?: string | null;
  track_id?: string | null;
  proveedor_respuesta?: unknown;
  fecha_emision?: string | null;
};

function jobDeLaBoleta(b: Pick<BoletaExistente, "proveedor_respuesta">): string | null {
  const pr = b.proveedor_respuesta;
  const j = pr && typeof pr === "object" ? (pr as { job_id?: unknown }).job_id : null;
  return typeof j === "string" && j ? j : null;
}

/** ¿La registró este job? (mismo criterio que jobSiLaBoletaEsSuya de result/route.ts). */
export function boletaEsDelJob(b: Pick<BoletaExistente, "track_id" | "proveedor_respuesta">, jobId: string | null | undefined): boolean {
  if (!jobId) return false;
  return (typeof b.track_id === "string" && b.track_id.includes(jobId)) || jobDeLaBoleta(b) === jobId;
}

/** Diferencia en días entre dos "YYYY-MM-DD" (null si alguna no es fecha). */
function diasEntre(a: string | null | undefined, b: string | null | undefined): number | null {
  const fa = typeof a === "string" ? Date.parse(`${a.slice(0, 10)}T00:00:00Z`) : NaN;
  const fb = typeof b === "string" ? Date.parse(`${b.slice(0, 10)}T00:00:00Z`) : NaN;
  if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
  return Math.abs(fa - fb) / 86_400_000;
}

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
  | "ADOPTADA_POR_OTRO_JOB"
  | "BOLETA_DE_OTRO_JOB"
  | "MONTO_DESCONOCIDO"
  | "FECHA_NO_CALZA"
  | "PROPUESTA_NO_ENCONTRADA"
  | "MONTO_NO_CALZA"
  | "TIPO_NO_CALZA"
  | "PROPUESTA_YA_TIENE_BOLETA"
  | "ENLACE_NO_APLICADO";

export type DecisionFolioExistente =
  /** La boleta ya era de esta propuesta. */
  | { tipo: "propio" }
  /** Era huérfana (propuesta_id NULL) y quedó enlazada a esta propuesta (o adoptada por este job). */
  | { tipo: "enlazado" }
  /** Job sin propuesta y SIN jobId: lo resuelve el llamador como siempre. */
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
    /** Job que trae el folio: una boleta registrada por él es propia (B2, boleta única). */
    jobId?: string | null;
    /** Boleta única: monto del intento (o capturado) para adoptar una huérfana del RCV. */
    montoIntento?: number | null;
    /** Solo el folio a mano (declaración humana): acepta una huérfana RCV con monto 0… */
    aceptarMontoDesconocido?: boolean;
    /** …si su fecha cae a ±1 día de esta (fecha Chile del intento, "YYYY-MM-DD"). */
    fechaIntento?: string | null;
    empresaId?: string | null;
  },
): Promise<DecisionFolioExistente> {
  const { existing, propuestaId } = args;
  if (propuestaId && existing.propuesta_id === propuestaId) return { tipo: "propio" };
  if (boletaEsDelJob(existing, args.jobId)) return { tipo: "propio" };
  if (!propuestaId && !args.jobId) return { tipo: "sin_propuesta" };
  if (existing.propuesta_id) return { tipo: "ajeno", motivo: "OTRA_PROPUESTA" };
  if (!esHuerfanaRcv(existing)) return { tipo: "ajeno", motivo: propuestaId ? "HUERFANA_NO_RCV" : "BOLETA_DE_OTRO_JOB" };
  // Una huérfana del RCV que ya adoptó OTRA boleta única no está libre.
  if (jobDeLaBoleta(existing)) return { tipo: "ajeno", motivo: "ADOPTADA_POR_OTRO_JOB" };
  if (existing.estado === "anulada") return { tipo: "ajeno", motivo: "BOLETA_ANULADA" };

  // Monto: con monto conocido debe calzar; monto 0 solo por declaración humana y con fecha (M2).
  const montoBoleta = Math.round(Number(existing.monto_total));
  const montoDesconocido = !Number.isFinite(montoBoleta) || montoBoleta <= 0;
  if (montoDesconocido) {
    if (!args.aceptarMontoDesconocido) return { tipo: "ajeno", motivo: "MONTO_DESCONOCIDO" };
    const dias = diasEntre(existing.fecha_emision, args.fechaIntento);
    if (dias === null || dias > 1) return { tipo: "ajeno", motivo: "FECHA_NO_CALZA" };
  }

  try {
    if (!propuestaId) {
      // ── BOLETA ÚNICA: adoptar la huérfana del RCV para este job ──
      if (!montoDesconocido && Math.round(Number(args.montoIntento)) !== montoBoleta) return { tipo: "ajeno", motivo: "MONTO_NO_CALZA" };
      const previo = existing.proveedor_respuesta && typeof existing.proveedor_respuesta === "object" ? existing.proveedor_respuesta as Record<string, unknown> : {};
      const { data: adoptadas, error: errAd } = await sb
        .from("boletas_emitidas")
        .update({ proveedor_respuesta: { ...previo, job_id: args.jobId, adoptada_por_job_en: new Date().toISOString(), adopcion: montoDesconocido ? "declaracion_humana_monto_desconocido" : "monto_calza" } as never })
        .eq("id", existing.id)
        .is("propuesta_id", null)
        .is("proveedor_respuesta->>job_id", null)
        .select("id");
      if (errAd) return { tipo: "error", detalle: errAd.message };
      if (!adoptadas || adoptadas.length === 0) {
        const { data: rel, error: errRel } = await sb
          .from("boletas_emitidas").select("id, track_id, proveedor_respuesta").eq("id", existing.id).maybeSingle();
        if (errRel) return { tipo: "error", detalle: errRel.message };
        return rel && boletaEsDelJob(rel as BoletaExistente, args.jobId) ? { tipo: "propio" } : { tipo: "ajeno", motivo: "ENLACE_NO_APLICADO" };
      }
      if (montoDesconocido) await avisarEnlaceMontoDesconocido(sb, args);
      return { tipo: "enlazado" };
    }

    const { data: prop, error: errProp } = await sb
      .from("propuestas_ia").select("total, tipo_dte").eq("id", propuestaId).maybeSingle();
    if (errProp) return { tipo: "error", detalle: errProp.message };
    if (!prop) return { tipo: "ajeno", motivo: "PROPUESTA_NO_ENCONTRADA" };
    const p = prop as { total: number | string | null; tipo_dte: number | null };
    const montoProp = Math.round(Number(p.total));
    if (!montoDesconocido && (!Number.isFinite(montoProp) || montoProp !== montoBoleta)) {
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
    if (!errUpd && enlazadas && enlazadas.length > 0) {
      if (montoDesconocido) await avisarEnlaceMontoDesconocido(sb, args);
      return { tipo: "enlazado" };
    }
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

/** Enlace de una huérfana RCV SIN monto por declaración humana: queda a la vista (M2). */
async function avisarEnlaceMontoDesconocido(
  sb: Sb,
  args: { existing: BoletaExistente; propuestaId: string | null; jobId?: string | null; fechaIntento?: string | null; empresaId?: string | null; tipoDte: number },
) {
  await recordOpsEvent({
    sb,
    severity: "warn",
    source: "sii-local",
    eventName: "sii_local_enlace_rcv_monto_desconocido",
    summary: "Folio a mano enlazado a una boleta del RCV sin monto (declaración humana): revisar que sea el correcto",
    empresaId: args.empresaId ?? null,
    resourceType: "emision_job",
    resourceId: args.jobId ?? null,
    metadata: {
      boleta_id: args.existing.id, propuesta_id: args.propuestaId, tipo_dte: args.tipoDte,
      fecha_boleta: args.existing.fecha_emision ?? null, fecha_intento: args.fechaIntento ?? null,
    },
  });
}
