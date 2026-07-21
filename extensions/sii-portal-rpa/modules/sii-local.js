"use strict";

import { isRutValido } from "./rut.js";

export const SII_START_URL = "https://eboleta.sii.cl/emitir/";

export const SII_CAPABILITIES = [
  "sii_portal_boleta_39",
  "sii_portal_boleta_41",
  "dedicated_worker_window",
  "learn_only",
  "auto_emit",
  "sii_autologin_optional",
  "result_capture",
  "pdf_byte_capture",
];

export function isAllowedSiiUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /(^|\.)sii\.cl$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

export function validateSiiBoletaJob(job) {
  if (!job || typeof job !== "object") return "JOB_INVALID";
  if (!job.job_id || typeof job.job_id !== "string") return "JOB_ID_MISSING";
  if (job.tipo_dte !== 39 && job.tipo_dte !== 41) return "TIPO_DTE_INVALID";
  if (!job.expires_at || Number.isNaN(Date.parse(job.expires_at))) return "EXPIRES_AT_INVALID";
  if (Date.parse(job.expires_at) <= Date.now()) return "JOB_EXPIRED";
  if (job.learn_only !== true && job.auto_emit !== true) return "AUTO_EMIT_OR_LEARN_ONLY_REQUIRED";
  // Emisión real: exigir RUT de empresa emisora VÁLIDO (DV módulo 11). Sin él no se
  // puede garantizar por cuál empresa se emite → no abrir la ventana worker. learn_only
  // no emite, así que no lo exige.
  if (job.auto_emit === true && !isRutValido(job.emisor_rut)) return "EMISOR_RUT_INVALID";
  return null;
}
