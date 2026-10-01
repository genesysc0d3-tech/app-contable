// "Piezas" del estado visible: cada componente que tiene algo que valga la pena
// recordar (pestaña activa, doc abierto en el visor, filtros, paneles) se registra
// con cómo GUARDARLO y cómo RESTAURARLO. Antes de recargar se capturan todas; tras
// recargar, cada pieza recibe su valor apenas se monta (aunque monte tarde: la
// pestaña Emitir solo existe después de restaurar la pestaña activa).
import { leerEstado, type EstadoGuardado } from "./estado-guardado";

export type Pieza = { guardar: () => unknown; restaurar: (valor: unknown) => void };

// UNA sola instancia por pestaña aunque el bundler cargue este módulo dos veces
// (chunk del layout y chunk de la página): el estado vive en globalThis. Sin esto
// el actualizador capturaba un registro vacío y la pestaña volvía a Check (bug en
// vivo 2026-10-01).
type Registro = {
  piezas: Map<string, Pieza>;
  cargado: boolean;
  estado: EstadoGuardado | null;
  porRestaurar: Map<string, unknown>;
  primeraRestauracion: number | null;
  ultimaRestauracion: number | null;
};
const G = globalThis as typeof globalThis & { __massdtePiezas?: Registro };
function reg(): Registro {
  G.__massdtePiezas ??= { piezas: new Map(), cargado: false, estado: null, porRestaurar: new Map(), primeraRestauracion: null, ultimaRestauracion: null };
  return G.__massdtePiezas;
}

function fuenteNavegador(): EstadoGuardado | null {
  if (typeof window === "undefined") return null;
  return leerEstado(window.sessionStorage, { ahora: Date.now(), ruta: window.location.pathname + window.location.search });
}
let fuente: () => EstadoGuardado | null = fuenteNavegador;

/** El estado a restaurar de esta carga (se lee y consume UNA vez, perezoso). */
export function estadoARestaurar(): EstadoGuardado | null {
  const r = reg();
  if (!r.cargado) {
    r.cargado = true;
    try { r.estado = fuente(); } catch { r.estado = null; }
    r.porRestaurar = new Map(Object.entries(r.estado?.piezas ?? {}));
  }
  return r.estado;
}

export function registrarPieza(clave: string, pieza: Pieza): () => void {
  const r = reg();
  r.piezas.set(clave, pieza);
  estadoARestaurar();
  if (r.porRestaurar.has(clave)) {
    const v = r.porRestaurar.get(clave);
    r.porRestaurar.delete(clave);
    try { pieza.restaurar(v); } catch { /* restauración best-effort: se descarta */ }
    r.ultimaRestauracion = Date.now();
    r.primeraRestauracion ??= r.ultimaRestauracion;
  }
  return () => { if (r.piezas.get(clave) === pieza) r.piezas.delete(clave); };
}

export function capturarPiezas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [clave, p] of reg().piezas) {
    try {
      const v = p.guardar();
      if (v !== undefined) out[clave] = v;
    } catch { /* una pieza rota no tumba el resto */ }
  }
  return out;
}

export function piezasPorRestaurar(): number {
  estadoARestaurar();
  return reg().porRestaurar.size;
}

/** Cuándo se restauró la última pieza (null = ninguna aún). */
export function momentoUltimaRestauracion(): number | null { return reg().ultimaRestauracion; }
export function momentoPrimeraRestauracion(): number | null { return reg().primeraRestauracion; }

/** Abandona lo que no alcanzó a montarse (tope de tiempo). */
export function descartarRestauracion(): void { reg().porRestaurar.clear(); }

/** Solo tests. */
export function _reiniciarPiezas(f: () => EstadoGuardado | null = fuenteNavegador): void {
  G.__massdtePiezas = undefined;
  fuente = f;
}
