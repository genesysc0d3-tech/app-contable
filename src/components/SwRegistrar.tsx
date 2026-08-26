"use client";

import { useEffect } from "react";

/**
 * Registra el Service Worker ("shader cache" de la app) consultando primero el
 * kill-switch remoto (/api/sw-config). También es la capa 2 del kill-switch:
 * si el flag está apagado y hay un SW controlando la página, lo des-registra y
 * purga sus caches DESDE la página (cubre el caso "el SW está tan roto que su
 * propio chequeo no corre").
 * Solo corre en build de producción; en dev el SW ni existe.
 */
export default function SwRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelado = false;
    (async () => {
      try {
        const res = await fetch("/api/sw-config", { cache: "no-store" });
        const cfg = (await res.json()) as { enabled?: boolean };
        if (cancelado) return;

        if (cfg?.enabled) {
          // updateViaCache "none": Chrome re-baja /sw.js en cada navegación →
          // versión nueva = byte-diff = actualización automática.
          await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        } else {
          // Kill-pill (capa 2): apagado remoto ejecutado desde la página.
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys.filter((k) => k.startsWith("massdte-")).map((k) => caches.delete(k)));
          }
        }
      } catch {
        // Sin red o config caída: no registrar es el default seguro.
      }
    })();
    return () => { cancelado = true; };
  }, []);

  return null;
}
