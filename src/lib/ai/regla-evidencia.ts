/**
 * REGLAS CON HISTORIAL (Fase 3 del plan del clasificador —
 * docs/plan-clasificador-cirujano-2026-10-03.md). Módulo PURO: solo transiciones.
 *
 * Una regla de usuario se gana la confianza con evidencia, no con un clic:
 *
 *   a_prueba ──(2-3 cartolas emitidas sin corrección)──▶ firme
 *      │  ▲                                                 │
 *      │  └──────────────── corrección ─────────────────────┘
 *      └──(corrección con ≥1 confirmación, o corregidas ≥2 y ≥ confirmadas)──▶ en_disputa
 *   deshecha  = la persona la deshizo en "Lo que aprendí" (activa=false)
 *   huerfana  = se borró la última cartola que la sostenía (la pone un trigger de la base)
 *
 * CONFIRMACIÓN = un DOCUMENTO (cartola) distinto con al menos una boleta emitida (no
 * anulada, no sandbox) del MISMO tipo_dte de la regla, de una propuesta que la regla
 * clasificó y que ninguna persona corrigió. Un lote de 300 filas de la misma cartola = 1.
 * La cuenta la hace la base (evidencia_reglas); acá solo se decide qué hacer con ella.
 * Solo cuentan las confirmaciones POSTERIORES a la última corrección (evidencia_desde):
 * las viejas eran del tipo que la persona acaba de corregir y no pueden re-promoverla.
 *
 * DECISIÓN DEL FUNDADOR (línea base 2026-10-04): las reglas que existían antes de esta
 * fase quedan 'firme' (sin backfill que las degrade). "A prueba" es solo para las nuevas.
 * Las globales (empresa_id null) siempre son 'firme'.
 */

export const ESTADOS_REGLA = ["a_prueba", "firme", "en_disputa", "deshecha", "huerfana"] as const;
export type EstadoRegla = (typeof ESTADOS_REGLA)[number];

export function esEstadoRegla(v: unknown): v is EstadoRegla {
  return typeof v === "string" && (ESTADOS_REGLA as readonly string[]).includes(v);
}

/** Lote máximo que todavía cuenta como "mirado" (la persona pudo ver cada fila). */
export const LOTE_MAX_MIRADO = 25;
/** Canales donde la persona miró la fila (sin importar el tamaño del lote). */
export const CANALES_MIRADOS: readonly string[] = ["check_fila", "check_detalle"];
/** Canales de lote que cuentan como mirados si el lote es chico (≤ LOTE_MAX_MIRADO). */
export const CANALES_LOTE_HUMANO: readonly string[] = ["check_lote", "aprobar_cartola"];

/** Confirmaciones para pasar a firme: 2 si alguna vino mirada, 3 si todas a ciegas. */
export const CONFIRMACIONES_FIRME_MIRADA = 2;
export const CONFIRMACIONES_FIRME_CIEGA = 3;

/** Techo de confianza de una fila que nace de una regla a prueba: bulk-elegible, nunca "listo" solo. */
export const CONFIANZA_MAX_A_PRUEBA = 0.8;
/** Techo de una fila que nace de una regla en disputa: bajo el bulk (por decidir). */
export const CONFIANZA_MAX_EN_DISPUTA = 0.5;

/** ¿Este evento del log (propuesta_decisiones) fue una decisión MIRADA? Espejo del SQL de evidencia_reglas. */
export function esDecisionMirada(ev: { canal: string | null | undefined; lote_n?: number | null }): boolean {
  if (!ev.canal) return false;
  if (CANALES_MIRADOS.includes(ev.canal)) return true;
  return CANALES_LOTE_HUMANO.includes(ev.canal) && ev.lote_n != null && ev.lote_n <= LOTE_MAX_MIRADO;
}

export function umbralFirme(algunaMirada: boolean): number {
  return algunaMirada ? CONFIRMACIONES_FIRME_MIRADA : CONFIRMACIONES_FIRME_CIEGA;
}

/** Más correcciones que aciertos (y al menos 2): la regla no sabe lo que dice. */
export function enDisputaPorCorrecciones(corregidas: number, confirmadas: number): boolean {
  return corregidas >= 2 && corregidas >= confirmadas;
}

export interface ReglaConHistorial {
  /** null = regla global (seed): siempre firme, la evidencia no la mueve. */
  empresa_id: string | null;
  estado: EstadoRegla | string | null | undefined;
  tipo_dte: number | null;
  veces_confirmada: number | null | undefined;
  veces_corregida: number | null | undefined;
  aprendida_bajo_marca?: boolean | null;
}

export interface EvidenciaRegla {
  /** Documentos distintos que la confirman (ver cabecera). */
  confirmadas: number;
  /** De ésos, cuántos tuvieron al menos una decisión mirada. */
  confirmadasMiradas: number;
}

function estadoDe(r: ReglaConHistorial): EstadoRegla {
  // Una fila sin estado (no debería pasar: la columna es NOT NULL) se trata como las
  // existentes: firme. Nunca la degradamos por no saber.
  return esEstadoRegla(r.estado) ? r.estado : "firme";
}

export interface RecalculoRegla {
  estado: EstadoRegla;
  veces_confirmada: number;
  /** true si cambió el estado o el contador (hay que escribir). */
  cambio: boolean;
}

/**
 * Estado DERIVADO de la evidencia (cron nocturno + al abrir "Lo que aprendí").
 *  - global → firme; deshecha/huerfana → no se tocan (las decide una persona / la base).
 *  - en_disputa es pegajosa: la resuelve una persona (Deshacer o corregir).
 *  - correcciones ≥2 y ≥ confirmadas → en_disputa (vale también para una firme).
 *  - a_prueba con confirmaciones ≥ umbral (2 mirada / 3 ciega) → firme.
 *  - una firme NUNCA baja por falta de confirmaciones (decisión del fundador).
 */
export function recalcularEstado(r: ReglaConHistorial, ev: EvidenciaRegla): RecalculoRegla {
  const antes = estadoDe(r);
  const confirmadas = Math.max(0, Math.floor(ev.confirmadas || 0));
  const miradas = Math.max(0, Math.floor(ev.confirmadasMiradas || 0));
  const corregidas = Math.max(0, r.veces_corregida ?? 0);
  let estado: EstadoRegla = antes;
  if (r.empresa_id == null) estado = "firme";
  else if (antes === "deshecha" || antes === "huerfana" || antes === "en_disputa") estado = antes;
  else if (enDisputaPorCorrecciones(corregidas, confirmadas)) estado = "en_disputa";
  else if (antes === "a_prueba" && confirmadas >= umbralFirme(miradas > 0)) estado = "firme";
  const vecesConfirmada = r.empresa_id == null ? (r.veces_confirmada ?? 0) : confirmadas;
  return {
    estado,
    veces_confirmada: vecesConfirmada,
    cambio: estado !== antes || vecesConfirmada !== (r.veces_confirmada ?? 0),
  };
}

export type EfectoCorreccion = "ninguno" | "baja_a_prueba" | "se_da_vuelta" | "en_disputa" | "suma";

export interface ResultadoCorreccion {
  /** Toda corrección efectiva reinicia la ventana de evidencia (evidencia_desde = ahora). */
  efecto: EfectoCorreccion;
  estado: EstadoRegla;
  tipo_dte: number | null;
  veces_corregida: number;
  aprendida_bajo_marca: boolean;
}

/**
 * Una persona cambió el tipo_dte de una propuesta que esta regla clasificó (una vez por
 * regla y acción, no por fila). La corrección BAJA de nivel; no pisa el tipo de una
 * regla con historial:
 *  - mismo tipo que la regla, regla global, deshecha o huérfana → nada.
 *  - firme SIN confirmaciones → a_prueba (el tipo NO cambia).
 *  - firme CON confirmaciones → en_disputa (sin tipo: el clasificador no lo estampa).
 *    Antes bajaba a a_prueba con el tipo viejo y las confirmaciones viejas la volvían
 *    a firme sola (revisión adversarial 2026-10-04, B1).
 *  - a_prueba sin confirmaciones → se da vuelta al tipo nuevo (sigue a prueba).
 *  - a_prueba con ≥1 confirmación → en_disputa.
 *  - en_disputa → sigue en disputa (suma la corrección).
 *  - y siempre: corregidas ≥2 y ≥ confirmadas → en_disputa (gana sobre lo anterior).
 * `confirmadas` = evidencia VIVA de la regla en el momento de corregir.
 */
export function aplicarCorreccion(
  r: ReglaConHistorial,
  c: { tipoNuevo: number; confirmadas: number },
): ResultadoCorreccion {
  const antes = estadoDe(r);
  const base: ResultadoCorreccion = {
    efecto: "ninguno",
    estado: antes,
    tipo_dte: r.tipo_dte,
    veces_corregida: r.veces_corregida ?? 0,
    aprendida_bajo_marca: r.aprendida_bajo_marca === true,
  };
  if (r.empresa_id == null || antes === "deshecha" || antes === "huerfana") return base;
  if (r.tipo_dte == null || r.tipo_dte === c.tipoNuevo) return base;

  const confirmadas = Math.max(0, Math.floor(c.confirmadas || 0));
  const corregidas = (r.veces_corregida ?? 0) + 1;
  if (enDisputaPorCorrecciones(corregidas, confirmadas) || antes === "en_disputa" || confirmadas >= 1) {
    return { ...base, efecto: antes === "en_disputa" ? "suma" : "en_disputa", estado: "en_disputa", veces_corregida: corregidas };
  }
  if (antes === "firme") {
    return { ...base, efecto: "baja_a_prueba", estado: "a_prueba", veces_corregida: corregidas };
  }
  // a_prueba sin confirmaciones: la persona sabe más que la regla → se da vuelta.
  return {
    efecto: "se_da_vuelta",
    estado: "a_prueba",
    tipo_dte: c.tipoNuevo,
    veces_corregida: corregidas,
    // La señal "Afecta confirmada en la marca P2P" era del tipo viejo.
    aprendida_bajo_marca: false,
  };
}

/** Nombre de una regla aprendida: SIN el tercero (privacidad). */
export function nombreReglaAprendida(tipoDte: number | null | undefined): string {
  if (tipoDte === 41 || tipoDte === 34) return "Contraparte aprendida · Exenta";
  if (tipoDte === 39 || tipoDte === 33) return "Contraparte aprendida · Afecta";
  return "Contraparte aprendida";
}

/** Estado en palabras para "Lo que aprendí" (idioma de la clienta). */
export function estadoEnPalabras(estado: EstadoRegla | string | null | undefined): string {
  switch (estado) {
    case "a_prueba": return "Aprendiendo";
    case "firme": return "Segura";
    case "en_disputa": return "No estoy seguro";
    case "deshecha": return "Deshecha";
    case "huerfana": return "Sin cartola";
    default: return "Segura";
  }
}
