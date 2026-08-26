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
