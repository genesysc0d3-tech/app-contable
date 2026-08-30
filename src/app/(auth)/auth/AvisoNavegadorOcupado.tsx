"use client";

import { useEffect, useState } from "react";

/**
 * Aviso NO bloqueante en el registro: si la extensión MassDTE reporta que este
 * navegador YA tiene una bóveda del SII (otra cuenta), crear una segunda cuenta
 * acá es legítimo pero no va a poder emitir — un navegador guarda una sola clave
 * (es lo que hace segura la bóveda). Se explica antes de que la persona se
 * estrelle contra VAULT_OTHER_USER, con las salidas reales.
 *
 * El dato viene del PONG (`has_vault`): SOLO un booleano, nunca de quién es la
 * bóveda. Sin extensión o sin bóveda → no se muestra nada.
 */
export default function AvisoNavegadorOcupado() {
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    let settled = false;

    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as { source?: string; type?: string; nonce?: string; has_vault?: boolean };
      if (data?.source !== "app-contable-extension" || data.type !== "APP_CONTABLE_EXTENSION_PONG" || data.nonce !== nonce) return;
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
      setOcupado(data.has_vault === true);
    }

    // Sin respuesta en 1500ms = sin extensión: no se muestra nada.
    const timeoutId = window.setTimeout(() => {
      settled = true;
      window.removeEventListener("message", onMessage);
    }, 1500);

    window.addEventListener("message", onMessage);
    window.postMessage(
      { source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce },
      window.location.origin,
    );

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  if (!ocupado) return null;

  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-relaxed">
      <p className="font-medium text-white/85">En este navegador ya hay una cuenta conectada al SII.</p>
      <p className="mt-1 text-white/55">
        Puedes crear otra cuenta, pero por seguridad cada navegador guarda una sola clave del SII: la segunda no
        podrá emitir desde aquí. Para operar las dos, ábrela en otro navegador o en otro perfil de Chrome, o junta
        tus empresas en un plan Business.
      </p>
    </div>
  );
}
