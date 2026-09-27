/**
 * Pregunta a la clienta cuando la lectura del comprobante quedó AMBIGUA (plan del
 * flujo, PR 7a/8; decisión del fundador 2026-09-27: "si no está seguro, que
 * aclare el cliente"). Siempre pregunta CERRADA con botones — nunca texto libre,
 * que es por donde se colaría una inyección. Nada se emite solo: la respuesta
 * crea el movimiento igual que una lectura segura y sigue al Check.
 *
 * callback_data (≤ 64 bytes): "ac:m:<i>:<doc>" monto i-ésimo · "ac:e:<doc>"
 * me llegó · "ac:s:<doc>" la pagué · "ac:x:<doc>" no corresponde.
 */
import type { Aclaracion } from "@/lib/lectura/comprobante";
import type { InlineKeyboardMarkup } from "./api";

export type AclaracionGuardada = Aclaracion & { mesa?: "boleta" | "factura" };

export type RespuestaAclaracion =
  | { tipo: "monto"; indice: number; documentoId: string }
  | { tipo: "direccion"; tipo_flujo: "entrada" | "salida"; documentoId: string }
  | { tipo: "descartar"; documentoId: string };

const pesos = (n: number) => `$${n.toLocaleString("es-CL")}`;

/** ¿Se le puede preguntar algo útil? (monto con opciones, o solo la dirección). */
export function sePuedePreguntar(a: Aclaracion | undefined): a is Aclaracion {
  if (!a || a.pendientes.length === 0) return false;
  if (a.pendientes[0] === "monto") return a.opcionesMonto.length >= 1;
  return a.pendientes[0] === "direccion" && a.monto != null;
}

export function preguntaAclaracion(a: Aclaracion, documentoId: string): { texto: string; teclado: InlineKeyboardMarkup } {
  const descartar = [{ text: "No es una transferencia mía", callback_data: `ac:x:${documentoId}` }];
  if (a.pendientes[0] === "monto") {
    return {
      texto: "🤔 En este comprobante veo más de un monto. <b>¿Cuál fue el de la transferencia?</b>",
      teclado: {
        inline_keyboard: [
          a.opcionesMonto.map((m, i) => ({ text: pesos(m), callback_data: `ac:m:${i}:${documentoId}` })),
          descartar,
        ],
      },
    };
  }
  return {
    texto: `🤔 No me queda claro: estos <b>${pesos(a.monto ?? 0)}</b>, <b>¿te llegaron o los pagaste tú?</b>`,
    teclado: {
      inline_keyboard: [
        [
          { text: "Me llegó", callback_data: `ac:e:${documentoId}` },
          { text: "La pagué yo", callback_data: `ac:s:${documentoId}` },
        ],
        descartar,
      ],
    },
  };
}

export function leerCallbackAclaracion(data: string): RespuestaAclaracion | null {
  const m = data.match(/^ac:m:(\d):([0-9a-f-]{36})$/);
  if (m) return { tipo: "monto", indice: Number(m[1]), documentoId: m[2] };
  const d = data.match(/^ac:([esx]):([0-9a-f-]{36})$/);
  if (!d) return null;
  if (d[1] === "x") return { tipo: "descartar", documentoId: d[2] };
  return { tipo: "direccion", tipo_flujo: d[1] === "e" ? "entrada" : "salida", documentoId: d[2] };
}

/**
 * Aplica la respuesta a lo guardado: fija el monto o la dirección y lo saca de
 * pendientes. Devuelve la aclaración actualizada (si quedan pendientes, se hace
 * la siguiente pregunta).
 */
export function aplicarRespuesta(a: AclaracionGuardada, r: RespuestaAclaracion): AclaracionGuardada | null {
  if (r.tipo === "monto") {
    const monto = a.opcionesMonto[r.indice];
    if (monto == null || a.pendientes[0] !== "monto") return null;
    return { ...a, monto, pendientes: a.pendientes.filter((p) => p !== "monto") };
  }
  if (r.tipo === "direccion") {
    if (!a.pendientes.includes("direccion")) return null;
    // La dirección la dice ELLA: cuenta como identidad (confianza plena).
    return { ...a, tipo_flujo: r.tipo_flujo, direccionPorIdentidad: true, pendientes: a.pendientes.filter((p) => p !== "direccion") };
  }
  return null;
}
