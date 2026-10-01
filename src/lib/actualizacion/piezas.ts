// "Piezas" del estado visible: cada componente que tiene algo que valga la pena
// recordar (pestaña activa, doc abierto en el visor, filtros, paneles) se registra
// con cómo GUARDARLO y cómo RESTAURARLO. Antes de recargar se capturan todas; tras
// recargar, cada pieza recibe su valor apenas se monta (aunque monte tarde: la
// pestaña Emitir solo existe después de restaurar la pestaña activa).
import { leerEstado, type EstadoGuardado } from "./estado-guardado";

export type Pieza = { guardar: () => unknown; restaurar: (valor: unknown) => void };

const piezas = new Map<string, Pieza>();
let cargado = false;
let estado: EstadoGuardado | null = null;
let porRestaurar = new Map<string, unknown>();
let ultimaRestauracion: number | null = null;

function fuenteNavegador(): EstadoGuardado | null {
  if (typeof window === "undefined") return null;
  return leerEstado(window.sessionStorage, { ahora: Date.now(), ruta: window.location.pathname + window.location.search });
}
let fuente: () => EstadoGuardado | null = fuenteNavegador;

/** El estado a restaurar de esta carga (se lee y consume UNA vez, perezoso). */
export function estadoARestaurar(): EstadoGuardado | null {
  if (!cargado) {
    cargado = true;
    try { estado = fuente(); } catch { estado = null; }
    porRestaurar = new Map(Object.entries(estado?.piezas ?? {}));
  }
  return estado;
}

export function registrarPieza(clave: string, pieza: Pieza): () => void {
  piezas.set(clave, pieza);
  estadoARestaurar();
  if (porRestaurar.has(clave)) {
    const v = porRestaurar.get(clave);
    porRestaurar.delete(clave);
    try { pieza.restaurar(v); } catch { /* restauración best-effort: se descarta */ }
    ultimaRestauracion = Date.now();
  }
  return () => { if (piezas.get(clave) === pieza) piezas.delete(clave); };
}

export function capturarPiezas(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [clave, p] of piezas) {
    try {
      const v = p.guardar();
      if (v !== undefined) out[clave] = v;
    } catch { /* una pieza rota no tumba el resto */ }
  }
  return out;
}

export function piezasPorRestaurar(): number {
  estadoARestaurar();
  return porRestaurar.size;
}

/** Cuándo se restauró la última pieza (null = ninguna aún). */
export function momentoUltimaRestauracion(): number | null { return ultimaRestauracion; }

/** Abandona lo que no alcanzó a montarse (tope de tiempo). */
export function descartarRestauracion(): void { porRestaurar.clear(); }

/** Solo tests. */
export function _reiniciarPiezas(f: () => EstadoGuardado | null = fuenteNavegador): void {
  piezas.clear();
  cargado = false;
  estado = null;
  porRestaurar = new Map();
  ultimaRestauracion = null;
  fuente = f;
}
