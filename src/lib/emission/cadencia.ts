// Cadencia del motor masivo de emisión (MassDTE).
//
// El motor emite N boletas REALES en el SII, una tras otra, en la misma ventana
// segura. El SII no tiene una API de emisión de boletas para el contribuyente
// común: automatizamos su portal. Un ritmo de reloj —"cada 5.000 ms exactos"— es
// el patrón más delatador de un bot. La defensa es emitir como un HUMANO MUY
// EFICIENTE: pausas cortas pero SIEMPRE distintas (jitter aleatorio), con alguna
// pausa larga ocasional (el humano se distrae, lee, toma café), y un TOPE de
// boletas por sesión como freno de seguridad (el umbral real del SII es empírico
// y desconocido — arrancamos conservadores y se afloja con datos reales).
//
// Este módulo es PURO y OFFLINE: no emite nada, no toca red ni reloj global. La
// aleatoriedad entra por `rand()` inyectable para que los tests sean
// deterministas (nunca `Math.random()` adentro de la lógica).

export interface CadenciaConfig {
  /** Piso de espera entre una boleta y la siguiente (ms). */
  baseMs: number;
  /** Rango aleatorio que se SUMA al piso: la espera normal cae en [base, base+jitter]. */
  jitterMs: number;
  /** Probabilidad [0,1] de intercalar una pausa larga (humano que se distrae). */
  longPauseChance: number;
  /** Rango de la pausa larga (ms). */
  longPauseMinMs: number;
  longPauseMaxMs: number;
  /**
   * Tope de boletas emitidas por corrida. Al alcanzarlo el orquestador PAUSA y
   * pide gesto humano para seguir — no es un límite duro del SII (que no
   * publicamos), es un freno conservador para no dibujar una ráfaga sospechosa.
   */
  sessionCap: number;
}

// Perfil por defecto: "humano muy eficiente". La emisión en sí (login cacheado,
// calculadora, modal, EMITIR, captura del folio) ya aporta ~15–30 s de
// separación natural entre boletas; la cadencia solo AGREGA varianza humana
// encima, no espera de más. Números conservadores, ajustables con evidencia.
export const CADENCIA_DEFAULT: CadenciaConfig = {
  baseMs: 2_500,
  jitterMs: 3_500, // espera normal ∈ [2,5 s, 6 s]
  longPauseChance: 0.12, // ~1 de cada 8
  longPauseMinMs: 12_000,
  longPauseMaxMs: 45_000, // pausa larga ∈ [12 s, 45 s]
  sessionCap: 40,
};

/**
 * Espera (ms) ANTES de emitir la próxima boleta. `rand` devuelve [0,1); se
 * inyecta para tests. Consume dos tiradas: una decide si toca pausa larga, otra
 * fija la magnitud dentro del rango elegido.
 */
export function nextDelayMs(config: CadenciaConfig = CADENCIA_DEFAULT, rand: () => number = Math.random): number {
  const tirada = rand();
  const magnitud = rand();
  if (tirada < config.longPauseChance) {
    const span = Math.max(0, config.longPauseMaxMs - config.longPauseMinMs);
    return Math.round(config.longPauseMinMs + magnitud * span);
  }
  return Math.round(config.baseMs + magnitud * Math.max(0, config.jitterMs));
}

/**
 * Estimación del tiempo SOLO DE PAUSAS para n boletas (la emisión en sí no se
 * cuenta acá — su duración la pone el SII y es variable). Sirve para el hint de
 * UI "esto va a tomar ~X". Devuelve el rango y el valor esperado.
 */
export function estimateWaitMs(n: number, config: CadenciaConfig = CADENCIA_DEFAULT): { minMs: number; maxMs: number; expectedMs: number } {
  // Entre n boletas hay n-1 esperas.
  const huecos = Math.max(0, n - 1);
  const esperaNormalMedia = config.baseMs + Math.max(0, config.jitterMs) / 2;
  const pausaLargaMedia = (config.longPauseMinMs + config.longPauseMaxMs) / 2;
  // Valor esperado: mezcla ponderada por la probabilidad de pausa larga.
  const mediaHueco = (1 - config.longPauseChance) * esperaNormalMedia + config.longPauseChance * pausaLargaMedia;
  return {
    minMs: huecos * config.baseMs, // caso sin ninguna pausa larga
    maxMs: huecos * config.longPauseMaxMs, // caso patológico: todas largas
    expectedMs: Math.round(huecos * mediaHueco),
  };
}
