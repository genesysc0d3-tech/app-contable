// Frescura de la mesa sin fundir Vercel (plan-costo-vercel-2026-09-28 §5, PR 1b-1e).
//
// Medido el 2026-09-27: /api/mesa era ~70 % del Fast Origin Transfer (69 kB por
// respuesta, 5,8 K llamadas en 12 h). Cada boleta de un lote disparaba varias
// recargas COMPLETAS de la mesa en paralelo (canal de la mesa + canal de Emitir +
// un canal por cada DocCardList + el poll de 5 s + la precarga de las otras dos
// vistas). Estas piezas son puras (reloj y timers inyectables) para testearlas sin
// navegador; MesaController las cablea.

// ── Recargador: una sola carga en vuelo, la repetición se coalesce ──────────────

export interface Recargador {
  /** Pide una recarga. Si ya hay una en vuelo, marca "sucio" y repite UNA vez al terminar. */
  pedir(): void;
  /** true mientras hay una carga en vuelo (tests / diagnóstico). */
  enVuelo(): boolean;
}

export function crearRecargador<P, R>(opts: {
  /** Parámetros VIGENTES al momento de cargar (se leen de un ref, nunca de un closure viejo). */
  params: () => P;
  /** Identidad del rango: si cambió mientras cargaba, la respuesta vieja se descarta. */
  clave: (p: P) => string;
  /** Carga; null = falló (se ignora, el próximo evento reintenta). Puede lanzar. */
  cargar: (p: P) => Promise<R | null>;
  aplicar: (p: P, r: R) => void;
}): Recargador {
  let volando = false;
  let sucio = false;

  const correr = async (): Promise<void> => {
    volando = true;
    sucio = false;
    const p = opts.params();
    try {
      const r = await opts.cargar(p);
      // Rango viejo: el usuario navegó mientras cargaba → no pisar la mesa nueva.
      if (r !== null && opts.clave(opts.params()) === opts.clave(p)) opts.aplicar(p, r);
    } catch {
      /* cargarMesa ya se traga errores; esto cubre cualquier otro: el flag se libera igual */
    } finally {
      volando = false;
    }
    if (sucio) await correr();
  };

  return {
    pedir() {
      if (volando) { sucio = true; return; }
      void correr();
    },
    enVuelo: () => volando,
  };
}

// ── Espaciador: coalesce ráfagas (debounce) y separa recargas (intervalo mínimo) ──

export interface Timers {
  ahora: () => number;
  programar: (fn: () => void, ms: number) => unknown;
  cancelar: (h: unknown) => void;
}

export const timersReales: Timers = {
  ahora: () => Date.now(),
  programar: (fn, ms) => setTimeout(fn, ms),
  cancelar: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Intervalo mínimo entre recargas disparadas por Realtime. */
export const INTERVALO_NORMAL_MS = 15_000;
/** Con un lote en curso (propio o de otra persona): la mesa queda detrás del modal
 *  o en otra pestaña; basta con que no se quede pegada. Recarga final al terminar. */
export const INTERVALO_LOTE_MS = 60_000;
/** Ventana de coalescencia: una boleta = INSERT boleta + UPDATE propuesta + UPDATE doc. */
export const DEBOUNCE_MS = 500;

export interface Espaciador {
  /** Un evento de Realtime llegó. */
  evento(): void;
  /** Ejecuta YA lo pendiente (fin de lote, pestaña visible otra vez). */
  vaciar(): void;
  cancelar(): void;
}

/**
 * evento → espera DEBOUNCE_MS sin más eventos → si pasó el intervalo mínimo desde la
 * última recarga dispara; si no, agenda UNA para cuando se cumpla (nunca se pierde
 * la última: siempre hay recarga de cola).
 */
export function crearEspaciador(disparar: () => void, intervaloMs: () => number, t: Timers = timersReales): Espaciador {
  let ultima = -Infinity;
  let pendiente = false;
  let hDebounce: unknown = null;
  let hEspera: unknown = null;

  const fuego = () => {
    hEspera = null;
    pendiente = false;
    ultima = t.ahora();
    disparar();
  };
  const tras = () => {
    hDebounce = null;
    if (hEspera !== null) return; // ya hay una de cola agendada: la absorbe
    const falta = ultima + intervaloMs() - t.ahora();
    if (falta <= 0) fuego();
    else hEspera = t.programar(fuego, falta);
  };

  return {
    evento() {
      pendiente = true;
      if (hDebounce !== null) t.cancelar(hDebounce);
      hDebounce = t.programar(tras, DEBOUNCE_MS);
    },
    vaciar() {
      if (!pendiente) return;
      if (hDebounce !== null) { t.cancelar(hDebounce); hDebounce = null; }
      if (hEspera !== null) { t.cancelar(hEspera); hEspera = null; }
      fuego();
    },
    cancelar() {
      if (hDebounce !== null) t.cancelar(hDebounce);
      if (hEspera !== null) t.cancelar(hEspera);
      hDebounce = hEspera = null;
      pendiente = false;
    },
  };
}

// ── Cadencia del poll de documentos en proceso ─────────────────────────────────

const ESCALERA_MS = [5_000, 10_000, 30_000, 60_000];

/**
 * Cuánto esperar antes del próximo sondeo de docs "procesando". null = no sondear.
 * Pestaña oculta → null (al volver se refresca al tiro). SIN tope por tiempo: este
 * poll es hoy el rescate de la cola (vía /api/mesa → autoDrenaje) y hay cartolas de
 * ~1000 s; se queda en 60 s mientras siga habiendo algo procesando.
 */
export function cadenciaDocs(args: { oculta: boolean; hayProcesando: boolean; intento: number }): number | null {
  if (args.oculta || !args.hayProcesando) return null;
  return ESCALERA_MS[Math.min(Math.max(args.intento, 0), ESCALERA_MS.length - 1)];
}

// ── RCV incremental ────────────────────────────────────────────────────────────

export interface FilaRcv {
  id: string;
  folio: number | null;
  fecha_emision: string;
}

/** Mes "YYYY-MM" de una fecha ISO (solo mira el texto: sin zona horaria). */
export function mesDe(fecha: string): string {
  return fecha.slice(0, 7);
}

/**
 * Agrega la boleta recién emitida al mes visible del RCV sin re-pedir el mes entero.
 * Dedup por id (el evento puede repetirse), solo si es del mes, orden como el
 * endpoint (/api/boletas/rcv): fecha desc, folio desc.
 */
export function mergeRcv<T extends FilaRcv>(filas: T[], nueva: T, mes: string): T[] {
  if (!nueva?.id || typeof nueva.fecha_emision !== "string" || mesDe(nueva.fecha_emision) !== mes) return filas;
  const sin = filas.filter((f) => f.id !== nueva.id);
  sin.push(nueva);
  return sin.sort((a, b) => {
    if (a.fecha_emision !== b.fecha_emision) return a.fecha_emision < b.fecha_emision ? 1 : -1;
    return (b.folio ?? -1) - (a.folio ?? -1);
  });
}
