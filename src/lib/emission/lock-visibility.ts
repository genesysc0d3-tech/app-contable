export interface ActiveEmissionLock {
  job_id: string;
  provider: string;
  locked_until: string;
  heartbeat_at: string;
  usuario_id: string;
  estado_visible?: string | null;
}

export interface EmissionLockUser {
  nombre?: string | null;
  email?: string | null;
}

export interface VisibleEmissionLock {
  job_id: string;
  provider: string;
  locked_until: string;
  heartbeat_at: string;
  estado_visible?: string | null;
  is_mine: boolean;
  usuario_nombre?: string;
  mensaje: string;
}

function cleanText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function horaChile(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("es-CL", { timeZone: "America/Santiago", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));
}

export function genericEmissionLockMessage() {
  return "Hay una emision en curso para esta cuenta. Intenta nuevamente cuando termine.";
}

export function buildVisibleEmissionLock(args: {
  lock: ActiveEmissionLock;
  businessMode: boolean;
  currentUserId: string;
  usuario?: EmissionLockUser | null;
  /** Boletas que ese mismo usuario ya sacó en esta tanda (jobs completados
   *  recientes). Un gris largo y mudo es un ticket de soporte: con dueño y
   *  avance se entiende (Team Business fase 4, 2026-09-06). */
  avance?: number | null;
}): VisibleEmissionLock {
  const base = {
    job_id: args.lock.job_id,
    provider: args.lock.provider,
    locked_until: args.lock.locked_until,
    heartbeat_at: args.lock.heartbeat_at,
    estado_visible: args.lock.estado_visible ?? null,
    is_mine: args.lock.usuario_id === args.currentUserId,
  };

  // El candado es TUYO (caso LC 27-sep: cuenta de 1 persona con plan business veía
  // "Equipo: LC SERVICES está emitiendo desde su computador"): nunca "Equipo", nunca
  // tu propio nombre como si fuera otra persona. Dice qué es y cuándo se libera.
  if (base.is_mine) {
    const hora = horaChile(args.lock.locked_until);
    return {
      ...base,
      mensaje: `Tu emisión anterior sigue abierta (otra pestaña o una boleta sin respuesta). Se libera sola${hora ? ` a las ${hora}` : " en unos minutos"}.`,
    };
  }

  if (!args.businessMode) {
    return {
      ...base,
      mensaje: genericEmissionLockMessage(),
    };
  }

  const nombre = cleanText(args.usuario?.nombre) ?? cleanText(args.usuario?.email) ?? "Otra persona";
  const avance = typeof args.avance === "number" && args.avance > 0 ? args.avance : 0;
  const tanda = avance > 0 ? ` · ${avance} boleta${avance === 1 ? " ya salio" : "s ya salieron"} en esta tanda` : "";
  return {
    ...base,
    usuario_nombre: nombre,
    mensaje: `${nombre} esta emitiendo desde su computador${tanda}. Puedes seguir revisando, pero la emision esta bloqueada hasta que termine.`,
  };
}
