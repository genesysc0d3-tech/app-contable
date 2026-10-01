"use client";

// Hooks de la actualización invisible para los componentes del escritorio.
import { useEffect, useLayoutEffect, useRef } from "react";
import { tomarBloqueo } from "./ocupado";
import { registrarPieza } from "./piezas";

/**
 * Mientras `activo`, la pestaña NO se recarga sola (emisión en curso, subida,
 * cola de archivos sin subir…). Al soltarse, el actualizador reintenta al tiro.
 */
export function useBloqueoActualizacion(activo: boolean, motivo: string): void {
  useEffect(() => {
    if (!activo) return;
    return tomarBloqueo(motivo);
  }, [activo, motivo]);
}

/**
 * Registra una "pieza" del estado visible: `guardar` se llama justo antes de la
 * recarga automática; `restaurar` recibe el valor guardado al montar tras ella
 * (layout effect: se aplica antes de que se vea). Los callbacks pueden cambiar en
 * cada render: se leen siempre los últimos.
 */
export function usePiezaEstado<T>(clave: string, guardar: () => T | undefined, restaurar: (valor: T) => void): void {
  const g = useRef(guardar);
  const r = useRef(restaurar);
  useLayoutEffect(() => { g.current = guardar; r.current = restaurar; });
  useLayoutEffect(() => registrarPieza(clave, {
    guardar: () => g.current(),
    restaurar: (v) => r.current(v as T),
  }), [clave]);
}
