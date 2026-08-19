"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/Toast";

/**
 * Vuelta de Mercado Pago al escritorio (back_url = /massdte?mp=back).
 * Flujo "estilo Google": el usuario paga y aterriza donde estaba, con un aviso,
 * en vez de caer en /planes. La confirmación REAL la hace el webhook
 * server-to-server (nunca confiamos en el redirect), por eso el mensaje dice
 * "estamos confirmando" y no "pagado". No renderiza nada; solo el toast y
 * limpia el parámetro de la URL para que no se repita al refrescar.
 */
export default function MpVueltaToast() {
  const params = useSearchParams();
  const { toast } = useToast();
  const shown = useRef(false);

  useEffect(() => {
    if (shown.current || params.get("mp") !== "back") return;
    shown.current = true;
    toast("¡Listo! Estamos confirmando tu pago con Mercado Pago — tu plan se activa en un momento.", "info");
    // Limpiar el parámetro SIN navegar: router.replace dispararía una navegación
    // RSC completa (re-render del escritorio entero, 2-5 s) solo para sacar un
    // query cosmético. history.replaceState lo saca en el acto y no remonta nada.
    const url = new URL(window.location.href);
    url.searchParams.delete("mp");
    window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash);
  }, [params, toast]);

  return null;
}
