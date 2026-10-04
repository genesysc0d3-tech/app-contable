/**
 * Rastro de BORRADOS de propuestas (Fase 1 medición, punto d): antes de borrar
 * (eliminar documento, deshacer, reproceso, devolver a omitidos) se pide a la base
 * un resumen de lo que se va a ir — SOLO conteos por fuente/estado/tipo/banda — y
 * va a la metadata de la auditoría de la cuenta. Nada de glosas, nombres ni RUT.
 *
 * Best-effort: si la función no existe (migración no aplicada) o falla, devuelve
 * null y el borrado sigue igual. Medir nunca bloquea una acción del cliente.
 */

export type ResumenBorrado = {
  total: number;
  editadas: number;
  sin_foto: number;
  por_fuente: Record<string, number>;
  por_tipo_dte_fuente: Record<string, number>;
  por_estado: Record<string, number>;
  por_tipo_dte: Record<string, number>;
  por_banda_confianza: Record<string, number>;
};

const NUMEROS = ["total", "editadas", "sin_foto"] as const;
const MAPAS = ["por_fuente", "por_tipo_dte_fuente", "por_estado", "por_tipo_dte", "por_banda_confianza"] as const;
/** Claves de los mapas = códigos del sistema. Cualquier otra cosa (texto libre) se bota. */
const CODIGO = /^[a-z0-9_]{1,40}$/;

/** Deja pasar solo la forma esperada (defensa en profundidad contra PII en la auditoría). */
export function sanearResumen(raw: unknown): ResumenBorrado | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out = {} as Record<string, unknown>;
  for (const k of NUMEROS) {
    const n = Number(r[k]);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  for (const k of MAPAS) {
    const m: Record<string, number> = {};
    const v = r[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [clave, n] of Object.entries(v as Record<string, unknown>)) {
        const num = Number(n);
        if (CODIGO.test(clave) && Number.isFinite(num)) m[clave] = num;
      }
    }
    out[k] = m;
  }
  return out as ResumenBorrado;
}

type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function resumenPropuestasABorrar(
  sb: unknown,
  args: { empresaId: string; documentoId?: string | null; propuestaId?: string | null },
): Promise<ResumenBorrado | null> {
  try {
    const cliente = sb as Partial<ClienteRpc>;
    if (typeof cliente?.rpc !== "function") return null;
    const { data, error } = await cliente.rpc("resumen_propuestas_a_borrar", {
      p_empresa_id: args.empresaId,
      p_documento_id: args.documentoId ?? null,
      p_propuesta_id: args.propuestaId ?? null,
    });
    if (error) return null;
    return sanearResumen(data);
  } catch {
    return null;
  }
}
