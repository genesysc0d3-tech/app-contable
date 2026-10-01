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

// ── Carga puntual que no pisa una navegación posterior ─────────────────────────

/**
 * Carga y aplica SOLO si, al volver la respuesta, la clave `vigente()` sigue siendo
 * la que era al pedir. Bug fundador 2026-10-01 ("me voy a otra fecha y a unos
 * minutos me manda a hoy"): la carga post-subida y la navegación del calendario
 * aplicaban su respuesta sin mirar si el usuario se había movido entre medio → una
 * respuesta lenta/vieja le cambiaba la mesa (y la fecha) por debajo.
 * `guardar` corre SIEMPRE con una respuesta buena (p. ej. sembrar la caché: el dato
 * sirve aunque ya no se muestre). Devuelve true si aplicó.
 */
export async function cargarSiSigueVigente<R>(args: {
  vigente: () => string;
  cargar: () => Promise<R | null>;
  aplicar: (r: R) => void;
  guardar?: (r: R) => void;
}): Promise<boolean> {
  const clave = args.vigente();
  const r = await args.cargar();
  if (r === null) return false;
  args.guardar?.(r);
  if (args.vigente() !== clave) return false;
  args.aplicar(r);
  return true;
}

/**
 * ¿La recarga trajo EXACTAMENTE lo mismo que ya se mostraba? Si sí, MesaController
 * no re-renderiza ni re-difunde la mesa (menos trabajo en cada paso de la vigilancia
 * post-subida y en los sondeos). NO decide la frescura de la caché: los otros rangos
 * se envejecen igual, porque el evento pudo cambiar un rango que no es el visible.
 * Comparación por contenido serializado (la respuesta es determinista dado el mismo
 * dato). Ante cualquier duda (no serializable) responde false = aplicar, como antes.
 */
export function mismaMesa(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Atenuación de la mesa: solo mientras carga el ÚLTIMO rango pedido. Al terminar la
 * carga de `terminada`, el "cargando" se apaga solo si era ESE; si el usuario ya
 * pidió otro (o lo sirvió la caché → null) se respeta. Antes dependía del isPending
 * global de la transición: clic en 5 (lento) → clic en 6 (caché) dejaba la mesa del
 * 6 atenuada hasta que llegaba/expiraba la del 5.
 */
export function cargandoTras(cargando: string | null, terminada: string): string | null {
  return cargando === terminada ? null : cargando;
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
/** Tope de una carga de /api/mesa: el recargador tiene UNA en vuelo; sin tope, un
 *  fetch colgado dejaría la mesa congelada. */
export const TIMEOUT_CARGA_MS = 45_000;
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
    // Como Postgres con DESC: los folios null van PRIMERO dentro del día.
    return (b.folio ?? Number.MAX_SAFE_INTEGER) - (a.folio ?? Number.MAX_SAFE_INTEGER);
  });
}
