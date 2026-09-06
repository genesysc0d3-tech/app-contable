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
