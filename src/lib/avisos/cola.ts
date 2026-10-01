// Cola de avisos de la pantalla (sin DOM: todo inyectado → testeable).
//  recibir(avisos) → la respuesta del server es la verdad: reemplaza la cola (lo ya
//                    visto no entra; lo que ya no viene sale, también de pantalla).
//  evaluar()       → si no hay uno en pantalla, la pestaña se ve y NO es un momento
//                    ocupado (emisión, subida, popup con cambios, alguien escribiendo),
//                    muestra el primero que aplique. De a UNO; un urgente desplaza a
//                    lo no urgente.
//  cerrar(id)      → visto: se anota local (puente mientras la caché del server
//                    siga mandándolo) y remoto (avisos_vistos, para todos sus computadores).
import { avisoParaMesa, avisoVigente, esAvisoValido, ordenarCola, versionCumple, type AvisoApp, type MesaAviso, type VersionPestana } from "./reglas";

export type DepsCola = {
  ahora: () => number;
  /** Motivo por el que ESTE aviso no puede salir ahora (null = libre). El popup es más estricto. */
  ocupado: (a: AvisoApp) => string | null;
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

  /** Saca de pantalla SIN marcar visto (el server dejó de mandarlo, venció, o lo desplaza un urgente). */
  function retirarActual(volverACola: boolean) {
    if (!actual) return;
    if (volverACola) cola = ordenarCola([...cola, actual]);
    actual = null;
  }

  return {
    /**
     * Cada respuesta del server (layout o /api/mesa) es la VERDAD de lo vigente para
     * esta persona y empresa (revisión adversarial M1): lo que ya no viene —desactivado
     * por el operador, vencido, de la empresa anterior— sale de la cola y de pantalla
     * sin marcarse visto. Un [] legítimo vacía la cola. Basura (no-array) se ignora.
     */
    recibir(avisos: AvisoApp[] | null | undefined): void {
      if (!Array.isArray(avisos)) return;
      const validos = avisos.filter(esAvisoValido);
      const ids = new Set(validos.map((a) => a.id));
      if (actual && !ids.has(actual.id)) retirarActual(false);
      const nueva: AvisoApp[] = [];
      for (const a of validos) {
        if (cerrados.has(a.id) || d.yaVisto(a.id)) continue;
        if (actual?.id === a.id) { actual = a; continue; } // el operador lo editó: vale la versión nueva
        if (!nueva.some((x) => x.id === a.id)) nueva.push(a);
      }
      cola = ordenarCola(nueva);
    },

    evaluar(): ResultadoEvaluar {
      const ahora = d.ahora();
      // En pantalla y vencido (p. ej. popup de mantención que terminó): se retira solo.
      if (actual && !avisoVigente(actual, ahora)) retirarActual(false);
      limpiarVencidos(ahora);
      if (actual) {
        // A1: un urgente desplaza a lo no urgente en pantalla (que vuelve a la cola sin marcarse).
        if (actual.tipo === "urgente") return "mostrando";
        const urgente = cola.find((a) => a.tipo === "urgente" && aplica(a, ahora));
        if (!urgente || d.oculta() || d.ocupado(urgente)) return "mostrando";
        retirarActual(true);
        actual = urgente;
        cola = cola.filter((a) => a.id !== urgente.id);
        return "mostrando";
      }
      const siguiente = cola.find((a) => aplica(a, ahora));
      if (!siguiente) return "vacia";
      if (d.oculta()) return "oculta";
      if (d.ocupado(siguiente)) return "ocupado";
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
    /** Urgentes en cola (para reintentar desplazar lo no urgente en pantalla). */
    urgentesEsperando: () => cola.filter((a) => a.tipo === "urgente").length,
  };
}

// ── Vistos locales (localStorage, POR USUARIO) ─────────────────────────────────
// No es la verdad (esa es avisos_vistos): es el puente para que un aviso cerrado no
// reaparezca mientras la caché corta del server lo siga mandando, o si marcar
// remoto falló sin red. La clave lleva el usuario (M4): en un computador compartido
// lo que cerró una persona no se le esconde a otra.
const PREFIJO_VISTOS_LOCALES = "massdte.avisos.vistos";
const MAX_VISTOS_LOCALES = 200;

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function claveVistosLocales(userId: string): string {
  return `${PREFIJO_VISTOS_LOCALES}:${userId}`;
}

export function leerVistosLocales(s: StorageLike | null, userId: string): Set<string> {
  try {
    const raw = s?.getItem(claveVistosLocales(userId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function guardarVistoLocal(s: StorageLike | null, userId: string, id: string): void {
  if (!s) return;
  try {
    const actuales = [...leerVistosLocales(s, userId)].filter((x) => x !== id);
    actuales.push(id);
    s.setItem(claveVistosLocales(userId), JSON.stringify(actuales.slice(-MAX_VISTOS_LOCALES)));
  } catch { /* lleno o bloqueado */ }
}
