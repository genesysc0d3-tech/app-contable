/**
 * REGLAS CON HISTORIAL (Fase 3 del plan del clasificador —
 * docs/plan-clasificador-cirujano-2026-10-03.md). Módulo PURO: solo transiciones.
 *
 * Una regla de usuario se gana la confianza con evidencia, no con un clic:
 *
 *   a_prueba ──(2-3 cartolas emitidas sin corrección)──▶ firme
 *   corrección SIN evidencia (a_prueba o firme)   → se da vuelta al tipo nuevo (a_prueba)
 *   corrección CON evidencia, mirada o 2ª en la ventana → en_disputa (sin tipo)
 *   corrección CON evidencia, a ciegas (lote > 25), 1ª  → nada cambia (suma la corrección)
 *   en_disputa + la MISMA elección mirada 2 veces seguidas → sale con ese tipo (a_prueba)
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
  /** Historia completa de correcciones (contador, nunca se reinicia). */
  veces_corregida: number | null | undefined;
  /** Correcciones dentro de la ventana de evidencia actual (se reinicia con ella). */
  corregidas_en_ventana?: number | null;
  /** En disputa: la última elección mirada de la persona y cuántas veces seguidas. */
  disputa_eleccion?: number | null;
  disputa_racha?: number | null;
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
 *  - correcciones EN LA VENTANA ≥2 y ≥ confirmadas → en_disputa (también una firme).
 *  - a_prueba con confirmaciones ≥ umbral (2 mirada / 3 ciega) → firme.
 *  - una firme NUNCA baja por falta de confirmaciones (decisión del fundador).
 */
export function recalcularEstado(r: ReglaConHistorial, ev: EvidenciaRegla): RecalculoRegla {
  const antes = estadoDe(r);
  const confirmadas = Math.max(0, Math.floor(ev.confirmadas || 0));
  const miradas = Math.max(0, Math.floor(ev.confirmadasMiradas || 0));
  const corregidas = Math.max(0, r.corregidas_en_ventana ?? 0);
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

export type EfectoCorreccion = "ninguno" | "se_da_vuelta" | "en_disputa" | "sale_de_disputa" | "suma";

export interface ResultadoCorreccion {
  efecto: EfectoCorreccion;
  estado: EstadoRegla;
  tipo_dte: number | null;
  veces_corregida: number;
  corregidas_en_ventana: number;
  disputa_eleccion: number | null;
  disputa_racha: number;
  aprendida_bajo_marca: boolean;
  /** La ventana de evidencia vuelve a empezar (evidencia_desde = ahora, confirmadas 0). */
  reiniciaVentana: boolean;
}

/** Elecciones miradas seguidas e iguales que sacan a una regla de la disputa. */
export const RACHA_SALE_DE_DISPUTA = 2;

/**
 * Una persona cambió en Check el tipo que la regla le MOSTRÓ en una fila (una vez por
 * regla y acción, no por fila; el llamador ya descartó filas con tipo forzado por el
 * emisor o por conflicto con la marca de la cartola). Producto (fundador, 2026-10-04):
 * la corrección no puede volver más torpe a una regla que hoy aprende al tiro.
 *  - global, deshecha o huérfana → nada.
 *  - en_disputa: cada elección MIRADA arma una racha; la MISMA elección
 *    RACHA_SALE_DE_DISPUTA veces seguidas → sale con ese tipo, a_prueba, ventana nueva.
 *    Una elección a ciegas solo suma la corrección (no rompe ni arma la racha).
 *  - mismo tipo que la regla (o regla sin tipo) → nada.
 *  - SIN evidencia en la ventana (a_prueba o firme) → se da vuelta al tipo nuevo,
 *    a_prueba, ventana nueva (como hoy en prod: la regla sigue a la persona).
 *  - CON evidencia: en_disputa (sin tipo estampado) si la corrección fue MIRADA
 *    (check_fila/check_detalle o lote ≤ 25) o es la 2ª corrección dentro de la ventana;
 *    una 1ª corrección a ciegas (lote > 25) NO la mueve: suma y sigue igual.
 * `confirmadas` = evidencia VIVA de la regla dentro de su ventana.
 */
export function aplicarCorreccion(
  r: ReglaConHistorial,
  c: { tipoNuevo: number; confirmadas: number; mirada: boolean },
): ResultadoCorreccion {
  const antes = estadoDe(r);
  const base: ResultadoCorreccion = {
    efecto: "ninguno",
    estado: antes,
    tipo_dte: r.tipo_dte,
    veces_corregida: r.veces_corregida ?? 0,
    corregidas_en_ventana: r.corregidas_en_ventana ?? 0,
    disputa_eleccion: r.disputa_eleccion ?? null,
    disputa_racha: r.disputa_racha ?? 0,
    aprendida_bajo_marca: r.aprendida_bajo_marca === true,
    reiniciaVentana: false,
  };
  if (r.empresa_id == null || antes === "deshecha" || antes === "huerfana") return base;
  const corregidas = base.veces_corregida + 1;

  if (antes === "en_disputa") {
    if (!c.mirada) return { ...base, efecto: "suma", veces_corregida: corregidas, corregidas_en_ventana: base.corregidas_en_ventana + 1 };
    const racha = base.disputa_eleccion === c.tipoNuevo ? base.disputa_racha + 1 : 1;
    if (racha >= RACHA_SALE_DE_DISPUTA) {
      return {
        ...base, efecto: "sale_de_disputa", estado: "a_prueba", tipo_dte: c.tipoNuevo, veces_corregida: corregidas,
        corregidas_en_ventana: 0, disputa_eleccion: null, disputa_racha: 0,
        aprendida_bajo_marca: c.tipoNuevo === r.tipo_dte ? base.aprendida_bajo_marca : false, reiniciaVentana: true,
      };
    }
    return { ...base, efecto: "suma", veces_corregida: corregidas, corregidas_en_ventana: base.corregidas_en_ventana + 1, disputa_eleccion: c.tipoNuevo, disputa_racha: racha };
  }

  if (r.tipo_dte == null || r.tipo_dte === c.tipoNuevo) return base;
  const confirmadas = Math.max(0, Math.floor(c.confirmadas || 0));
  const enVentana = base.corregidas_en_ventana + 1;
  if (confirmadas === 0) {
    // Sin evidencia: la persona sabe más que la regla → se da vuelta (y la señal "Afecta
    // confirmada en la marca P2P" era del tipo viejo).
    return {
      ...base, efecto: "se_da_vuelta", estado: "a_prueba", tipo_dte: c.tipoNuevo, veces_corregida: corregidas,
      corregidas_en_ventana: 0, aprendida_bajo_marca: false, reiniciaVentana: true,
    };
  }
  if (c.mirada || enVentana >= 2) {
    return {
      ...base, efecto: "en_disputa", estado: "en_disputa", veces_corregida: corregidas,
      corregidas_en_ventana: enVentana, disputa_eleccion: null, disputa_racha: 0, reiniciaVentana: true,
    };
  }
  return { ...base, efecto: "suma", veces_corregida: corregidas, corregidas_en_ventana: enVentana };
}

/**
 * ¿Esta fila corrige a la regla? Se compara contra lo que la regla le MOSTRÓ a la
 * clienta en la fila (su tipo_dte), no contra el tipo guardado en la regla: una fila
 * cuyo tipo no era el de la regla (lo forzó el emisor exento, lo cambió antes una
 * persona…) no habla de la regla. En disputa la regla no estampa tipo: cualquier
 * elección cuenta (arma la racha para salir).
 */
export function esCorreccionDeRegla(
  r: Pick<ReglaConHistorial, "estado" | "tipo_dte">,
  f: { tipoFila: number | null | undefined; tipoNuevo: number },
): boolean {
  if (r.estado === "en_disputa") return f.tipoFila == null || f.tipoFila === r.tipo_dte;
  return r.tipo_dte != null && f.tipoFila === r.tipo_dte && f.tipoNuevo !== f.tipoFila;
}

/** Lo que la clienta ve en Check cuando su corrección le cambió el estado a una regla. */
export function avisoCorreccion(efecto: EfectoCorreccion, contraparte: string | null | undefined, tipoDte: number | null | undefined): string | null {
  const quien = contraparte?.trim() || "esa contraparte";
  const tipo = tipoDte === 41 ? "Exenta" : tipoDte === 39 ? "Afecta" : null;
  if ((efecto === "se_da_vuelta" || efecto === "sale_de_disputa") && tipo) return `Aprendí: desde ahora ${quien} va como ${tipo}.`;
  if (efecto === "en_disputa") return `Ya no estoy seguro de ${quien}: te lo voy a preguntar.`;
  return null;
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
