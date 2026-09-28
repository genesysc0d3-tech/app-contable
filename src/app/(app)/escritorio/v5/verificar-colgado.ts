"use client";

// "Verificar y seguir" (plan-emision-confiable §1.2 + B1, 2026-09-28): verifica en el
// Resumen de ventas del SII un intento de boleta que quedó sin respuesta, ADOPTANDO su
// job en el server (adopcion.ts). Nunca emite: la extensión 0.2.8 abre /reportes con
// `verify_only` y calza por monto + fecha + ventana horaria del intento.
//
// La usan tres lugares: la pestaña A medias ("Verificar en el SII"), la barra de
// "Emisión abierta" ("Verificar y seguir") y el cuadre por evento del lote
// (useEmisionLote 4b, con `finConfirmado`). El resultado es UNA línea para la clienta.

import { buildBoletaJob } from "@/lib/emission/boleta-job-payload";
import { interpretarVerificacion, type DesenlaceVerificacion, type VentanaVerificacion } from "@/lib/emission/adopcion";

export type ResultadoVerificacion =
  /** Salió: el server registró la boleta con su folio (y levantó la lápida). */
  | { estado: "emitida"; folio: number | null; boletaId: string | null; linea: string }
  /** Ya estaba registrada antes de verificar. `boletaCreatedAt` para juzgar si es la de este intento. */
  | { estado: "ya_emitida"; folio: number | null; boletaId: string | null; boletaCreatedAt: string | null; linea: string }
  /** No salió, confirmado por el server: la boleta volvió a Listas. */
  | { estado: "no_salio"; linea: string }
  /** No se pudo concluir: queda a medias (folio a mano o "No está en el SII"). */
  | { estado: "a_medias"; jobIdRevision: string | null; linea: string }
  /** No se abrió la verificación (muy pronto, otro día, candado, extensión…): nada cambió. */
  | { estado: "no_se_pudo"; code: string | null; linea: string };

const origin = () => window.location.origin;
const TIMEOUT_MS = 180_000;

type ExtMsg = {
  source?: string;
  type?: string;
  job_id?: string | null;
  status?: string;
  message?: string;
  verificado_sin_folio?: boolean;
  result?: {
    folio?: number | string;
    folio_confidence?: string;
    persisted?: { ok?: boolean; boleta_id?: string };
  };
};

/**
 * Traduce UN mensaje de la extensión sobre el job de verificación. null = no terminal
 * (seguir esperando). Puro: lo fija el test.
 */
export function desenlaceDeMensaje(data: ExtMsg): { d: DesenlaceVerificacion; folio?: number | null; boletaId?: string | null; texto?: string } | null {
  if (data.type === "APP_CONTABLE_SII_JOB_RESULT") {
    const folioNum = Number(data.result?.folio);
    const folio = Number.isFinite(folioNum) && folioNum > 0 ? folioNum : null;
    const ok = data.result?.folio_confidence === "high" && data.result?.persisted?.ok === true && folio != null;
    return ok ? { d: "emitida", folio, boletaId: data.result?.persisted?.boleta_id ?? null } : { d: "revisar", texto: data.message };
  }
  if (data.type !== "APP_CONTABLE_SII_JOB_STATUS") return null;
  const st = data.status ?? "";
  if (st === "error" || st === "cancelled" || st === "closed") {
    // Solo "tabla completa leída y la boleta no está" es un no salió; cerrar la
    // ventana, no poder abrir /reportes, red caída → no se sabe (a medias).
    return data.verificado_sin_folio === true ? { d: "no_salio" } : { d: "revisar", texto: data.message };
  }
  if (st === "result_needs_review" || st === "extension_recargada") return { d: "revisar", texto: data.message };
  return null;
}

async function cerrarJob(jobId: string, estado: "revision_pendiente", motivo: string) {
  try {
    await fetch("/api/emision/jobs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId, estado, status_message: motivo.slice(0, 500) }),
    });
  } catch { /* el job vence solo y sigue siendo lápida */ }
}

function horaChile(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
}

export async function verificarJobColgado(args: {
  jobViejoId: string;
  propuestaId: string;
  tipoDte: 39 | 41;
  monto: number;
  empresaId: string;
  empresaRut?: string | null;
  /** Solo el lote (4b): la extensión de ESTE navegador cerró ese job. */
  finConfirmado?: boolean;
  reportar?: (s: string) => void;
}): Promise<ResultadoVerificacion> {
  const reportar = args.reportar ?? (() => {});
  reportar("Revisando en el Resumen de ventas del SII si la boleta salió…");

  // 1. Adoptar en el server (vencido ≥ 2 min o fin confirmado; ver adopcion.ts).
  let json: Record<string, unknown> = {};
  let status = 0;
  try {
    const res = await fetch("/api/emision/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "sii_local",
        tipo_dte: args.tipoDte,
        origin: "verificacion_lote",
        propuesta_id: args.propuestaId,
        adopta_job_id: args.jobViejoId,
        fin_confirmado: args.finConfirmado === true,
        expected_emisor_rut: args.empresaRut ?? null,
      }),
    });
    status = res.status;
    json = await res.json().catch(() => ({}));
  } catch {
    return { estado: "no_se_pudo", code: null, linea: "No pude conectarme para verificarla. Reintenta en un momento." };
  }
  if (status === 409 && json.error === "PROPUESTA_YA_EMITIDA") {
    const folio = typeof json.folio === "number" ? json.folio : null;
    return {
      estado: "ya_emitida",
      folio,
      boletaId: typeof json.boleta_id === "string" ? json.boleta_id : null,
      boletaCreatedAt: typeof json.boleta_created_at === "string" ? json.boleta_created_at : null,
      linea: folio != null ? `Esa boleta ya está registrada con el folio ${folio}.` : "Esa boleta ya está registrada.",
    };
  }
  const adopcion = json.adopcion as { ventana?: VentanaVerificacion; fecha_intento?: string } | null | undefined;
  if (status < 200 || status >= 300 || json.ok !== true || typeof json.job_id !== "string" || !adopcion?.ventana || !adopcion.fecha_intento) {
    const code = typeof json.error === "string" ? json.error : null;
    const hora = horaChile(typeof json.libre_desde === "string" ? json.libre_desde : null);
    const linea = code === "EMISION_EN_CURSO_PROPIA"
      ? `Esa boleta todavía puede estar saliendo en el SII. Podrás verificarla${hora ? ` desde las ${hora}` : " en unos minutos"}.`
      : code === "EMISION_PAUSADA"
        ? String(json.detalle ?? "La emisión está en pausa. Reintenta más tarde.")
        : typeof json.detalle === "string" && json.detalle.trim() ? json.detalle : "No pude abrir la verificación. Reintenta en un momento.";
    return { estado: "no_se_pudo", code, linea };
  }
  const vJobId = json.job_id;
  const ventana = adopcion.ventana;
  const fechaIntento = adopcion.fecha_intento;
  const expiresAt = typeof json.expires_at === "string" ? json.expires_at : undefined;

  // 2. Pedir a la extensión SOLO la lectura del Resumen (verify_only: jamás emite).
  const payload = buildBoletaJob({
    empresaId: args.empresaId,
    emisorRut: (typeof json.expected_emisor_rut === "string" ? json.expected_emisor_rut : null) ?? args.empresaRut ?? undefined,
    foliosHoy: Array.isArray(json.folios_hoy) ? (json.folios_hoy as number[]) : [],
    tipoDte: args.tipoDte,
    monto: args.monto,
    fechaEmision: fechaIntento,
    receptor: {},
    // Sin glosa: la verificación no escribe nada (y la descripción del movimiento puede
    // traer datos de terceros).
    detalle: "",
    logoutAfter: false,
    jobId: vJobId,
    expiresAt,
    verifyOnly: true,
    verifyWindow: ventana,
  });

  const r = await new Promise<{ d: DesenlaceVerificacion; folio?: number | null; boletaId?: string | null; texto?: string }>((resolve) => {
    let settled = false;
    const finish = (x: { d: DesenlaceVerificacion; folio?: number | null; boletaId?: string | null; texto?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(to);
      window.removeEventListener("message", onMsg);
      resolve(x);
    };
    function onMsg(event: MessageEvent) {
      if (event.origin !== origin()) return;
      const data = event.data as ExtMsg;
      if (data?.source !== "app-contable-extension" || (data.job_id ?? null) !== vJobId) return;
      const x = desenlaceDeMensaje(data);
      if (x) finish(x);
      else if (data.type === "APP_CONTABLE_SII_JOB_STATUS" && data.message) reportar(data.message);
    }
    window.addEventListener("message", onMsg);
    // Sin extensión (o < 0.2.8, que se frena sin emitir): no hay veredicto → a medias.
    const to = setTimeout(() => finish({ d: "revisar", texto: "La verificación no respondió a tiempo." }), TIMEOUT_MS);
    window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_BOLETA_JOB", protocol_version: 1, job: payload }, origin());
  });
  window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_JOB_CLOSE", protocol_version: 1, job_id: vJobId }, origin());

  // 3. Veredicto (una línea).
  const veredicto = interpretarVerificacion({ desenlace: r.d, fechaIntento, ventana, ahoraMs: Date.now() });
  if (veredicto === "emitida") {
    return { estado: "emitida", folio: r.folio ?? null, boletaId: r.boletaId ?? null, linea: `Salió en el SII con el folio ${r.folio}. Ya está en Boletas.` };
  }
  if (veredicto === "no_salio") {
    // El server valida el veredicto contra sus filas y recién ahí baja la lápida.
    try {
      const res = await fetch("/api/sii-local/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: vJobId, veredicto_verificacion: "no_salio" }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.ok) return { estado: "no_salio", linea: "No salió en el SII: vuelve a Listas para emitirla." };
      if (j?.error === "PROPUESTA_YA_EMITIDA" && typeof j.folio === "number") {
        return { estado: "ya_emitida", folio: j.folio, boletaId: null, boletaCreatedAt: null, linea: `Esa boleta ya está registrada con el folio ${j.folio}.` };
      }
    } catch { /* cae a a medias */ }
  }
  // Cualquier otra cosa: a medias (nunca re-emitible a ciegas).
  const motivo = r.d === "no_salio"
    ? "No la encontré en el SII, pero no pude confirmarlo del todo (otro día u otro dato). Quedó a medias."
    : "No pude confirmar en el SII si salió. Quedó a medias.";
  await cerrarJob(vJobId, "revision_pendiente", motivo);
  return { estado: "a_medias", jobIdRevision: vJobId, linea: `${motivo} Búscala en el SII y escribe su folio, o márcala como que no está.` };
}
