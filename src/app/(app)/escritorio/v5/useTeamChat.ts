"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { enviarMensajeTeam, marcarLeidosTeam, mensajesTeam, type TeamMensaje, type TeamObjeto } from "./actions";

export { COLORES_TEAM, colorDeMiembro } from "./team-colores";

const POLL_MS = 20_000;

/**
 * Mensajes del team: se cargan al montar, cada 20 s y al volver el foco a la
 * pestaña. Patrón de la casa: Realtime ya falló en silencio en prod, y un
 * chat cuya entrega depende de él repite ese bug. Si el poll falla, no pasa
 * nada visible — se reintenta en el siguiente tick.
 */
export function useTeamChat(enabled: boolean, usuarioId: string | null) {
  const [mensajes, setMensajes] = useState<TeamMensaje[]>([]);
  const [cargado, setCargado] = useState(false);
  const enVuelo = useRef(false);

  const refrescar = useCallback(async () => {
    if (!enabled || enVuelo.current) return;
    enVuelo.current = true;
    try {
      const r = await mensajesTeam();
      if (r.ok) { setMensajes(r.mensajes); setCargado(true); }
    } finally {
      enVuelo.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refrescar();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void refrescar(); }, POLL_MS);
    const onFocus = () => { void refrescar(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, refrescar]);

  // No leídos POR remitente: alimenta los satélites.
  const noLeidosPor = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of mensajes) {
      if (x.para === usuarioId && x.de && !x.leidoAt) m.set(x.de, (m.get(x.de) ?? 0) + 1);
    }
    return m;
  }, [mensajes, usuarioId]);
  const noLeidos = useMemo(() => Array.from(noLeidosPor.values()).reduce((a, b) => a + b, 0), [noLeidosPor]);

  const conversacion = useCallback((con: string) => mensajes.filter((m) => (m.de === usuarioId && m.para === con) || (m.de === con && m.para === usuarioId)), [mensajes, usuarioId]);

  const enviar = useCallback(async (para: string, texto: string, objeto: TeamObjeto | null) => {
    const r = await enviarMensajeTeam({ para, texto, objeto });
    if (r.ok) setMensajes((prev) => [...prev, r.mensaje]);
    return r;
  }, []);

  // Cazado en la prueba real (2026-09-06): el "¿había no leídos?" se decidía
  // DENTRO del updater de setState, que React corre después — así que el
  // servidor nunca se enteraba y el mensaje quedaba sin leer para siempre.
  // Se decide con la lista actual (ref), antes de tocar el estado.
  const mensajesRef = useRef<TeamMensaje[]>([]);
  useEffect(() => { mensajesRef.current = mensajes; }, [mensajes]);

  const leer = useCallback((de: string) => {
    const habia = mensajesRef.current.some((m) => m.de === de && m.para === usuarioId && !m.leidoAt);
    if (!habia) return;
    const ahora = new Date().toISOString();
    setMensajes((prev) => prev.map((m) => (m.de === de && m.para === usuarioId && !m.leidoAt ? { ...m, leidoAt: ahora } : m)));
    void marcarLeidosTeam(de);
  }, [usuarioId]);

  return { mensajes, cargado, noLeidosPor, noLeidos, conversacion, enviar, leer, refrescar };
}
