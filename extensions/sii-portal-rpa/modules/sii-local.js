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

// Tanda 2: bloques OPCIONALES del libreto (glosa/modal/emisor/monto_alto/esperas) y
// cinturones sobre los datos que pueden emitir MAL aunque el libreto esté "bien formado".
// Un regex del libreto tiene que compilar con "i", ser corto, sin cuantificadores
// anidados (ReDoS sobre el innerText del modal) ni backreferences.
const esRegexPermitido = (src) => {
  if (typeof src !== "string" || src.length === 0 || src.length > 200) return false;
  // (…+)+ / (…*)* / (…+)* / (…*)+ / (…+){n,}: grupo con cuantificador, re-cuantificado.
  if (/\([^()]*[+*][^()]*\)[+*{]/.test(src)) return false;
  // backreferences \1..\9 y \k<nombre> (tras quitar barras escapadas).
  if (/\\[1-9]|\\k</.test(src.replace(/\\\\/g, ""))) return false;
  let re;
  try { re = new RegExp(src, "i"); } catch { return false; }
  // W4 (tanda 3), mismo guard universal que isDetectorSeguro (facturas): un regex que
  // acepta "" o "x" matchea CUALQUIER control → receptor_campos.rut = "." escribía el
  // RUT del cliente en el primer input del modal (la glosa).
  if (re.test("") || re.test("x")) return false;
  return true;
};
// Selectores de la glosa: SOLO estos tokens (el worker los usa en querySelectorAll y
// closest dentro del modal; nada arbitrario).
const GLOSA_TOKENS = new Set(["input[type='text']", "textarea", ".v-select", ".v-autocomplete", "input"]);
const esSelectorGlosaPermitido = (sel) =>
  typeof sel === "string" && sel.trim().length > 0 &&
  sel.split(",").every((tok) => GLOSA_TOKENS.has(tok.trim()));
const mayus = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
const BOTONES_VETADOS = new Set(["SI", "NO", "ACEPTAR", "CANCELAR"]);
const LIB_ESPERAS = ["modal_emision", "emisor_estable", "emisores_listos", "emit_habilitado", "glosa_aparece", "glosa_escribe", "pad_post"];
const esEsperaOk = (v) => Number.isInteger(v) && v >= 50 && v <= 60000;

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
  // Los campos del receptor son regex (el worker los compila con "i"): tienen que compilar.
  for (const k of LIB_RECEPTOR) if (!esRegexPermitido(libreto.receptor_campos[k])) return "LIBRETO_REGEX_INVALIDO";
  const b = libreto.botones;
  if (!b || !noVacio(b.emitir)) return "LIBRETO_BOTON_MISSING";
  if (!Array.isArray(b.limpiar_pad) || b.limpiar_pad.length === 0 || !b.limpiar_pad.every(noVacio)) return "LIBRETO_BOTON_LISTA_INVALID";

  // ── Cinturones tanda 2 (sobre claves que YA eran obligatorias) ──────────────────
  // El EMITIR no puede ser un botón de confirmación (SI/NO/ACEPTAR/CANCELAR) ni un
  // dígito del pad: con eso el worker apretaría otra cosa en una boleta real.
  if (BOTONES_VETADOS.has(mayus(b.emitir)) || /^\d+$/.test(mayus(b.emitir))) return "LIBRETO_BOTON_NO_PERMITIDO";
  // W5 (tanda 3): la denylist no basta — "FIRMAR", "GUARDAR" o "ANULAR" pasaban y el
  // worker apretaba eso como si fuera el EMITIR. El botón tiene que decir EMIT…
  if (!mayus(b.emitir).includes("EMIT")) return "LIBRETO_BOTON_NO_PERMITIDO";
  // limpiar_pad: letras, espacios o símbolos de teclado (C, CE, AC, BORRAR, ⌫, ←),
  // 1–12 chars, SIN dígitos y nunca el EMITIR — ["1"] tecleaba un dígito de más →
  // boleta REAL por 10×. W7 (tanda 3): se relajó de `^[A-Z]{1,6}$` para aceptar el
  // símbolo de borrar del portal sin abrir la puerta a dígitos.
  for (const t of b.limpiar_pad) {
    const s = String(t).trim();
    if (s.length < 1 || s.length > 12 || /\d/.test(s) || !/^[\p{L}\p{P}\p{S}\p{Zs}]+$/u.test(s) || mayus(s) === mayus(b.emitir)) return "LIBRETO_PAD_NO_PERMITIDO";
  }
  // Afecta/exenta: distintos, y SOLO la exenta dice "EXENTA" — permutados, el worker
  // confirmaba contra el mismo texto y sacaba una 41 como 39 real.
  const afecta = mayus(libreto.slots.tipo_afecta);
  const exenta = mayus(libreto.slots.tipo_exenta);
  if (afecta === exenta || afecta.includes("EXENTA") || !exenta.includes("EXENTA")) return "LIBRETO_TIPO_AMBIGUO";

  // ── Bloques OPCIONALES tanda 2 (ausentes = fallback del worker) ────────────────
  const regexOpcional = (obj, keys) => {
    if (obj == null) return null;
    if (typeof obj !== "object") return "LIBRETO_REGEX_INVALIDO";
    for (const k of keys) if (obj[k] != null && !esRegexPermitido(obj[k])) return "LIBRETO_REGEX_INVALIDO";
    return null;
  };
  const g = libreto.glosa;
  if (g != null) {
    if (typeof g !== "object") return "LIBRETO_SELECTOR_NO_PERMITIDO";
    for (const k of ["candidatos", "excluir_dentro_de"]) if (g[k] != null && !esSelectorGlosaPermitido(g[k])) return "LIBRETO_SELECTOR_NO_PERMITIDO";
    const err = regexOpcional(g, ["ancla_contador", "ancla_label", "excluir_texto"]);
    if (err) return err;
  }
  for (const [bloque, keys] of [["modal", ["titulo"]], ["emisor", ["cargando"]], ["monto_alto", ["texto"]]]) {
    const err = regexOpcional(libreto[bloque], keys);
    if (err) return err;
  }
  const e = libreto.esperas;
  if (e != null) {
    if (typeof e !== "object") return "LIBRETO_ESPERA_INVALIDA";
    for (const k of LIB_ESPERAS) if (e[k] != null && !esEsperaOk(e[k])) return "LIBRETO_ESPERA_INVALIDA";
  }
  return null;
}
