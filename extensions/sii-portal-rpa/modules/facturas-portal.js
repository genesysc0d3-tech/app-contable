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

// Compuerta de fase: el fillAndEmit del portal de facturas se construye contra
// los page-maps de la sesión learn en vivo. Hasta que exista, un job auto_emit
// se rechaza ACÁ (fail-closed) y las FACT_CAPABILITIES no se anuncian en el
// PONG — la app jamás ve un carril que no puede terminar.
export const FACT_AUTO_EMIT_READY = false;

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
