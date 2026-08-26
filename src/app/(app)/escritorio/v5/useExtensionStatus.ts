"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EXTENSION_VERSION_ACTUAL, extensionDesactualizada, mensajeExtensionDesactualizada } from "@/lib/extension";

export type ExtensionStatus = "checking" | "ready" | "missing";

/**
 * Chequeo puntual (fuera de React) para los gates de emisión: ping → PONG con
 * versión. Resuelve { ok } o { ok:false, motivo } con copy humano listo.
 * Sin extensión también es ok:false (cada gate decide su propio mensaje de
 * "falta la extensión"; acá el motivo cubre AMBOS casos con texto usable).
 */
export function verificarExtensionCompatible(
  /**
   * Capabilities que ESTE flujo exige además del piso de versión (ej. el carril
   * de facturas pide "sii_portal_factura_33"). El piso global NO sube por una
   * capacidad nueva: una extensión vieja sigue emitiendo boletas; solo el flujo
   * que necesita la capacidad frena, con instrucción clara de actualizar.
   */
  requiredCapabilities?: string[],
): Promise<{ ok: boolean; motivo?: string }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve({ ok: false, motivo: "Sin navegador." });
    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve({ ok: false, motivo: "No encuentro la extensión del SII en este navegador. Instálala o actívala para emitir." });
    }, 1200);
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as { source?: string; type?: string; nonce?: string; extension_version?: string; capabilities?: string[] };
      if (data?.source !== "app-contable-extension" || data.type !== "APP_CONTABLE_EXTENSION_PONG" || data.nonce !== nonce) return;
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
      if (extensionDesactualizada(data.extension_version)) {
        resolve({ ok: false, motivo: mensajeExtensionDesactualizada(data.extension_version) });
        return;
      }
      if (requiredCapabilities?.length) {
        const tiene = new Set(Array.isArray(data.capabilities) ? data.capabilities : []);
        const faltan = requiredCapabilities.filter((c) => !tiene.has(c));
        if (faltan.length > 0) {
          resolve({
            ok: false,
            motivo:
              "Este flujo necesita una versión más nueva de la extensión MassDTE. Chrome la actualiza solo en unas horas; para forzarla al tiro: chrome://extensions → Modo desarrollador → Actualizar.",
          });
          return;
        }
      }
      resolve({ ok: true });
    }
    window.addEventListener("message", onMessage);
    window.postMessage(
      // ultima_version: la extensión 0.1.7+ solo le pide update a Google si está
      // POR DEBAJO de esto — al día = cero llamadas (idea del fundador).
      { source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce, ultima_version: EXTENSION_VERSION_ACTUAL },
      window.location.origin,
    );
  });
}

/**
 * Detecta si la extensión "App Contable Motor Local" está instalada, con el MISMO
 * protocolo ping/pong que ya usa EmissionProviderConfig (fuente probada): la app
 * postea APP_CONTABLE_EXTENSION_PING con un nonce; si la extensión está, el bridge
 * responde APP_CONTABLE_EXTENSION_PONG con ese nonce. Sin respuesta en 1200ms = falta.
 *
 * `recheck()` vuelve a "checking" y re-lanza el ping (botón "Actualizar" tras instalar).
 */
export function useExtensionStatus(): { status: ExtensionStatus; version: string | null; desactualizada: boolean; recheck: () => void } {
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
      // ultima_version: la extensión 0.1.7+ solo le pide update a Google si está
      // POR DEBAJO de esto — al día = cero llamadas (idea del fundador).
      { source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce, ultima_version: EXTENSION_VERSION_ACTUAL },
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
    // no esté "ready", re-preguntamos cada 2,5s el primer minuto (instalación recién
    // hecha se detecta al tiro) y después cada 15s (perf: quien no tiene la extensión
    // no necesita 24 pings por minuto para siempre). Al volver a la pestaña
    // (visibilitychange) se re-pregunta de inmediato — el momento típico post-install.
    let pollTimer: number | null = null;
    const pollStart = Date.now();
    function scheduleNextPing() {
      const delay = Date.now() - pollStart < 60000 ? 2500 : 15000;
      pollTimer = window.setTimeout(() => {
        if (statusRef.current !== "ready") postPing();
        scheduleNextPing();
      }, delay);
    }
    scheduleNextPing();
    const onVisible = () => {
      if (document.visibilityState === "visible" && statusRef.current !== "ready") postPing();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (pingRef.current) window.clearTimeout(pingRef.current.timeoutId);
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("message", onMessage);
    };
  }, [postPing]);

  return { status, version, desactualizada: status === "ready" && extensionDesactualizada(version), recheck };
}
