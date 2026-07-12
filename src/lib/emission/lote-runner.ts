// Núcleo del motor masivo: recorre la lista de boletas listas y las emite UNA a
// UNA, de forma estrictamente secuencial, con cadencia humana entre cada una.
//
// Todo lo peligroso vive aquí y es TESTEABLE sin tocar red, extensión ni reloj:
// el orden, el tope de sesión, cuándo pausar por error, cuándo esperar el jitter,
// y la garantía de que "Detener" NUNCA aborta una emisión en vuelo (eso perdería
// un folio ya emitido). Lo externo entra por un `LoteDriver` inyectable.
//
// Invariantes de seguridad:
//   1. Secuencial puro: la boleta i+1 no arranca hasta que la i llega a un estado
//      TERMINAL (emitida | fallida). El lock server-side por cuenta lo refuerza.
//   2. Detener es cooperativo: se chequea ENTRE ítems, jamás corta `emitirUna` a
//      la mitad. Una boleta que ya se está emitiendo siempre se deja terminar.
//   3. El tope (sessionCap) frena tras N emisiones EXITOSAS y pide gesto humano.

import { CADENCIA_DEFAULT, nextDelayMs, type CadenciaConfig } from "./cadencia";

export interface ItemLote {
  /** Propuesta que se va a emitir (enlaza el folio). Clave de idempotencia. */
  propuestaId: string;
  tipoDte: 39 | 41;
  monto: number;
  /** Texto corto para mostrar en el progreso (receptor o descripción). */
  etiqueta: string;
}

export type DesenlaceItem =
  | { estado: "emitida"; folio: number; boletaId?: string | null }
  // fallida = PRE-emit y seguro: no se llegó a cliquear EMITIR, no hay folio. Se
  // puede saltar y seguir. (La extensión nunca reporta error/cancelado post-emit.)
  | { estado: "fallida"; motivo: string }
  // revisar = POST-emit incierto: se cliqueó EMITIR pero no se pudo capturar/guardar
  // el folio (puede ser un folio REAL con la ventana abierta). FRENA el lote en seco:
  // seguir abriría otra ventana y arriesgaría perder/duplicar el folio.
  | { estado: "revisar"; motivo: string; folio?: number | null };

export type FaseLote =
  | "preparando"
  | "emitiendo"
  | "esperando" // en el jitter, entre boletas
  | "pausada" // esperando decisión humana (error o tope)
  | "requiere_revision" // frenado por una boleta "a medias" que el humano debe resolver
  | "terminada"
  | "detenida";

export type MotivoPausa = "error" | "tope";

export interface ProgresoLote {
  total: number;
  procesadas: number; // emitidas + fallidas + revision
  emitidas: number;
  fallidas: number;
  revision: number; // boletas "a medias" que frenaron el lote
  indiceActual: number; // 0-based; -1 antes de empezar
  fase: FaseLote;
  itemActual: ItemLote | null;
  subestado: string | null; // mensaje fino de la emisión en curso (login, captura, etc.)
  resultados: Array<{ item: ItemLote; desenlace: DesenlaceItem }>;
  folios: number[];
}

export interface LoteDriver {
  /**
   * Emite UNA boleta de punta a punta (lock → job a la extensión → captura del
   * folio → persistencia) y resuelve SOLO en estado terminal. Si el SII pide
   * intervención humana (captcha/2FA/login), NO resuelve: sigue esperando y va
   * reportando subestados; si el usuario nunca actúa, el job expira (15 min) y
   * resuelve como fallida. `reportar` alimenta el subestado de la UI.
   */
  emitirUna(item: ItemLote, reportar: (subestado: string) => void): Promise<DesenlaceItem>;
  /** Espera `ms` (la cadencia). El runner ya decide cuánto. */
  esperar(ms: number): Promise<void>;
  /** Aleatoriedad para el jitter. Inyectable para tests. */
  rand?: () => number;
}

export interface LoteOpciones {
  config?: CadenciaConfig;
  /**
   * Se invoca cuando el runner necesita decisión humana. Debe resolver a
   * "continuar" (seguir con las próximas) o "detener" (cerrar el lote acá).
   * Si no se provee: ante error sigue; ante tope detiene (conservador).
   */
  alPausar?: (motivo: MotivoPausa, progreso: ProgresoLote) => Promise<"continuar" | "detener">;
  onProgreso?: (progreso: ProgresoLote) => void;
  /** Detener cooperativo: se chequea entre ítems, nunca corta uno en vuelo. */
  señalDetener?: AbortSignal;
}

function snapshot(p: ProgresoLote): ProgresoLote {
  return { ...p, resultados: p.resultados.map((r) => ({ ...r })), folios: [...p.folios] };
}

export async function ejecutarLote(
  items: ItemLote[],
  driver: LoteDriver,
  opts: LoteOpciones = {},
): Promise<ProgresoLote> {
  const config = opts.config ?? CADENCIA_DEFAULT;
  const rand = driver.rand ?? Math.random;

  const p: ProgresoLote = {
    total: items.length,
    procesadas: 0,
    emitidas: 0,
    fallidas: 0,
    revision: 0,
    indiceActual: -1,
    fase: "preparando",
    itemActual: null,
    subestado: null,
    resultados: [],
    folios: [],
  };
  const emitir = () => opts.onProgreso?.(snapshot(p));
  emitir();

  const detenido = () => opts.señalDetener?.aborted === true;
  let emitidasDesdeTope = 0;

  for (let i = 0; i < items.length; i++) {
    // Chequeo cooperativo ANTES de arrancar la próxima (nunca a mitad de una).
    if (detenido()) {
      p.fase = "detenida";
      p.itemActual = null;
      emitir();
      return p;
    }

    const item = items[i];
    p.indiceActual = i;
    p.itemActual = item;
    p.subestado = null;
    p.fase = "emitiendo";
    emitir();

    // ── EMISIÓN REAL de esta boleta (resuelve solo en terminal) ────────────────
    const desenlace = await driver.emitirUna(item, (sub) => {
      p.subestado = sub;
      emitir();
    });

    p.resultados.push({ item, desenlace });
    p.procesadas += 1;
    p.subestado = null;
    p.itemActual = null;
    if (desenlace.estado === "emitida") {
      p.emitidas += 1;
      p.folios.push(desenlace.folio);
      emitidasDesdeTope += 1;
    } else if (desenlace.estado === "revisar") {
      p.revision += 1;
    } else {
      p.fallidas += 1;
    }
    emitir();

    // Boleta "a medias": FRENO EN SECO, sin importar si era la última o qué diga el
    // usuario. Hay una ventana abierta con un folio posiblemente REAL; seguir es
    // inseguro. El humano la resuelve (captura/ingresa folio) y re-lanza el resto.
    if (desenlace.estado === "revisar") {
      p.fase = "requiere_revision";
      emitir();
      return p;
    }

    const esUltima = i === items.length - 1;

    // ── Pausa por error: preguntar saltar-y-seguir vs detener ──────────────────
    if (desenlace.estado === "fallida" && !esUltima) {
      p.fase = "pausada";
      emitir();
      const decision = opts.alPausar ? await opts.alPausar("error", snapshot(p)) : "continuar";
      if (decision === "detener") {
        p.fase = "detenida";
        emitir();
        return p;
      }
    }

    // ── Tope de sesión: frenar tras N emisiones exitosas ───────────────────────
    if (!esUltima && emitidasDesdeTope >= config.sessionCap) {
      p.fase = "pausada";
      emitir();
      const decision = opts.alPausar ? await opts.alPausar("tope", snapshot(p)) : "detener";
      if (decision === "detener") {
        p.fase = "detenida";
        emitir();
        return p;
      }
      emitidasDesdeTope = 0; // el usuario decidió seguir: reinicia el conteo del tope
    }

    // ── Cadencia humana antes de la próxima ────────────────────────────────────
    if (!esUltima) {
      if (detenido()) {
        p.fase = "detenida";
        emitir();
        return p;
      }
      p.fase = "esperando";
      emitir();
      await driver.esperar(nextDelayMs(config, rand));
    }
  }

  p.fase = "terminada";
  p.itemActual = null;
  p.subestado = null;
  emitir();
  return p;
}
