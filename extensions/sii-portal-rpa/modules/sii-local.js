"use strict";

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
  return null;
}
