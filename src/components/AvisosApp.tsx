"use client";

// AVISOS Y NOVEDADES dentro de la app (2026-10-01).
//
//  - Llegan SIN pedidos extra: el layout los trae en su render (iniciales) y la
//    mesa los suma en cada respuesta de /api/mesa (lib/avisos/bus.ts). Cero sondeo.
//  - Cola de a UNO (lib/avisos/cola.ts): urgentes primero.
//  - NUNCA encima de una emisión, una subida, un popup con cambios sin guardar o
//    alguien escribiendo: reusa el "momento seguro" de la actualización invisible
//    (lib/actualizacion/ocupado.ts). Si está ocupado, espera (timer LOCAL, sin red)
//    y reintenta apenas se suelta un bloqueo.
//  - Visto UNA vez por persona: al cerrar se inserta en avisos_vistos directo
//    contra Supabase con el token de la clienta (RLS: solo lo suyo). No pasa por Vercel.
//
// Formatos: toast (abajo a la derecha, 8 s o ✕), tarjeta (esquina, "Entendido";
// para novedades de esta versión) y popup (modal centrado, SOLO urgentes).

import { useCallback, useEffect, useRef, useState } from "react";
import { AvisoVista } from "@/components/AvisoVista";
import { supabase } from "@/lib/supabase";
import { alLiberarBloqueo, bloqueosActivos, motivoOcupado } from "@/lib/actualizacion/ocupado";
import { ATRIBUTO_RESTAURANDO } from "@/lib/actualizacion/estado-guardado";
import { crearColaAvisos, guardarVistoLocal, leerVistosLocales } from "@/lib/avisos/cola";
import { escucharAvisos } from "@/lib/avisos/bus";
import { mesaDeUbicacion, type AvisoApp } from "@/lib/avisos/reglas";
import { versionPestana } from "@/lib/avisos/version";

const REINTENTO_OCUPADO_MS = 3_000;
const PAUSA_ENTRE_AVISOS_MS = 700;

function storageSeguro(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

async function marcarVistoEnSupabase(avisoId: string, userId: string): Promise<void> {
  // ignoreDuplicates = ON CONFLICT DO NOTHING: cerrar en dos computadores no choca.
  await supabase.from("avisos_vistos").upsert({ aviso_id: avisoId, user_id: userId }, { onConflict: "aviso_id,user_id", ignoreDuplicates: true });
}

export default function AvisosApp({ iniciales, userId }: { iniciales: AvisoApp[]; userId: string }) {
  const [actual, setActual] = useState<AvisoApp | null>(null);
  const recibirRef = useRef<(avisos: AvisoApp[]) => void>(() => {});
  const cerrarRef = useRef<(id: string) => void>(() => {});
  const inicialesRef = useRef(iniciales);
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  useEffect(() => {
    const storage = storageSeguro();
    const vistos = leerVistosLocales(storage);
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let pausa: ReturnType<typeof setTimeout> | null = null;

    const cola = crearColaAvisos({
      ahora: () => Date.now(),
      ocupado: () => {
        // Recién recargada por la actualización invisible y aún restaurando: espera.
        if (document.documentElement.hasAttribute(ATRIBUTO_RESTAURANDO)) return "restaurando";
        return motivoOcupado({ bloqueos: bloqueosActivos(), mutacionesEnVuelo: 0, doc: document });
      },
      oculta: () => document.hidden,
      mesa: () => mesaDeUbicacion(window.location.pathname, window.location.search),
      version: versionPestana,
      yaVisto: (id) => vistos.has(id),
      anotarVisto: (id) => { vistos.add(id); guardarVistoLocal(storage, id); },
      marcarVistoRemoto: (id) => { void marcarVistoEnSupabase(id, userIdRef.current).catch(() => {}); },
    });

    const evaluar = () => {
      if (reintento) { clearTimeout(reintento); reintento = null; }
      const r = cola.evaluar();
      setActual(cola.actual());
      if (r === "ocupado") reintento = setTimeout(evaluar, REINTENTO_OCUPADO_MS);
    };
    const evaluarPronto = (ms: number) => {
      if (pausa) clearTimeout(pausa);
      pausa = setTimeout(() => { pausa = null; evaluar(); }, ms);
    };
    recibirRef.current = (avisos) => { cola.recibir(avisos); evaluarPronto(400); };
    cerrarRef.current = (id: string) => {
      cola.cerrar(id);
      setActual(null);
      evaluarPronto(PAUSA_ENTRE_AVISOS_MS);
    };

    cola.recibir(inicialesRef.current);
    // Tras montar (deja que la página pinte y tome sus bloqueos primero).
    evaluarPronto(1_200);

    const soltarBus = escucharAvisos((avisos) => recibirRef.current(avisos));
    const soltarBloqueo = alLiberarBloqueo(() => evaluarPronto(400));
    const onVisible = () => { if (!document.hidden) evaluarPronto(600); };
    const onNavegar = () => evaluarPronto(400);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("popstate", onNavegar);

    return () => {
      soltarBus();
      soltarBloqueo();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("popstate", onNavegar);
      if (reintento) clearTimeout(reintento);
      if (pausa) clearTimeout(pausa);
    };
  }, []);

  // El layout vuelve a renderizar (router.refresh): lo nuevo entra a la cola.
  useEffect(() => {
    if (iniciales === inicialesRef.current) return;
    inicialesRef.current = iniciales;
    recibirRef.current(iniciales);
  }, [iniciales]);

  const cerrar = useCallback((id: string) => cerrarRef.current(id), []);
  if (!actual) return null;
  return <AvisoVista aviso={actual} onCerrar={() => cerrar(actual.id)} />;
}
