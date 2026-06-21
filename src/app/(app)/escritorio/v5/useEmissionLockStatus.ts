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
  const [status, setStatus] = useState<EmissionLockStatusResponse | null>(null);
  const [loading, setLoading] = useState(enabled);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/emision/jobs", { cache: "no-store" });
      const json = (await res.json()) as EmissionLockStatusResponse;
      setStatus(res.ok && json.ok ? json : null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function load() {
      if (cancelled) return;
      await refresh();
    }

    setLoading(true);
    void load();
    const timer = window.setInterval(() => { void load(); }, intervalMs);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, intervalMs, refresh]);

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
      lockMessage: FALLBACK_LOCK_MESSAGE,
    };
  }

  const activeLock = source.status?.locked ? source.status.bloqueo ?? null : null;
  const lockedByOther = Boolean(activeLock?.job_id && activeLock.job_id !== currentJobId);
  const businessMode = Boolean(source.status?.business_mode);

  return {
    ...source,
    activeLock,
    businessMode,
    lockedByOther,
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
