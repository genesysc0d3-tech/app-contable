// "Verificar y seguir": adoptar el job colgado de una boleta (plan-emision-confiable
// §1.2 + revisión adversarial B1, 2026-09-28).
//
// Caso LC 27-sep 23:37: la boleta 17 quedó con su job `running` sin respuesta de la
// extensión. Hoy ese job es una lápida "sin respuesta" (lapida.ts): bloquea re-emitir,
// pero la única salida era el folio a mano o "No está en el SII". Adoptarlo = abrir un
// job de VERIFICACIÓN (solo lee el Resumen de ventas del SII) sobre la MISMA propuesta,
// con la ventana horaria del intento, sin bajarle la protección al job viejo.
//
// B1 (bloqueante): NUNCA se adopta un job que puede estar vivo. La ventana worker del
// SII sigue trabajando aunque muera la pestaña de la app o el service worker; si la
// verificación lee la tabla ANTES de que ese worker apriete EMITIR, dice "no salió",
// la boleta vuelve a Listas y el worker original emite igual → DOBLE FOLIO. Solo se
// adopta si:
//   (a) el job venció hace ≥ 2 min (`expires_at + 2 min`; el margen cubre el desfase
//       de reloj del cliente y el último clic posible), o
//   (b) la extensión de ESTE navegador confirmó que ese job terminó (la app recibió su
//       estado terminal y le mandó cerrar la ventana worker). Solo lo puede afirmar la
//       misma persona que lanzó el intento (es su navegador el que lo vio).
//
// Puro y sin red: el server (POST /api/emision/jobs y /api/sii-local/result) y la app lo
// usan tal cual; los tests fijan la tabla de verdad.

import { chileDateString } from "@/lib/chile-date";
import { noSalioEsConfiable } from "./fecha-intento";
import { esLapidaEfectiva } from "./lapida";

/** Margen tras el vencimiento antes de poder adoptar (B1). */
export const MARGEN_ADOPCION_MS = 2 * 60 * 1000;
/** Tope de la ventana horaria de la verificación (el worker ya lo recorta a 30 min). */
export const VENTANA_MAX_MS = 30 * 60 * 1000;

/**
 * El job de verificación guarda a QUIÉN adoptó en su `origin` (texto libre, sin
 * migración). Así el server puede validar después el veredicto contra ese enlace, que
 * nació con el job (no lo manda la página al final).
 */
const PREFIJO_ORIGEN = "verificacion_adopta:";
export function origenAdopcion(jobViejoId: string): string {
  return `${PREFIJO_ORIGEN}${jobViejoId}`;
}
export function jobAdoptadoDeOrigen(origin: string | null | undefined): string | null {
  if (typeof origin !== "string" || !origin.startsWith(PREFIJO_ORIGEN)) return null;
  const id = origin.slice(PREFIJO_ORIGEN.length).trim();
  return id.length > 0 ? id : null;
}

export type JobAdoptable = {
  job_id: string;
  estado: string;
  propuesta_id: string | null;
  usuario_id: string;
  cuenta_id: string;
  empresa_id: string;
  created_at: string;
  expires_at: string | null;
};

export type VentanaVerificacion = { desde_ms: number; hasta_ms: number };

export type DecisionAdopcion =
  | {
      ok: true;
      jobViejoId: string;
      ventana: VentanaVerificacion;
      /** Fecha Chile (YYYY-MM-DD) del intento: con ella se calza la fila en /reportes. */
      fechaIntento: string;
      via: "vencido" | "fin_confirmado";
    }
  | {
      ok: false;
      status: 403 | 404 | 409;
      code:
        | "JOB_NO_ENCONTRADO"
        | "JOB_AJENO"
        | "JOB_DE_OTRA_PERSONA"
        | "PROPUESTA_DISTINTA"
        | "NO_ADOPTABLE"
        | "EMISION_EN_CURSO_PROPIA"
        | "OTRO_DIA";
      detalle: string;
      /** Solo en EMISION_EN_CURSO_PROPIA: desde cuándo se podrá verificar (ISO). */
      libreDesde?: string;
    };

export function decidirAdopcion(args: {
  job: JobAdoptable | null;
  /** Quién pide y desde qué cuenta/empresa (la sesión, ya con rol de emisión). */
  userId: string;
  cuentaId: string;
  empresaId: string;
  /** La propuesta que la verificación dice verificar: debe ser la del job viejo. */
  propuestaId: string;
  /** (b) La extensión de este navegador confirmó que el job terminó. */
  finConfirmado?: boolean;
  ahora: Date;
}): DecisionAdopcion {
  const { job, ahora } = args;
  if (!job) return { ok: false, status: 404, code: "JOB_NO_ENCONTRADO", detalle: "No encontramos ese intento de emisión." };
  // Misma cuenta Y misma empresa: nunca se verifica (ni se libera) el intento de otro
  // contribuyente. Con equipo, cualquier persona de la cuenta con rol de emisión puede
  // verificar un intento vencido (si Marge no está, la clienta no queda trabada).
  if (job.cuenta_id !== args.cuentaId || job.empresa_id !== args.empresaId) {
    return { ok: false, status: 403, code: "JOB_AJENO", detalle: "Ese intento es de otra empresa." };
  }
  if (!job.propuesta_id || job.propuesta_id !== args.propuestaId) {
    return { ok: false, status: 409, code: "PROPUESTA_DISTINTA", detalle: "Ese intento no corresponde a esta boleta." };
  }
  if (job.estado !== "created" && job.estado !== "running") {
    // completed = ya registrada; failed/cancelled = ya no protege; revision_pendiente =
    // a medias (la verificación automática no la cierra: folio a mano o "No está").
    return { ok: false, status: 409, code: "NO_ADOPTABLE", detalle: "Este intento ya no está sin respuesta: recarga Emitir." };
  }

  const ahoraMs = ahora.getTime();
  const creadoMs = Date.parse(job.created_at);
  const vence = job.expires_at ? Date.parse(job.expires_at) : NaN;
  let via: "vencido" | "fin_confirmado";
  if (args.finConfirmado === true) {
    // (b) Solo quien lanzó el intento: fue SU navegador el que vio el fin del job.
    if (job.usuario_id !== args.userId) {
      return { ok: false, status: 403, code: "JOB_DE_OTRA_PERSONA", detalle: "Solo quien lanzó esa emisión puede confirmar que terminó." };
    }
    via = "fin_confirmado";
  } else {
    // (a) Vencido hace ≥ 2 min, y lápida efectiva (post-corte, con propuesta).
    const libre = Number.isFinite(vence) ? vence + MARGEN_ADOPCION_MS : NaN;
    if (esLapidaEfectiva(job, ahora) !== "sin_respuesta" || !Number.isFinite(libre) || ahoraMs < libre) {
      const libreDesde = Number.isFinite(libre) ? new Date(libre).toISOString() : undefined;
      return {
        ok: false,
        status: 409,
        code: "EMISION_EN_CURSO_PROPIA",
        detalle: "Esa emisión todavía puede estar trabajando en el SII. Se puede verificar un par de minutos después de que venza.",
        libreDesde,
      };
    }
    via = "vencido";
  }

  // /reportes muestra solo HOY y el calce exige la fecha del intento: un intento de
  // otro día no se puede verificar (queda "No está en el SII" / folio a mano).
  const fechaIntento = chileDateString(new Date(creadoMs));
  if (fechaIntento !== chileDateString(ahora)) {
    return { ok: false, status: 409, code: "OTRO_DIA", detalle: "Ese intento es de otro día: el SII solo deja revisar lo de hoy. Búscalo tú en el SII y registra su folio, o márcalo como que no está." };
  }

  const hasta = Math.min(Number.isFinite(vence) ? vence : ahoraMs, ahoraMs);
  const desde = Math.max(creadoMs, hasta - VENTANA_MAX_MS);
  return { ok: true, jobViejoId: job.job_id, ventana: { desde_ms: desde, hasta_ms: hasta }, fechaIntento, via };
}

/** Lo que la extensión contestó a la verificación (traducido por la app). */
export type DesenlaceVerificacion = "emitida" | "no_salio" | "revisar";

/**
 * Veredicto que ve la clienta. "No salió" SOLO si la tabla lo dijo y además todo
 * ocurrió el mismo día Chile (guarda de medianoche, fecha-intento.ts); cualquier
 * otra cosa queda a medias (nunca re-emitible a ciegas).
 */
export function interpretarVerificacion(args: {
  desenlace: DesenlaceVerificacion;
  fechaIntento: string;
  ventana: VentanaVerificacion;
  ahoraMs: number;
}): "emitida" | "no_salio" | "a_medias" {
  if (args.desenlace === "emitida") return "emitida";
  if (args.desenlace === "no_salio" && noSalioEsConfiable({
    fechaIntento: args.fechaIntento,
    desdeMs: args.ventana.desde_ms,
    hastaMs: args.ventana.hasta_ms,
    ahoraMs: args.ahoraMs,
  })) return "no_salio";
  return "a_medias";
}

export type JobVerificacion = {
  job_id: string;
  estado: string;
  origin: string | null;
  propuesta_id: string | null;
  usuario_id: string;
  cuenta_id: string;
  empresa_id: string;
  created_at: string;
  expires_at: string | null;
};

/**
 * ¿Puede el server bajar el job viejo a `failed` con el veredicto "no salió"?
 * Todo se juzga con filas de la base (el enlace vive en el `origin` del job de
 * verificación, escrito al adoptarlo), no con lo que diga la página:
 *  - el job de verificación es de quien lo reporta, sigue abierto y adoptó a ESE job;
 *  - misma propuesta, cuenta y empresa;
 *  - el job viejo sigue abierto (created/running): si ya se registró o se selló, no se toca;
 *  - intento, ventana y veredicto el MISMO día Chile (guarda de medianoche).
 */
export function validarVeredictoNoSalio(args: {
  verificacion: JobVerificacion | null;
  viejo: JobAdoptable | null;
  userId: string;
  ahora: Date;
}): { ok: true } | { ok: false; code: string; detalle: string } {
  const v = args.verificacion;
  if (!v) return { ok: false, code: "JOB_NO_ENCONTRADO", detalle: "No encontramos esa verificación." };
  const adoptado = jobAdoptadoDeOrigen(v.origin);
  if (!adoptado) return { ok: false, code: "NO_ES_VERIFICACION", detalle: "Ese job no es una verificación de un intento anterior." };
  if (v.usuario_id !== args.userId) return { ok: false, code: "JOB_DE_OTRA_PERSONA", detalle: "Esa verificación la lanzó otra persona." };
  if (v.estado !== "created" && v.estado !== "running") return { ok: false, code: "VERIFICACION_CERRADA", detalle: "Esa verificación ya se cerró." };
  const vence = v.expires_at ? Date.parse(v.expires_at) : NaN;
  if (!Number.isFinite(vence) || vence <= args.ahora.getTime()) return { ok: false, code: "VERIFICACION_VENCIDA", detalle: "Esa verificación ya venció." };
  const o = args.viejo;
  if (!o || o.job_id !== adoptado) return { ok: false, code: "JOB_NO_ENCONTRADO", detalle: "No encontramos el intento que se verificó." };
  if (!v.propuesta_id || o.propuesta_id !== v.propuesta_id || o.cuenta_id !== v.cuenta_id || o.empresa_id !== v.empresa_id) {
    return { ok: false, code: "PROPUESTA_DISTINTA", detalle: "La verificación no corresponde a ese intento." };
  }
  if (o.estado !== "created" && o.estado !== "running") return { ok: false, code: "NADA_QUE_CERRAR", detalle: "Ese intento ya cambió de estado." };
  const creado = Date.parse(o.created_at);
  const viejoVence = o.expires_at ? Date.parse(o.expires_at) : NaN;
  const hasta = Math.min(Number.isFinite(viejoVence) ? viejoVence : Date.parse(v.created_at), Date.parse(v.created_at));
  const fechaIntento = chileDateString(new Date(creado));
  if (!noSalioEsConfiable({ fechaIntento, desdeMs: creado, hastaMs: hasta, ahoraMs: args.ahora.getTime() })) {
    return { ok: false, code: "OTRO_DIA", detalle: "El intento y la verificación no son del mismo día: no se puede confirmar que no salió." };
  }
  return { ok: true };
}

/**
 * ¿Se ofrece "Verificar en el SII" para un ítem de A medias? Solo boletas (39/41)
 * SIN RESPUESTA de HOY (/reportes muestra solo hoy; las de otro día quedan con folio a
 * mano / "No está en el SII"). Devuelve "no" (no se muestra), "ya" (botón activo) o
 * desde cuándo (vencido hace < 2 min: aún puede estar trabajando, B1).
 */
export function verificableEnAMedias(
  it: { motivo: "a_medias" | "sin_respuesta"; tipo_dte: number | null; lapida_at: string; expires_at: string | null },
  ahora: Date,
): "no" | "ya" | { desdeMs: number } {
  if (it.motivo !== "sin_respuesta") return "no";
  if (it.tipo_dte !== 39 && it.tipo_dte !== 41) return "no";
  const creado = Date.parse(it.lapida_at);
  const vence = it.expires_at ? Date.parse(it.expires_at) : NaN;
  if (!Number.isFinite(creado) || !Number.isFinite(vence)) return "no";
  if (chileDateString(new Date(creado)) !== chileDateString(ahora)) return "no";
  const desdeMs = vence + MARGEN_ADOPCION_MS;
  return ahora.getTime() >= desdeMs ? "ya" : { desdeMs };
}
