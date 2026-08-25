"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export interface EmissionLockInfo {
  job_id?: string | null;
  provider?: string | null;
  locked_until?: string | null;
  heartbeat_at?: string | null;
  estado_visible?: string | null;
  is_mine?: boolean;
  usuario_nombre?: string | null;
  mensaje?: string | null;
}

export interface EmissionLockStatusResponse {
  ok?: boolean;
  locked?: boolean;
  business_mode?: boolean;
  bloqueo?: EmissionLockInfo | null;
  error?: string;
  detalle?: string;
}

interface EmissionLockSource {
  status: EmissionLockStatusResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setStatus: Dispatch<SetStateAction<EmissionLockStatusResponse | null>>;
}

interface EmissionLockState extends EmissionLockSource {
  activeLock: EmissionLockInfo | null;
  businessMode: boolean;
  lockedByOther: boolean;
  // Bloqueo REAL: otra PERSONA (otra pestaña/compañero) está emitiendo. Tu propio job
  // colgado (is_mine) NO cuenta como bloqueo — no debe encerrarte de tu cuenta; se
  // cancela en un click. Solo esto debe deshabilitar el botón Emitir.
  lockedByOtherUser: boolean;
  // Tu propio candado quedó pegado de un job anterior (no el actual en vuelo): ofrecer
  // cancelarlo para volver a emitir sin esperar el TTL.
  myStaleLock: boolean;
  lockMessage: string;
}

const EmissionLockContext = createContext<EmissionLockSource | null>(null);
const FALLBACK_LOCK_MESSAGE = "Hay una emisión en curso para esta cuenta. Intenta nuevamente cuando termine.";

function useEmissionLockPolling(options: {
  enabled?: boolean;
  intervalMs?: number;
} = {}): EmissionLockSource {
  const enabled = options.enabled ?? true;
  const intervalMs = options.intervalMs ?? 5000;
  // Perf: cadencia adaptativa. Cuando el estado IMPORTA en vivo (cuenta Business
  // con equipo, o hay un candado activo) se sondea al ritmo pedido (5s). En reposo
  // (cuenta sola, sin emisión) se baja a 30s + refresh inmediato al volver el foco
  // — que es exactamente el momento en que un candado de otra pestaña se vuelve
  // visible para el usuario. Nadie pierde el aviso; solo desaparece el ruido.
  const idleIntervalMs = Math.max(intervalMs, 30000);
  const [status, setStatus] = useState<EmissionLockStatusResponse | null>(null);
  const [loading, setLoading] = useState(enabled);

  // Bail por igualdad: la respuesta suele ser idéntica tick a tick; sin esto cada
  // sondeo re-renderizaba a todos los consumidores del context aunque nada cambiara.
  const aplicarStatus = useCallback((next: EmissionLockStatusResponse | null) => {
    setStatus(prev => {
      if (prev === next) return prev;
      if (prev && next && JSON.stringify(prev) === JSON.stringify(next)) return prev;
      return next;
    });
    return next;
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) {
      aplicarStatus(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/emision/jobs", { cache: "no-store" });
      const json = (await res.json()) as EmissionLockStatusResponse;
      aplicarStatus(res.ok && json.ok ? json : null);
    } catch {
      aplicarStatus(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, aplicarStatus]);

  useEffect(() => {
    if (!enabled) {
      aplicarStatus(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    async function load() {
      if (cancelled) return;
      let vivo = false;
      try {
        const res = await fetch("/api/emision/jobs", { cache: "no-store" });
        const json = (await res.json()) as EmissionLockStatusResponse;
        const next = res.ok && json.ok ? json : null;
        aplicarStatus(next);
        vivo = Boolean(next?.business_mode || next?.locked);
      } catch {
        aplicarStatus(null);
      } finally {
        setLoading(false);
      }
      if (cancelled) return;
      if (timer !== null) window.clearTimeout(timer); // colapsa cadenas si un focus se cruzó con un load en vuelo
      timer = window.setTimeout(() => { void load(); }, vivo ? intervalMs : idleIntervalMs);
    }

    setLoading(true);
    void load();
    const onFocus = () => {
      if (timer !== null) window.clearTimeout(timer);
      void load();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, intervalMs, idleIntervalMs, aplicarStatus]);

  return useMemo(() => ({
    status,
    loading,
    refresh,
    setStatus,
  }), [loading, refresh, status]);
}

function deriveEmissionLockState(source: EmissionLockSource, enabled: boolean, currentJobId: string | null): EmissionLockState {
  if (!enabled) {
    return {
      ...source,
      status: null,
      loading: false,
      activeLock: null,
      businessMode: false,
      lockedByOther: false,
      lockedByOtherUser: false,
      myStaleLock: false,
      lockMessage: FALLBACK_LOCK_MESSAGE,
    };
  }

  const activeLock = source.status?.locked ? source.status.bloqueo ?? null : null;
  const lockedByOther = Boolean(activeLock?.job_id && activeLock.job_id !== currentJobId);
  // Otro USUARIO emitiendo (is_mine === false): único bloqueo legítimo del botón.
  const lockedByOtherUser = Boolean(activeLock && activeLock.is_mine === false);
  // Mi propio candado pegado de un job anterior (no el actual): cancelable en un click.
  const myStaleLock = Boolean(activeLock && activeLock.is_mine !== false && activeLock.job_id && activeLock.job_id !== currentJobId);
  const businessMode = Boolean(source.status?.business_mode);

  return {
    ...source,
    activeLock,
    businessMode,
    lockedByOther,
    lockedByOtherUser,
    myStaleLock,
    lockMessage: activeLock?.mensaje ?? FALLBACK_LOCK_MESSAGE,
  };
}

export function EmissionLockProvider({ children, enabled = true, intervalMs = 5000 }: {
  children: ReactNode;
  enabled?: boolean;
  intervalMs?: number;
}) {
  const value = useEmissionLockPolling({ enabled, intervalMs });
  return createElement(EmissionLockContext.Provider, { value }, children);
}

export function useEmissionLockStatus(options: {
  enabled?: boolean;
  currentJobId?: string | null;
  intervalMs?: number;
} = {}): EmissionLockState {
  const context = useContext(EmissionLockContext);
  const enabled = options.enabled ?? true;
  const local = useEmissionLockPolling({ enabled: !context && enabled, intervalMs: options.intervalMs });
  const source = context ?? local;
  const currentJobId = options.currentJobId ?? null;

  return useMemo(
    () => deriveEmissionLockState(source, enabled, currentJobId),
    [currentJobId, enabled, source],
  );
}
