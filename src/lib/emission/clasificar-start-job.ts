// Qué hace el lote con la respuesta de POST /api/emision/jobs (plan-emision-confiable §1.4, 2026-09-28).
//
// Antes todo rechazo que no fuera pausa o "ya emitida" volvía `null` → "fallida" →
// el runner pedía "¿Saltar y seguir?" en CADA boleta. LC 27-sep 23:43: al reanudar,
// su PROPIO candado colgado rebotó cada boleta. Ahora:
//   - candado (propio o ajeno) / emisión en curso → FRENAR el lote una vez, sin
//     consumir la boleta (lo pendiente queda para reanudar), con un motivo honesto;
//   - la boleta ya está a medias / sin respuesta → SALTARLA sin pausa (ya está en
//     A medias, no se re-emite) y seguir con las demás.

export type ClaseStartJob =
  | { tipo: "ok"; jobId: string; expiresAt: string; emisorRut: string | null; foliosHoy: number[] }
  | { tipo: "pausada"; detalle: string }
  | { tipo: "ya_emitida"; folio: number | null; boletaId: string | null; boletaCreatedAt: string | null }
  | { tipo: "frenada"; motivo: string }
  | { tipo: "a_medias" }
  // 429 (12 pedidos/min por usuario): una racha de boletas saltadas sin cadencia lo
  // gatilla. No es una falla de la boleta: se espera y se reintenta.
  | { tipo: "reintentar"; esperaMs: number }
  | { tipo: "error" };

const PAUSA_DEFAULT =
  "Pausamos la emisión por un rato mientras revisamos un cambio en el sitio del SII. Tus documentos quedan listos y no se pierde nada; inténtalo de nuevo más tarde.";

function horaChile(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
}

export function clasificarStartJob(status: number, json: Record<string, unknown> | null | undefined): ClaseStartJob {
  const j = json ?? {};
  if (status === 429) {
    const seg = typeof j.retry_after_seconds === "number" && j.retry_after_seconds > 0 ? j.retry_after_seconds : 10;
    return { tipo: "reintentar", esperaMs: Math.min(seg, 60) * 1000 };
  }
  if (status === 409 && j.code === "EMISION_PAUSADA") {
    return { tipo: "pausada", detalle: typeof j.detalle === "string" && j.detalle.trim() ? j.detalle : PAUSA_DEFAULT };
  }
  if (status === 409 && j.error === "PROPUESTA_YA_EMITIDA") {
    return {
      tipo: "ya_emitida",
      folio: typeof j.folio === "number" ? j.folio : null,
      boletaId: typeof j.boleta_id === "string" ? j.boleta_id : null,
      boletaCreatedAt: typeof j.boleta_created_at === "string" ? j.boleta_created_at : null,
    };
  }
  if (status === 409 && (j.error === "REVISION_PENDIENTE" || j.error === "SIN_RESPUESTA")) {
    return { tipo: "a_medias" };
  }
  if (status === 409 && j.error === "EMISION_BLOQUEADA") {
    const bloqueo = (j.bloqueo ?? null) as { is_mine?: boolean; locked_until?: string; usuario_nombre?: string } | null;
    const hora = horaChile(bloqueo?.locked_until);
    if (bloqueo?.is_mine === false) {
      const quien = typeof bloqueo.usuario_nombre === "string" && bloqueo.usuario_nombre.trim() ? bloqueo.usuario_nombre : "Otra persona";
      return { tipo: "frenada", motivo: `${quien} está emitiendo en esta empresa. Lo que falta queda guardado: sigue cuando termine${hora ? ` (a más tardar a las ${hora})` : ""}.` };
    }
    if (!bloqueo) {
      // El candado venció entre el intento y la consulta: ya no se sabe de quién era.
      return { tipo: "frenada", motivo: "Había otra emisión abierta en esta empresa y ya se liberó. Lo que falta queda guardado: reanuda." };
    }
    return { tipo: "frenada", motivo: `Tu emisión anterior sigue abierta (otra pestaña o una boleta sin respuesta). Se libera sola${hora ? ` a las ${hora}` : " en unos minutos"}; lo que falta queda guardado para seguir.` };
  }
  if (status === 409 && j.error === "EMISION_EN_CURSO") {
    return { tipo: "frenada", motivo: "Esta boleta ya se está emitiendo en otra pestaña. Lo que falta queda guardado para seguir." };
  }
  if (status >= 200 && status < 300 && j.ok && typeof j.job_id === "string" && typeof j.expires_at === "string") {
    return {
      tipo: "ok",
      jobId: j.job_id,
      expiresAt: j.expires_at,
      emisorRut: typeof j.expected_emisor_rut === "string" ? j.expected_emisor_rut : null,
      foliosHoy: Array.isArray(j.folios_hoy) ? (j.folios_hoy as number[]) : [],
    };
  }
  return { tipo: "error" };
}
