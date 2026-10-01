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
import { alLiberarBloqueo, bloqueosActivos, estadoEscrituras, motivoOcupado, msDesdeUltimaLiberacion } from "@/lib/actualizacion/ocupado";
import { ATRIBUTO_RESTAURANDO } from "@/lib/actualizacion/estado-guardado";
import { crearColaAvisos, guardarVistoLocal, leerVistosLocales } from "@/lib/avisos/cola";
import { escucharAvisos } from "@/lib/avisos/bus";
import { motivoEsperaAviso } from "@/lib/avisos/espera";
import { formatoEfectivo, mesaDeUbicacion, type AvisoApp } from "@/lib/avisos/reglas";
import { versionPestana } from "@/lib/avisos/version";

const REINTENTO_OCUPADO_MS = 3_000;
const PAUSA_ENTRE_AVISOS_MS = 700;
// Re-evaluar el aviso en pantalla al vencer (tope: setTimeout no aguanta plazos largos).
const TOPE_TIMER_VENCE_MS = 60 * 60_000;

function storageSeguro(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

async function marcarVistoEnSupabase(avisoId: string, userId: string): Promise<void> {
  // ignoreDuplicates = ON CONFLICT DO NOTHING: cerrar en dos computadores no choca.
  await supabase.from("avisos_vistos").upsert({ aviso_id: avisoId, user_id: userId }, { onConflict: "aviso_id,user_id", ignoreDuplicates: true });
}

/** iniciales undefined = el server no pudo saber (falló o tardó): la cola no se toca. */
export default function AvisosApp({ iniciales, userId }: { iniciales: AvisoApp[] | undefined; userId: string }) {
  const [actual, setActual] = useState<AvisoApp | null>(null);
  const recibirRef = useRef<(avisos: AvisoApp[] | undefined) => void>(() => {});
  const cerrarRef = useRef<(id: string) => void>(() => {});
  const inicialesRef = useRef(iniciales);

  useEffect(() => {
    const storage = storageSeguro();
    // Por usuario (M4): en un computador compartido, lo que cerró otra persona no cuenta.
    const vistos = leerVistosLocales(storage, userId);
    let reintento: ReturnType<typeof setTimeout> | null = null;
    let pausa: ReturnType<typeof setTimeout> | null = null;
    let vence: ReturnType<typeof setTimeout> | null = null;

    const cola = crearColaAvisos({
      ahora: () => Date.now(),
      ocupado: (aviso) => {
        // Recién recargada por la actualización invisible y aún restaurando: espera.
        if (document.documentElement.hasAttribute(ATRIBUTO_RESTAURANDO)) return "restaurando";
        const esc = estadoEscrituras();
        const base = motivoOcupado({ bloqueos: bloqueosActivos(), mutacionesEnVuelo: 0, msDesdeUltimaEscritura: Date.now() - esc.ultimaFin, doc: document });
        // El popup urgente además espera escrituras en vuelo, el margen tras una
        // emisión y a que no haya un toast de la app a la vista (M2).
        return motivoEsperaAviso(formatoEfectivo(aviso), {
          base,
          escriturasEnVuelo: esc.enVuelo,
          msDesdeLiberacion: msDesdeUltimaLiberacion(),
          toastDeLaApp: Boolean(document.querySelector("[data-massdte-toasts] > *")),
        });
      },
      oculta: () => document.hidden,
      mesa: () => mesaDeUbicacion(window.location.pathname, window.location.search),
      version: versionPestana,
      yaVisto: (id) => vistos.has(id),
      anotarVisto: (id) => { vistos.add(id); guardarVistoLocal(storage, userId, id); },
      marcarVistoRemoto: (id) => { void marcarVistoEnSupabase(id, userId).catch(() => {}); },
    });

    const evaluar = () => {
      if (reintento) { clearTimeout(reintento); reintento = null; }
      if (vence) { clearTimeout(vence); vence = null; }
      const r = cola.evaluar();
      const enPantalla = cola.actual();
      setActual(enPantalla);
      // Esperando momento seguro, o un urgente esperando para desplazar lo que está en pantalla.
      if (r === "ocupado" || (enPantalla && enPantalla.tipo !== "urgente" && cola.urgentesEsperando() > 0)) {
        reintento = setTimeout(evaluar, REINTENTO_OCUPADO_MS);
      }
      // El aviso en pantalla se retira solo al vencer (M1/B4: un popup vencido no bloquea nada).
      if (enPantalla) {
        const ms = Math.min(Math.max(Date.parse(enPantalla.hasta) - Date.now(), 0) + 500, TOPE_TIMER_VENCE_MS);
        vence = setTimeout(evaluar, ms);
      }
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
      if (vence) clearTimeout(vence);
    };
  }, [userId]);

  // El layout vuelve a renderizar (router.refresh, cambio de empresa): su lista es la
  // verdad y reemplaza la cola (lo de la empresa anterior sale sin marcarse visto).
  useEffect(() => {
    if (iniciales === inicialesRef.current) return;
    inicialesRef.current = iniciales;
    recibirRef.current(iniciales);
  }, [iniciales]);

  const cerrar = useCallback((id: string) => cerrarRef.current(id), []);
  if (!actual) return null;
  return <AvisoVista aviso={actual} onCerrar={() => cerrar(actual.id)} />;
}
