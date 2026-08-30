"use strict";

// Portal de FACTURAS (Sistema de Facturación Gratuito del SII, tipos 33/34).
// El hermano de sii-local.js (e-Boleta): mismo esqueleto de validación
// fail-closed, contrato propio. El worker de este portal es facturas-worker.js
// (HTML clásico multi-página, no el Vuetify de e-Boleta).

import { isRutValido } from "./rut.js";
import { isAllowedSiiUrl } from "./sii-local.js";

export const FACT_CAPABILITIES = [
  "sii_portal_factura_33",
  "sii_portal_factura_34",
];

// Compuerta de fase: encendida 2026-08-26 con el fillAndEmit construido
// contra el page-map real (docs/facturas-portal-page-map.md). Sigue inerte
// para la flota por triple candado: la 0.2.0 no está publicada (la flota
// 0.1.8 no trae este código), la app gatea por capabilities del PONG, y
// facturas_emision_proveedor sigue 'mock' en toda empresa hasta el flip
// por empresa de la fase 5.
export const FACT_AUTO_EMIT_READY = true;

/**
 * Divide un RUT en {cuerpo, dv} para las DOS cajas del portal
 * (EFXP_RUT_RECEP + EFXP_DV_RECEP). Acepta puntos y guion; DV a mayúscula.
 * null si no es parseable — el caller aborta (fail-closed), nunca adivina.
 */
export function splitRutCuerpoDv(rut) {
  const limpio = String(rut ?? "").replace(/\./g, "").replace(/\s/g, "").toUpperCase();
  const m = limpio.match(/^(\d{1,8})-?([\dK])$/);
  if (!m) return null;
  return { cuerpo: m[1], dv: m[2] };
}

/**
 * Extrae el folio del texto de la página post-Firmar, con la MISMA doctrina
 * de evidencia fuerte de boletas: solo un match explícito con la palabra
 * folio (o el encabezado del documento) da confianza alta. Sin match → null
 * (jamás inventar un número suelto).
 */
export function extractFolioFromText(text) {
  const t = String(text ?? "");
  const patrones = [
    /folio\s*(?:n(?:ro)?\.?\s*[°ºo]?\s*)?[:#]?\s*(\d{1,10})/i,
    /n[°ºo]\s*folio\s*[:#]?\s*(\d{1,10})/i,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m) {
      const folio = Number(m[1]);
      if (Number.isSafeInteger(folio) && folio > 0) {
        return { folio, matched_text: m[0].slice(0, 60) };
      }
    }
  }
  return null;
}

export function validateSiiFacturaJob(job) {
  if (!job || typeof job !== "object") return "JOB_INVALID";
  if (job.kind !== "factura") return "JOB_KIND_INVALID";
  if (!job.job_id || typeof job.job_id !== "string") return "JOB_ID_MISSING";
  if (job.tipo_dte !== 33 && job.tipo_dte !== 34) return "TIPO_DTE_INVALID";
  if (!job.expires_at || Number.isNaN(Date.parse(job.expires_at))) return "EXPIRES_AT_INVALID";
  if (Date.parse(job.expires_at) <= Date.now()) return "JOB_EXPIRED";
  if (job.learn_only !== true && job.auto_emit !== true) return "AUTO_EMIT_OR_LEARN_ONLY_REQUIRED";
  // A diferencia de boletas, el emisor_rut se exige TAMBIÉN en learn: la sesión
  // de aprendizaje navega un portal con emisores reales seleccionables y no
  // debe correr sin saber bajo qué empresa está parada.
  if (!isRutValido(job.emisor_rut)) return "EMISOR_RUT_INVALID";
  // start_url viaja en el job (un cambio de URL del SII se arregla con deploy
  // de la app, sin pasar por Chrome Web Store) pero SOLO puede apuntar a sii.cl.
  if (!isAllowedSiiUrl(job.start_url)) return "START_URL_INVALID";

  if (job.auto_emit === true) {
    if (job.forma_pago !== "contado" && job.forma_pago !== "credito") return "FORMA_PAGO_INVALID";
    if (!job.receptor || typeof job.receptor !== "object") return "RECEPTOR_MISSING";
    if (!isRutValido(job.receptor.rut)) return "RECEPTOR_RUT_INVALID";
    const total = Number(job.totales?.monto_total);
    if (!Number.isFinite(total) || total <= 0) return "MONTO_TOTAL_INVALID";
    const detalle = Array.isArray(job.detalles) ? job.detalles[0] : null;
    if (!detalle || typeof detalle.nombre !== "string" || !detalle.nombre.trim()) return "DETALLE_MISSING";
    const precio = Number(detalle.precio);
    if (!Number.isFinite(precio) || precio <= 0) return "PRECIO_INVALID";
  }
  return null;
}

// Vocabulario CERRADO de nombres de campo que el libreto puede nombrar. Un
// libreto (que viene del servidor) SOLO puede apuntar a campos del formulario
// de facturas del SII — jamás a un selector arbitrario. Esto acota qué puede
// tocar el worker si algún día bajara un libreto malformado o manipulado.
const LIBRETO_CAMPO_RE = /^(?:EFXP_[A-Z0-9_]+|RUT_EMP|PTDC_CODIGO|DESCRIP_01|Button_Update|btnSign)$/;
const LIBRETO_FORMS = ["preview", "formulario", "selector_empresa"];
const LIBRETO_CAMPOS = [
  "emisor_select", "tipo_verif", "rut_recep", "dv_recep", "razon_soc_recep",
  "dir_recep", "comuna_recep", "ciudad_recep", "giro_recep", "contacto",
  "comuna_origen", "ciudad_origen", "razon_soc_emisor", "giro_emisor",
  "fecha_emision", "forma_pago", "detalle_nombre", "detalle_cantidad",
  "detalle_precio", "glosa_checkbox", "glosa_textarea", "monto_total",
  "boton_validar", "boton_firmar",
];
const LIBRETO_DETECTORES = ["login", "firma", "exito_a", "exito_b"];
const LIBRETO_SCHEMA_VERSION = 1;

/**
 * Validación fail-closed del LIBRETO (el catálogo de nombres del portal que
 * viaja en el job — ver src/lib/emission/sii-libreto.ts).
 *
 * AUSENTE = válido: el worker usa su fallback hardcodeado y la conducta es
 * byte-idéntica. Pero si el libreto viene PRESENTE, tiene que estar bien
 * formado: un libreto malformado que dirige en qué campo escribe el worker es
 * peor que ninguno (podría emitir un DTE con datos en el lugar equivocado), así
 * que ante cualquier duda se rechaza el job entero antes de abrir la ventana.
 */
export function validateLibreto(libreto) {
  if (libreto == null) return null; // ausente = fallback hardcodeado, OK
  if (typeof libreto !== "object") return "LIBRETO_INVALID";
  if (libreto.libreto_version !== LIBRETO_SCHEMA_VERSION) return "LIBRETO_SCHEMA_UNKNOWN";
  if (libreto.portal !== "sii_facturas_gratuito") return "LIBRETO_PORTAL_INVALID";

  const noVacio = (v) => typeof v === "string" && v.trim().length > 0;

  if (!libreto.forms || typeof libreto.forms !== "object") return "LIBRETO_FORMS_MISSING";
  for (const k of LIBRETO_FORMS) {
    if (!noVacio(libreto.forms[k])) return "LIBRETO_FORM_MISSING";
  }
  if (!libreto.detectores || typeof libreto.detectores !== "object") return "LIBRETO_DETECTORES_MISSING";
  for (const k of LIBRETO_DETECTORES) {
    if (!noVacio(libreto.detectores[k])) return "LIBRETO_DETECTOR_MISSING";
  }
  if (!libreto.campos || typeof libreto.campos !== "object") return "LIBRETO_CAMPOS_MISSING";
  for (const k of LIBRETO_CAMPOS) {
    const name = libreto.campos[k];
    if (!noVacio(name)) return "LIBRETO_CAMPO_MISSING";
    if (!LIBRETO_CAMPO_RE.test(name)) return "LIBRETO_CAMPO_NO_PERMITIDO";
  }
  const fp = libreto.codigos?.forma_pago;
  if (!fp || !noVacio(fp.contado) || !noVacio(fp.credito)) return "LIBRETO_CODIGO_MISSING";
  return null;
}
