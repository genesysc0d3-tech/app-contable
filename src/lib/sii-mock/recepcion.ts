/**
 * Mock del SII: recepción y consulta de estado de DTE.
 *
 * En producción real el SII recibe el XML firmado por web service
 * (`RecibirDTE` de EnvioBoleta), asigna un track_id y después el contribuyente
 * consulta estado con `getEstDte`. Este módulo simula ese contrato sin
 * conectarse al SII real — devuelve ACEPTADO inmediato si la estructura
 * mínima del XML está presente.
 *
 * Se expone como función pura (no endpoint) para que la cadena
 * intermediario → SII pueda llamarla in-process sin hacer fetch a otro
 * handler en el mismo proceso (evita complejidad de URL absoluta en
 * serverless y elimina latencia innecesaria).
 */

import { generarTrackId } from "@/lib/sii/dte-xml";

export type EstadoDTESII = "ACEPTADO" | "ACEPTADO_CON_REPAROS" | "RECHAZADO";

export interface RecepcionOK {
  ok: true;
  track_id: string;
  estado: EstadoDTESII;
  mensaje: string;
  fecha_recepcion: string;
}

export interface RecepcionError {
  ok: false;
  error: string;
  codigo_rechazo?: string;
  detalle?: string;
}

const CHECKS = [
  { tag: "<TipoDTE>", code: "FALTA_TIPO_DTE" },
  { tag: "<Folio>", code: "FALTA_FOLIO" },
  { tag: "<RUTEmisor>", code: "FALTA_RUT_EMISOR" },
  { tag: "<MntTotal>", code: "FALTA_MONTO_TOTAL" },
  { tag: "<TED ", code: "FALTA_TED" },
  { tag: "<Signature ", code: "FALTA_FIRMA" },
];

export function recibirDTE(xml_dte: string): RecepcionOK | RecepcionError {
  if (!xml_dte || typeof xml_dte !== "string") {
    return { ok: false, error: "XML_REQUERIDO" };
  }

  const missing = CHECKS.filter((c) => !xml_dte.includes(c.tag));
  if (missing.length > 0) {
    return {
      ok: false,
      error: "XML_INVALIDO",
      codigo_rechazo: missing[0]!.code,
      detalle: missing.map((m) => m.code).join(", "),
    };
  }

  return {
    ok: true,
    track_id: generarTrackId(),
    estado: "ACEPTADO",
    mensaje: "DTE recibido y aceptado por el SII (mock)",
    fecha_recepcion: new Date().toISOString(),
  };
}

/**
 * Mock de `getEstDte`: consulta el estado de un DTE ya recibido.
 * En producción real acá se haría un lookup en la base de datos del SII;
 * acá solo respondemos ACEPTADO para cualquier track_id con formato válido.
 */
export function consultarEstadoDTE(track_id: string): {
  ok: boolean;
  track_id: string;
  estado: EstadoDTESII;
  glosa: string;
} {
  const esValido = /^\d{10}$/.test(track_id);
  if (!esValido) {
    return {
      ok: false,
      track_id,
      estado: "RECHAZADO",
      glosa: "Track ID con formato inválido (mock)",
    };
  }
  return {
    ok: true,
    track_id,
    estado: "ACEPTADO",
    glosa: "DTE aceptado sin reparos (mock)",
  };
}

/**
 * Mapea estado SII (uppercase) al enum usado en la tabla boletas_emitidas.
 */
export function mapEstadoSiiAPersistencia(
  estado: EstadoDTESII,
): "aceptado" | "aceptado_reparos" | "rechazado" {
  switch (estado) {
    case "ACEPTADO":
      return "aceptado";
    case "ACEPTADO_CON_REPAROS":
      return "aceptado_reparos";
    case "RECHAZADO":
      return "rechazado";
  }
}
