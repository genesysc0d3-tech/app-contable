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
  const libretoErr = validateLibretoBoleta(job.libreto);
  if (libretoErr) return libretoErr;
  return null;
}

// Whitelist: un selector del libreto SOLO puede nombrar clases Vuetify conocidas
// del portal e-Boleta o roles ARIA — jamás un selector arbitrario (inyectar
// [onclick], iframes, o algo fuera del modal). Cada token separado por coma se
// valida por separado.
// Una o más clases `.v-…` encadenadas (compuestos como `.v-dialog.v-dialog--active`),
// o un rol ARIA acotado, o `label`. `.v-…` cubre `--` y `__` en cualquier orden,
// pero SIEMPRE debe empezar por `.v-` — nada de selectores arbitrarios.
const VUETIFY_TOKEN_RE = /^(?:(?:\.v-[a-z0-9_-]+)+|\[role='(?:option|button|switch)'\]|label)$/;
const esSelectorPermitido = (sel) =>
  typeof sel === "string" && sel.trim().length > 0 &&
  sel.split(",").every((tok) => VUETIFY_TOKEN_RE.test(tok.trim()));

const BOLETA_LIBRETO_SCHEMA_VERSION = 1;
const LIB_SELECTORES = ["dialogo_activo", "slot", "menu", "opcion", "toggle_row", "toggle_click", "emisor_selecciones", "emisor_select", "input_container"];
const LIB_SLOTS = ["sucursal", "tipo", "tipo_afecta", "tipo_exenta", "metodo_pago", "metodo_pago_alt", "metodo_pago_default"];
const LIB_TOGGLES = ["detalle", "receptor"];
const LIB_RECEPTOR = ["rut", "nombre", "direccion", "email", "telefono"];

/**
 * Validación fail-closed del libreto de BOLETAS (catálogo de nombres del portal
 * e-Boleta — ver src/lib/emission/sii-libreto.ts BOLETA_LIBRETO). AUSENTE =
 * válido (el worker usa fallback hardcodeado → byte-idéntico). PRESENTE = tiene
 * que estar bien formado; un libreto malformado que dirige clicks es peor que
 * ninguno, así que se rechaza el job entero antes de abrir la ventana.
 */
export function validateLibretoBoleta(libreto) {
  if (libreto == null) return null; // ausente = fallback, OK
  if (typeof libreto !== "object") return "LIBRETO_INVALID";
  if (libreto.libreto_version !== BOLETA_LIBRETO_SCHEMA_VERSION) return "LIBRETO_SCHEMA_UNKNOWN";
  if (libreto.portal !== "eboleta_vuetify") return "LIBRETO_PORTAL_INVALID";

  const noVacio = (v) => typeof v === "string" && v.trim().length > 0;

  if (!libreto.selectores || typeof libreto.selectores !== "object") return "LIBRETO_SELECTORES_MISSING";
  for (const k of LIB_SELECTORES) {
    if (!esSelectorPermitido(libreto.selectores[k])) return "LIBRETO_SELECTOR_NO_PERMITIDO";
  }
  if (!libreto.slots || typeof libreto.slots !== "object") return "LIBRETO_SLOTS_MISSING";
  for (const k of LIB_SLOTS) if (!noVacio(libreto.slots[k])) return "LIBRETO_SLOT_MISSING";
  if (!libreto.toggles || typeof libreto.toggles !== "object") return "LIBRETO_TOGGLES_MISSING";
  for (const k of LIB_TOGGLES) if (!noVacio(libreto.toggles[k])) return "LIBRETO_TOGGLE_MISSING";
  if (!libreto.receptor_campos || typeof libreto.receptor_campos !== "object") return "LIBRETO_RECEPTOR_MISSING";
  for (const k of LIB_RECEPTOR) if (!noVacio(libreto.receptor_campos[k])) return "LIBRETO_RECEPTOR_CAMPO_MISSING";
  const b = libreto.botones;
  if (!b || !noVacio(b.emitir)) return "LIBRETO_BOTON_MISSING";
  if (!Array.isArray(b.limpiar_pad) || b.limpiar_pad.length === 0 || !b.limpiar_pad.every(noVacio)) return "LIBRETO_BOTON_LISTA_INVALID";
  return null;
}
