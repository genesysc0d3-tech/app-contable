"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ExtensionStatus = "checking" | "ready" | "missing";

/**
 * Detecta si la extensión "App Contable Motor Local" está instalada, con el MISMO
 * protocolo ping/pong que ya usa EmissionProviderConfig (fuente probada): la app
 * postea APP_CONTABLE_EXTENSION_PING con un nonce; si la extensión está, el bridge
 * responde APP_CONTABLE_EXTENSION_PONG con ese nonce. Sin respuesta en 1200ms = falta.
 *
 * `recheck()` vuelve a "checking" y re-lanza el ping (botón "Actualizar" tras instalar).
 */
export function useExtensionStatus(): { status: ExtensionStatus; version: string | null; recheck: () => void } {
  const [status, setStatus] = useState<ExtensionStatus>("checking");
  const [version, setVersion] = useState<string | null>(null);
  const pingRef = useRef<{ nonce: string; timeoutId: number } | null>(null);
  // Espejo de `status` para leerlo dentro del intervalo de polling sin recrear el effect.
  const statusRef = useRef<ExtensionStatus>("checking");

  // Solo postea el ping + arma el timeout (que puede pasar a "missing"). NO hace un
  // setState SÍNCRONO, así se puede invocar desde el effect de montaje sin violar
  // react-hooks/set-state-in-effect (el estado inicial ya es "checking").
  const postPing = useCallback(() => {
    if (typeof window === "undefined") return;
    if (pingRef.current) window.clearTimeout(pingRef.current.timeoutId);
    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    const timeoutId = window.setTimeout(
      () => setStatus((current) => (current === "checking" ? "missing" : current)),
      1200,
    );
    pingRef.current = { nonce, timeoutId };
    window.postMessage(
      { source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce },
      window.location.origin,
    );
  }, []);

  const recheck = useCallback(() => {
    setStatus("checking");
    postPing();
  }, [postPing]);

  // Espejo de `status` en un ref para leerlo dentro del intervalo sin recrear el effect.
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as { source?: string; type?: string; nonce?: string; extension_version?: string };
      if (data?.source !== "app-contable-extension") return;
      if (data.type === "APP_CONTABLE_EXTENSION_PONG" && pingRef.current && data.nonce === pingRef.current.nonce) {
        window.clearTimeout(pingRef.current.timeoutId);
        setStatus("ready");
        setVersion(data.extension_version ?? null);
      }
    }
    window.addEventListener("message", onMessage);
    postPing();
    // Re-chequeo automático: al instalar la extensión, Chrome NO inyecta el puente en
    // las pestañas ya abiertas, así que puede aparecer DESPUÉS del primer ping. Mientras
    // no esté "ready", re-preguntamos cada 2,5s → apenas el puente existe (por el reload
    // post-install de la extensión o una navegación), la app pasa SOLA a "conectada",
    // sin que el usuario tenga que apretar "Actualizar".
    const pollId = window.setInterval(() => {
      if (statusRef.current !== "ready") postPing();
    }, 2500);
    return () => {
      if (pingRef.current) window.clearTimeout(pingRef.current.timeoutId);
      window.clearInterval(pollId);
      window.removeEventListener("message", onMessage);
    };
  }, [postPing]);

  return { status, version, recheck };
}
