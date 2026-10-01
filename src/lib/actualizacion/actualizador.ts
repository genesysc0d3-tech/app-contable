// Orquestador de la actualización invisible (sin DOM: todo inyectado → testeable).
//  observar(cabeceras) → si la versión publicada ≠ la de la pestaña, queda PENDIENTE.
//  intentar()          → recarga SOLO si: ruta permitida, en línea, libre, (visible →
//                        quieta hace 3 s) y el anti-bucle lo deja. Antes guarda el estado.
import { CABECERA_ACTUALIZAR, CABECERA_VERSION } from "./version";
import { anotarRecarga, decidirRecarga, guardarRegistro, leerRegistro, type StorageLike } from "./anti-bucle";

export const QUIETUD_VISIBLE_MS = 3_000;

const RUTAS_SIN_RECARGA = [/^\/auth(\/|$)/, /^\/legal(\/|$)/, /^\/oauth(\/|$)/, /^\/shell$/, /^\/instalar-extension$/, /^\/bloqueado$/, /^\/\.well-known\//];
export function rutaPermiteRecarga(pathname: string): boolean {
  return !RUTAS_SIN_RECARGA.some((r) => r.test(pathname));
}

export type DepsActualizador = {
  versionPropia: string;
  ahora: () => number;
  sesion: StorageLike;
  oculta: () => boolean;
  enLinea: () => boolean;
  /** pathname actual. */
  ruta: () => string;
  /** Motivo por el que NO es seguro recargar ahora (null = libre). */
  ocupado: () => string | null;
  ultimaInteraccion: () => number;
  guardarEstado: () => void;
  recargar: () => void;
};

export type ResultadoIntento = "sin_pendiente" | "ruta" | "sin_red" | "ocupada" | "interactuando" | "anti_bucle" | "recargada";

export function crearActualizador(d: DepsActualizador) {
  let pendiente: string | null = null;
  let recargando = false;

  function intentar(): ResultadoIntento {
    if (!pendiente || recargando) return "sin_pendiente";
    if (!rutaPermiteRecarga(d.ruta())) return "ruta";
    if (!d.enLinea()) return "sin_red";
    if (d.ocupado()) return "ocupada";
    if (!d.oculta() && d.ahora() - d.ultimaInteraccion() < QUIETUD_VISIBLE_MS) return "interactuando";
    const ahora = d.ahora();
    const reg = leerRegistro(d.sesion);
    if (!decidirRecarga(reg, pendiente, ahora).ok) { pendiente = null; return "anti_bucle"; }
    guardarRegistro(d.sesion, anotarRecarga(reg, pendiente, ahora));
    // Sin registro persistido (storage bloqueado) no hay anti-bucle: mejor no recargar.
    if (!leerRegistro(d.sesion).intentos.some((i) => i.version === pendiente)) { pendiente = null; return "anti_bucle"; }
    try { d.guardarEstado(); } catch { /* sin estado: igual vuelve a la misma URL */ }
    recargando = true;
    d.recargar();
    return "recargada";
  }

  return {
    observar(h: { get(nombre: string): string | null }): void {
      const v = h.get(CABECERA_VERSION);
      if (!v) return;
      const forzar = h.get(CABECERA_ACTUALIZAR) === "1";
      if (v === d.versionPropia && !forzar) return;
      if (pendiente === v) return;
      // Descartada por anti-bucle: no se re-arma con cada respuesta.
      if (!decidirRecarga(leerRegistro(d.sesion), v, d.ahora()).ok) return;
      pendiente = v;
      intentar();
    },
    intentar,
    pendiente: () => pendiente,
  };
}
