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
// `revision_pendiente` (y la vista cierra la ventana del SII, como el lote, para que
// su «Reintentar» no re-emita con el mismo job). Mientras la empresa tenga una boleta
// única así (posterior al corte), el POST de /api/emision/jobs no abre otra boleta
// única: primero se resuelve. Salidas REALES (revisión adversarial del fix):
//   - el folio de ESA boleta: Recuperar, o escrito a mano con los datos del INTENTO
//     (monto/tipo/receptor guardados en el job al crearlo), por cualquier persona de
//     la cuenta con permiso de emitir;
//   - «Revisé el SII y no salió», en dos pasos y no antes de que el intento haya
//     vencido (máx(expires_at, updated_at + 10 min)); si después llega un folio para
//     ese intento, alerta crítica.
//
// Acotado a jobs nuevos: en prod no hay ninguna boleta única en revision_pendiente
// (SELECT 2026-09-30), así que el corte no deja a nadie trabado de golpe.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { DECLARAR_SIN_RESPUESTA_TRAS_MS } from "./lapida";

type Sb = SupabaseClient<Database>;

export const BOLETA_UNICA_LAPIDA_DESDE = "2026-09-30T00:00:00Z";
/** Origin de la boleta única (EmitirDirectaView y el default del POST de jobs). */
export const ORIGIN_BOLETA_UNICA = "emision_directa";

export type JobBoletaUnica = { estado: string; propuesta_id: string | null; created_at: string };

export function esLapidaBoletaUnica(job: JobBoletaUnica): boolean {
  if (job.propuesta_id) return false; // el lote tiene su propia lápida (lapida.ts)
  if (job.estado !== "revision_pendiente") return false;
  return Date.parse(job.created_at) >= Date.parse(BOLETA_UNICA_LAPIDA_DESDE);
}

// ── ¿Alcanzó a apretar EMITIR? (auditoría oct-2026, hallazgo 2) ───────────────
//
// Hueco: la lápida solo nacía de un aviso explícito de la extensión. Si la pestaña
// moría DESPUÉS de mandar FILL_AND_EMIT, el job quedaba `running`, vencía y nadie lo
// cerraba: el candado vencido se borra al pedir otro (locks.ts) y la empresa podía
// emitir otra boleta → doble boleta. Y el «liberar candado» (cancelStaleLock) lo
// cerraba `cancelled` sin mirar si ya había apretado EMITIR.
//
// No hay columna "disparado": la señal es `estado_visible`, que el latido (PATCH de
// /api/emision/jobs) pisa con el ÚLTIMO status de la extensión. La extensión manda
// "submitting" justo antes de FILL_AND_EMIT (background.js) y nunca manda
// "cancelled"/"closed" después del clic. Mismo criterio que ESTADOS_POSIBLE_CLIC de
// EmitirDirectaView (+ los de la factura: firmar es el clic). Un job que nunca pasó
// de opening_sii / sii_page_ready / waiting_sii_login sí se cancela libre.
// Límite conocido: si la PÁGINA muere entre el "submitting" de la extensión y su
// latido, el server no se entera (queda como pre-clic). Lo cubre la extensión.
// MONÓTONA (rev. adversarial #3): tras firmar una factura la extensión sigue mandando
// "fact_drive", "retrying", "working"… y el latido pisaba la marca. El latido usa
// marcarEstadoVisibleLatido: una vez post-clic, estado_visible no vuelve a pre-clic.
export const ESTADOS_VISIBLES_POSIBLE_CLIC: ReadonlySet<string> = new Set([
  "submitting", "capturing_result", "result_awaiting_ack", "result_needs_review", "emitted",
  "firmar_click", "signing", "fact_sign_poll",
]);

export type JobBoletaUnicaAbierta = JobBoletaUnica & { estado_visible?: string | null; expires_at?: string | null };

/**
 * Campos de estado_visible para el UPDATE PRINCIPAL del latido (vuelta 2, B1): un
 * status post-clic va ahí mismo (una sola query, atómica con la renovación); uno
 * pre-clic no — ese pasa por marcarEstadoVisibleLatido, con su condición monótona.
 */
export function estadoVisibleEnLatidoPrincipal(estado: string): { estado_visible?: string } {
  return ESTADOS_VISIBLES_POSIBLE_CLIC.has(estado) ? { estado_visible: estado } : {};
}

/**
 * Latido (PATCH de /api/emision/jobs), status PRE-clic: escribe el status de la extensión en el job sin
 * BORRAR una marca de posible clic. Un status post-clic se escribe siempre; uno
 * pre-clic solo si el job no estaba ya post-clic — condición en el mismo UPDATE
 * (atómica por fila: dos latidos cruzados no pierden la marca). Solo jobs abiertos.
 */
export async function marcarEstadoVisibleLatido(sb: Sb, jobId: string, estado: string): Promise<{ error: { message: string } | null }> {
  let q = sb
    .from("emision_jobs")
    .update({ estado_visible: estado })
    .eq("job_id", jobId)
    .in("estado", ["created", "running"]);
  if (!ESTADOS_VISIBLES_POSIBLE_CLIC.has(estado)) {
    q = q.or(`estado_visible.is.null,estado_visible.not.in.(${[...ESTADOS_VISIBLES_POSIBLE_CLIC].join(",")})`);
  }
  const { error } = await q;
  return { error: error ? { message: error.message } : null };
}

/** Boleta única (posterior al corte) cuyo último status conocido es post-clic. */
export function posibleClicBoletaUnica(job: { propuesta_id: string | null; created_at: string; estado_visible?: string | null }): boolean {
  if (job.propuesta_id) return false;
  if (!(Date.parse(job.created_at) >= Date.parse(BOLETA_UNICA_LAPIDA_DESDE))) return false;
  return ESTADOS_VISIBLES_POSIBLE_CLIC.has(String(job.estado_visible ?? ""));
}

/**
 * Boleta única SIN RESPUESTA: abierta (created/running), vencida y con posible clic.
 * Es un resultado desconocido, igual que la "sin respuesta" del lote (lapida.ts): se
 * sella como lápida, nunca se deja vencer en silencio.
 */
export function esSinRespuestaBoletaUnica(job: JobBoletaUnicaAbierta, ahora: Date = new Date()): boolean {
  if (job.estado !== "created" && job.estado !== "running") return false;
  if (!job.expires_at) return false;
  if (Date.parse(job.expires_at) > ahora.getTime()) return false;
  return posibleClicBoletaUnica(job);
}

// ── Intento: lo que se mandó al SII ─────────────────────────────────────────

export type IntentoBoletaUnica = {
  monto: number;
  tipo_dte: 33 | 34 | 39 | 41;
  receptor_rut: string | null;
  receptor_nombre: string | null;
  detalle: string | null;
};

const texto = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Valida el intento que manda el navegador (o el guardado en el job). Basura → null. */
export function leerIntento(raw: unknown): IntentoBoletaUnica | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const monto = Number(r.monto);
  const tipo = Number(r.tipo_dte);
  if (!Number.isFinite(monto) || monto <= 0 || !Number.isInteger(Math.round(monto))) return null;
  if (![33, 34, 39, 41].includes(tipo)) return null;
  return {
    monto: Math.round(monto),
    tipo_dte: tipo as IntentoBoletaUnica["tipo_dte"],
    receptor_rut: texto(r.receptor_rut, 15),
    receptor_nombre: texto(r.receptor_nombre, 100),
    detalle: texto(r.detalle, 80),
  };
}

const NOMBRE_TIPO: Record<number, string> = { 39: "boleta afecta", 41: "boleta exenta", 33: "factura afecta", 34: "factura exenta" };

function cuandoChile(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const f = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const p = (t: string) => (f.find((x) => x.type === t)?.value ?? "").padStart(2, "0");
  return `del ${p("day")}/${p("month")} a las ${p("hour")}:${p("minute")}`;
}

/** "boleta exenta de $10.000 a Ana Pérez del 30/09 a las 14:05" — qué buscar en el SII. */
export function describirIntento(intento: IntentoBoletaUnica | null, creadaAt: string): string {
  const cuando = cuandoChile(creadaAt);
  if (!intento) return `la boleta que se intentó emitir ${cuando}`.trim();
  const a = intento.receptor_nombre ?? intento.receptor_rut;
  return `${NOMBRE_TIPO[intento.tipo_dte] ?? "boleta"} de $${intento.monto.toLocaleString("es-CL")}${a ? ` a ${a}` : ""} ${cuando}`.trim();
}

/**
 * Monto y tipo con que se registra el folio escrito a mano. Mandan los del INTENTO
 * guardado en el job (lo que de verdad se tecleó en el SII); el borrador que la
 * persona tenga abierto ahora es otra boleta. Sin intento guardado (migración sin
 * aplicar), la persona declara el monto y el tipo de ESA boleta.
 */
export function datosFolioBoletaUnica(
  job: { intento?: unknown },
  declarado: { monto: number; tipo_dte: number } | null,
): { ok: true; monto: number; tipo_dte: 33 | 34 | 39 | 41; intento: IntentoBoletaUnica | null } | { ok: false; error: "FALTA_MONTO_INTENTO"; detalle: string } {
  const intento = leerIntento(job.intento);
  if (intento) return { ok: true, monto: intento.monto, tipo_dte: intento.tipo_dte, intento };
  const dec = declarado ? leerIntento({ monto: declarado.monto, tipo_dte: declarado.tipo_dte }) : null;
  if (dec) return { ok: true, monto: dec.monto, tipo_dte: dec.tipo_dte, intento: null };
  return { ok: false, error: "FALTA_MONTO_INTENTO", detalle: "Escribe también el monto y el tipo de ESA boleta (como aparece en el SII)." };
}

/**
 * Monto y tipo que el navegador manda con el folio a mano de una lápida (vuelta 2,
 * V2-M1). Si el recuadro tiene el intento en memoria (lápida sellada en esta misma
 * sesión) se manda ESE como declarado: sin la migración del `intento` el server no lo
 * tiene y respondía "falta el monto" con el campo oculto. El server igual prefiere el
 * intento guardado si existe. Sin intento: lo que la persona escribió de ESA boleta.
 */
export function declaradoParaFolio(
  intento: IntentoBoletaUnica | null,
  montoEscrito: string,
  tipoEscrito: number,
): { ok: true; declarado: { monto: number; tipoDte: number } } | { ok: false; mensaje: string } {
  if (intento) return { ok: true, declarado: { monto: intento.monto, tipoDte: intento.tipo_dte } };
  const monto = Number((montoEscrito ?? "").replace(/[^0-9]/g, ""));
  if (!Number.isSafeInteger(monto) || monto <= 0) {
    return { ok: false, mensaje: "Escribe también el monto de ESA boleta, como aparece en el SII." };
  }
  return { ok: true, declarado: { monto, tipoDte: tipoEscrito } };
}

// ── Qué hacer con cada aviso de la extensión ────────────────────────────────

export const MENSAJE_INCIERTA =
  "La conexión con la ventana del SII se cortó justo después de mandar la boleta: pudo haberse emitido, así que no vuelvas a emitir: búscala en el SII. Si aparece, usa Recuperar o escribe su folio abajo; si no aparece, márcalo cuando se habilite la opción.";

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

// ── Búsqueda de la lápida (POST de jobs) ────────────────────────────────────

export type ResultadoLapida =
  | { ok: true }
  | {
      ok: false; status: 409; error: "BOLETA_A_MEDIAS"; jobId: string; detalle: string;
      intento: IntentoBoletaUnica | null; creadaAt: string; usuarioId: string | null;
    }
  | { ok: false; status: 500; error: "LAPIDA_QUERY_FAILED"; detalle: string };

export const DETALLE_BOLETA_A_MEDIAS =
  "Hay una boleta anterior que quedó a medias (pudo haber salido en el SII). Antes de emitir otra, búscala en el SII: si aparece, usa Recuperar o escribe su folio abajo; si no aparece, márcalo.";

export function detalleBoletaAMedias(intento: IntentoBoletaUnica | null, creadaAt: string): string {
  return `Quedó a medias ${describirIntento(intento, creadaAt)} (pudo haber salido en el SII). Antes de emitir otra, búscala en el SII: si aparece, usa Recuperar o escribe su folio abajo; si no aparece, márcalo.`;
}

/** ¿La empresa tiene una boleta única a medias sin resolver? Fail-closed. */
export async function buscarLapidaBoletaUnica(sb: Sb, empresaId: string, ahora: Date = new Date()): Promise<ResultadoLapida> {
  // `*`: trae `intento` si la migración está aplicada, sin romper si no lo está.
  // + los ABIERTOS (created/running): uno vencido con posible clic es una boleta sin
  // respuesta (esSinRespuestaBoletaUnica) y también bloquea.
  const { data, error } = await sb
    .from("emision_jobs")
    .select("*")
    .eq("empresa_id", empresaId)
    .is("propuesta_id", null)
    // Solo boletas únicas de verdad: una lápida del LOTE cuya propuesta se borró
    // (FK ON DELETE SET NULL) no es una boleta única a medias.
    .eq("origin", ORIGIN_BOLETA_UNICA)
    .in("estado", ["revision_pendiente", "created", "running"])
    .gte("created_at", BOLETA_UNICA_LAPIDA_DESDE)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { ok: false, status: 500, error: "LAPIDA_QUERY_FAILED", detalle: error.message };
  type FilaJob = JobBoletaUnicaAbierta & { job_id: string; usuario_id?: string | null; intento?: unknown };
  const filas = (data ?? []) as unknown as FilaJob[];
  let job: FilaJob | undefined = filas.find((j) => esLapidaBoletaUnica(j));
  if (!job) {
    // Sin respuesta → se SELLA a medias (UPDATE condicional: solo si sigue abierta y
    // vencida; si entre medio llegó su folio o un latido la renovó, 0 filas y no
    // bloquea). Así el resto del camino (folio a mano, «no salió», levantar al
    // registrar el folio) funciona igual que con cualquier lápida.
    for (const j of filas.filter((f) => esSinRespuestaBoletaUnica(f, ahora))) {
      // Su folio YA puede estar registrado (rev. adversarial #2): venció `running`, la
      // extensión entregó el folio por la red anti-pérdida y nadie cerró el job. Se
      // cierra `completed` y no bloquea. Fail-closed si la consulta falla.
      const { data: suya, error: errSuya } = await sb
        .from("boletas_emitidas")
        .select("id")
        .eq("empresa_id", empresaId)
        .eq("proveedor_respuesta->>job_id", j.job_id)
        .limit(1);
      if (errSuya) return { ok: false, status: 500, error: "LAPIDA_QUERY_FAILED", detalle: errSuya.message };
      if ((suya ?? []).length > 0) {
        await levantarLapidaBoletaUnica(sb, j.job_id);
        continue;
      }
      const { data: selladas, error: errSello } = await sb
        .from("emision_jobs")
        // status_message marca que nació SIN RESPUESTA: «no salió» espera como el lote (#8).
        .update({ estado: "revision_pendiente", estado_visible: "revision_pendiente", status_message: SELLO_SIN_RESPUESTA })
        .eq("job_id", j.job_id)
        .in("estado", ["created", "running"])
        .lte("expires_at", ahora.toISOString())
        .select("job_id");
      if (errSello) return { ok: false, status: 500, error: "LAPIDA_QUERY_FAILED", detalle: errSello.message };
      if ((selladas ?? []).length > 0) { job = j; break; }
    }
  }
  if (!job) return { ok: true };
  const intento = leerIntento(job.intento);
  return {
    ok: false, status: 409, error: "BOLETA_A_MEDIAS", jobId: job.job_id,
    detalle: detalleBoletaAMedias(intento, job.created_at),
    intento, creadaAt: job.created_at, usuarioId: job.usuario_id ?? null,
  };
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
      // + abiertos (rev. adversarial #2): un job que venció `running` y cuyo folio llegó
      // por la red anti-pérdida también queda cerrado (como liftRevisionTombstone del lote).
      .in("estado", ["revision_pendiente", "created", "running"])
      .is("propuesta_id", null);
    await sb.from("emision_locks").delete().eq("job_id", jobId);
  } catch {
    /* best-effort: el folio ya quedó registrado */
  }
}

// ── «Revisé el SII y no salió» ──────────────────────────────────────────────

export const SELLO_NO_SALIO = "Declarado por la persona: revisó el SII y la boleta no salió";
/** status_message de una boleta única sellada a medias por vencer sin respuesta tras el clic. */
export const SELLO_SIN_RESPUESTA = "Sin respuesta: venció después de apretar EMITIR";

/**
 * ¿Este folio del stash prueba que la boleta salió? (rev. adversarial #7) Un folio
 * rechazado por ser de OTRO documento no es de este intento: no puede dejar la lápida
 * sin salida (FOLIO_CAPTURADO para siempre). Todo otro folio (débil, gate fallido,
 * huérfana RCV sin monto, chequeo fallido) sí bloquea.
 */
export function folioBloqueaNoSalio(fila: { folio?: unknown; status?: string | null; error?: string | null }): boolean {
  if (fila.folio == null) return false;
  return !(fila.status === "rejected" && fila.error === "FOLIO_DE_OTRO_DOCUMENTO");
}

type FilaStash = { folio?: unknown; status?: string | null; error?: string | null };

/**
 * La fila del stash que bloquea «no salió», mirando el FOLIO y no fila por fila (rev.
 * adversarial vuelta 2, M1): rememberResult INSERTA, así que un mismo folio deja
 * residuos (job_gate_failed, FOLIO_CHECK_FAILED de un intento anterior) junto a la fila
 * que lo declaró de OTRO documento. Si un folio tiene al menos una fila
 * rejected/FOLIO_DE_OTRO_DOCUMENTO, TODAS sus filas se ignoran: ese número no es de
 * este intento. Cualquier otro folio bloquea.
 */
export function folioQueBloqueaNoSalio<T extends FilaStash>(filas: readonly T[]): T | undefined {
  const ajenos = new Set(filas.filter((f) => f.folio != null && !folioBloqueaNoSalio(f)).map((f) => String(f.folio)));
  return filas.find((f) => f.folio != null && !ajenos.has(String(f.folio)));
}
/** Espera desde el último signo de vida (mismo criterio que la verificación del lote). */
export const NO_SALIO_TRAS_MS = 10 * 60 * 1000;

type JobDeclarable = {
  job_id: string; cuenta_id: string; estado: string; propuesta_id: string | null; created_at: string;
  expires_at?: string | null; updated_at?: string | null; status_message?: string | null;
};

/**
 * Desde cuándo se acepta «no salió»: máx(expires_at, updated_at + 10 min). Si la
 * lápida nació SIN RESPUESTA (sellada al vencer tras el clic), además expires_at +
 * 30 min, igual que el lote (lapida.ts, rev. adversarial #8): pudo seguir viva.
 */
export function plazoDeclararBoletaUnica(job: JobDeclarable): number {
  const exp = job.expires_at ? Date.parse(job.expires_at) : NaN;
  const upd = Date.parse(job.updated_at ?? job.created_at) + NO_SALIO_TRAS_MS;
  const sinResp = (job.status_message ?? "").startsWith(SELLO_SIN_RESPUESTA) && Number.isFinite(exp)
    ? exp + DECLARAR_SIN_RESPUESTA_TRAS_MS
    : -Infinity;
  return Math.max(Number.isFinite(exp) ? exp : -Infinity, Number.isFinite(upd) ? upd : -Infinity, sinResp);
}

/** ¿Este job se cerró por la declaración humana «no salió»? (alerta si después llega su folio). */
export function fueDeclaradoNoSalio(job: { estado?: string | null; status_message?: string | null }): boolean {
  return job.estado === "failed" && (job.status_message ?? "").startsWith(SELLO_NO_SALIO);
}

export type ResultadoDeclaracion =
  | { ok: true }
  | { ok: false; status: number; error: string; detalle: string; desde?: string };

/**
 * "Revisé el SII y no salió" para una boleta única a medias. Mismos controles que el
 * lote (result/route.ts): solo sobre una lápida real, no antes del plazo, nunca si el
 * server ya tiene un folio capturado para ese intento, y el UPDATE re-filtra por
 * estado (si entre medio llegó el folio, no se pisa). Suelta el candado.
 */
export async function declararNoSalioBoletaUnica(sb: Sb, job: JobDeclarable, ahora: Date = new Date()): Promise<ResultadoDeclaracion> {
  if (!esLapidaBoletaUnica(job)) {
    return { ok: false, status: 409, error: "JOB_SIN_LAPIDA", detalle: "Este intento no está a medias." };
  }
  const plazo = plazoDeclararBoletaUnica(job);
  if (ahora.getTime() < plazo) {
    const hora = new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(plazo));
    return {
      ok: false, status: 409, error: "MUY_PRONTO", desde: new Date(plazo).toISOString(),
      detalle: `El SII todavía podría estar procesando esta boleta. Podrás marcar que no salió desde las ${hora}; mientras, búscala en el SII.`,
    };
  }
  const { data: conFolio, error: errRes } = await sb
    .from("sii_local_resultados")
    .select("folio, status, error")
    .eq("job_id", job.job_id)
    .not("folio", "is", null)
    .limit(50);
  if (errRes) return { ok: false, status: 500, error: "RESULTADOS_QUERY_FAILED", detalle: errRes.message };
  const folio = folioQueBloqueaNoSalio((conFolio ?? []) as Array<{ folio?: number; status?: string | null; error?: string | null }>);
  if (folio) {
    return {
      ok: false, status: 409, error: "FOLIO_CAPTURADO",
      detalle: `El SII devolvió el folio ${folio.folio} para este intento: la boleta sí salió. Usa Recuperar para guardarla.`,
    };
  }
  const { data: cerrados, error: errUpd } = await sb
    .from("emision_jobs")
    .update({ estado: "failed", estado_visible: "failed", status_message: SELLO_NO_SALIO, updated_at: ahora.toISOString() })
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
