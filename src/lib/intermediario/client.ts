/**
 * Cliente "intermediario" — capa que emula un proveedor externo tipo
 * Haulmer/OpenFactura. La app nunca habla directo con el SII: habla con este
 * cliente, y el cliente a su vez habla con el SII mock.
 *
 * Cuando se integre con un intermediario real (Haulmer, OpenFactura, etc.),
 * basta reemplazar las implementaciones de `enviarDTE` y `consultarEstado`
 * por fetches HTTP a su API pública. La firma del cliente queda estable.
 */

import {
  recibirDTE,
  consultarEstadoDTE,
  mapEstadoSiiAPersistencia,
  type EstadoDTESII,
} from "@/lib/sii-mock/recepcion";

export interface EnvioResultado {
  ok: boolean;
  track_id?: string;
  estado_sii?: EstadoDTESII;
  estado_persistencia?: "aceptado" | "aceptado_reparos" | "rechazado";
  mensaje?: string;
  codigo_rechazo?: string;
  detalle?: string;
}

/**
 * Envía un DTE (XML) al SII a través del intermediario. En el mock actual,
 * llamamos directo al módulo de recepción; en producción sería un fetch al
 * API del intermediario real.
 */
export async function enviarDTE(xml_dte: string): Promise<EnvioResultado> {
  const r = recibirDTE(xml_dte);
  if (!r.ok) {
    return {
      ok: false,
      codigo_rechazo: r.codigo_rechazo,
      detalle: r.detalle,
      mensaje: r.error,
    };
  }
  return {
    ok: true,
    track_id: r.track_id,
    estado_sii: r.estado,
    estado_persistencia: mapEstadoSiiAPersistencia(r.estado),
    mensaje: r.mensaje,
  };
}

export interface EstadoResultado {
  ok: boolean;
  track_id: string;
  estado_sii: EstadoDTESII;
  estado_persistencia: "aceptado" | "aceptado_reparos" | "rechazado";
  glosa: string;
}

/**
 * Consulta el estado posterior de un DTE (el intermediario hace polling al
 * SII hasta que confirma aceptación).
 */
export async function consultarEstado(track_id: string): Promise<EstadoResultado> {
  const r = consultarEstadoDTE(track_id);
  return {
    ok: r.ok,
    track_id: r.track_id,
    estado_sii: r.estado,
    estado_persistencia: mapEstadoSiiAPersistencia(r.estado),
    glosa: r.glosa,
  };
}
