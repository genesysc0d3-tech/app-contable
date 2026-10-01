// Cola de avisos de la pantalla (sin DOM: todo inyectado → testeable).
//  recibir(avisos) → se suman los nuevos (sin duplicar; lo ya visto no entra).
//  evaluar()       → si no hay uno en pantalla, la pestaña se ve y NO es un momento
//                    ocupado (emisión, subida, popup con cambios, alguien escribiendo),
//                    muestra el primero que aplique. De a UNO.
//  cerrar(id)      → visto: se anota local (puente mientras la caché del server
//                    siga mandándolo) y remoto (avisos_vistos, para todos sus computadores).
import { avisoParaMesa, avisoVigente, esAvisoValido, ordenarCola, versionCumple, type AvisoApp, type MesaAviso, type VersionPestana } from "./reglas";

export type DepsCola = {
  ahora: () => number;
  /** Motivo por el que NO es momento de mostrar nada (null = libre). */
  ocupado: () => string | null;
  oculta: () => boolean;
  mesa: () => MesaAviso | null;
  version: () => VersionPestana;
  yaVisto: (id: string) => boolean;
  anotarVisto: (id: string) => void;
  marcarVistoRemoto: (id: string) => void;
};

export type ResultadoEvaluar = "mostrando" | "ocupado" | "oculta" | "vacia";

export function crearColaAvisos(d: DepsCola) {
  let cola: AvisoApp[] = [];
  let actual: AvisoApp | null = null;
  const cerrados = new Set<string>();

  const aplica = (a: AvisoApp, ahora: number) =>
    avisoVigente(a, ahora) && avisoParaMesa(a, d.mesa()) && versionCumple(a.version_min, d.version());

  function limpiarVencidos(ahora: number) {
    cola = cola.filter((a) => !cerrados.has(a.id) && !d.yaVisto(a.id) && Date.parse(a.hasta) > ahora);
  }

  return {
    recibir(avisos: AvisoApp[] | null | undefined): void {
      if (!Array.isArray(avisos)) return;
      for (const a of avisos) {
        if (!esAvisoValido(a)) continue;
        if (cerrados.has(a.id) || d.yaVisto(a.id)) continue;
        if (actual?.id === a.id) continue;
        const i = cola.findIndex((x) => x.id === a.id);
        if (i >= 0) cola[i] = a; // el operador lo editó: vale la versión nueva
        else cola.push(a);
      }
      cola = ordenarCola(cola);
    },

    evaluar(): ResultadoEvaluar {
      if (actual) return "mostrando";
      const ahora = d.ahora();
      limpiarVencidos(ahora);
      const siguiente = cola.find((a) => aplica(a, ahora));
      if (!siguiente) return "vacia";
      if (d.oculta()) return "oculta";
      if (d.ocupado()) return "ocupado";
      actual = siguiente;
      cola = cola.filter((a) => a.id !== siguiente.id);
      return "mostrando";
    },

    cerrar(id: string): void {
      if (cerrados.has(id)) return;
      cerrados.add(id);
      if (actual?.id === id) actual = null;
      cola = cola.filter((a) => a.id !== id);
      try { d.anotarVisto(id); } catch { /* storage bloqueado: igual queda en memoria */ }
      try { d.marcarVistoRemoto(id); } catch { /* sin red: queda anotado local */ }
    },

    actual: () => actual,
    /** Cuántos esperan (aplicables o no todavía). */
    pendientes: () => cola.length,
  };
}

// ── Vistos locales (localStorage) ───────────────────────────────────────────────
// No es la verdad (esa es avisos_vistos): es el puente para que un aviso cerrado no
// reaparezca mientras la caché corta del server lo siga mandando, o si marcar
// remoto falló sin red.
export const CLAVE_VISTOS_LOCALES = "massdte.avisos.vistos";
const MAX_VISTOS_LOCALES = 200;

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function leerVistosLocales(s: StorageLike | null): Set<string> {
  try {
    const raw = s?.getItem(CLAVE_VISTOS_LOCALES);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function guardarVistoLocal(s: StorageLike | null, id: string): void {
  if (!s) return;
  try {
    const actuales = [...leerVistosLocales(s)].filter((x) => x !== id);
    actuales.push(id);
    s.setItem(CLAVE_VISTOS_LOCALES, JSON.stringify(actuales.slice(-MAX_VISTOS_LOCALES)));
  } catch { /* lleno o bloqueado */ }
}
