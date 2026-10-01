// Orquestador de la actualización invisible (sin DOM: todo inyectado → testeable).
//  observar(cabeceras) → si la versión publicada ≠ la de la pestaña, queda PENDIENTE.
//  intentar()          → recarga SOLO si: ruta permitida, en línea, libre, (visible →
//                        quieta hace 3 s) y el anti-bucle lo deja. Antes guarda el estado.
import { CABECERA_VERSION } from "./version";
import { anotarRecarga, decidirRecarga, guardarRegistro, leerRegistro, type StorageLike } from "./anti-bucle";

// Con la pestaña VISIBLE la recarga se nota: se exige un buen rato sin tocar nada
// (revisión adversarial M2). Lo normal es que recargue oculta (HEAD al ocultarse).
export const QUIETUD_VISIBLE_MS = 25_000;

// Al OCULTARSE la pestaña se pregunta la versión (un HEAD barato a /api/sw-config,
// sin auth ni DB): así la recarga ocurre mientras la clienta no mira. Con tope para
// que ir y venir entre pestañas no sea un sondeo disfrazado.
export const CONSULTA_AL_OCULTARSE_CADA_MS = 5 * 60_000;
export function tocaConsultarVersion(ultimaConsulta: number | null, ahora: number): boolean {
  return ultimaConsulta === null || ahora - ultimaConsulta >= CONSULTA_AL_OCULTARSE_CADA_MS;
}

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
    const ult = leerRegistro(d.sesion).intentos.at(-1);
    if (!ult || ult.version !== pendiente || ult.at !== ahora) { pendiente = null; return "anti_bucle"; }
    try { d.guardarEstado(); } catch { /* sin estado: igual vuelve a la misma URL */ }
    recargando = true;
    d.recargar();
    return "recargada";
  }

  return {
    observar(h: { get(nombre: string): string | null }): void {
      const v = h.get(CABECERA_VERSION);
      if (!v) return;
      // La marca "pestaña vieja" (CABECERA_ACTUALIZAR) con la MISMA versión no se
      // arregla recargando (A3): solo cuenta una versión distinta.
      if (v === d.versionPropia) return;
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
