/**
 * Chokepoint de salida de IA (Ley 21.719) — primitivas de privacidad.
 *
 * Dos controles, ambos puros y testeables:
 *  1) redactForAI / clienteToken: MINIMIZACIÓN (Art. 3) — antes de mandar texto a
 *     una IA, se enmascara RUT, números de cuenta y nombres de persona, y la
 *     identidad del receptor se reemplaza por un token estable no reversible
 *     ("mismo cliente" sin exponer quién).
 *  2) assertApprovedDataProcessor: gate FAIL-CLOSED (Art. 15 bis, encargado) —
 *     solo procesadores con DPA / retención cero verificada pueden recibir datos
 *     personales; lo desconocido se rechaza.
 *
 * Diseñado para F3 (2ª opinión) y cualquier ruta nueva que mande datos a una IA
 * externa. NO reemplaza al clasificador interno (que necesita la glosa cruda).
 */

// Bloques base de la calibración PII (fuente única). tokenize.ts los reusa para
// componer sus regex — cambiar acá cambia redacción Y tokenización a la vez, sin
// riesgo de que diverjan. Los RE de abajo se rearman idénticos a los originales.
const PREP_SRC = "(?:a|de|para|por)";
const NAME_SRC = "[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)+";
const RUT_SRC = "\\d{1,2}\\.?\\d{3}\\.?\\d{3}-[\\dkK]";
export const PII_SRC = { PREP: PREP_SRC, NAME: NAME_SRC, RUT: RUT_SRC } as const;

const RUT_RE = new RegExp(`\\b${RUT_SRC}\\b`, "g");
// Nº de cuenta / secuencias largas de dígitos (8+).
const CUENTA_RE = /\b\d{8,}\b/g;
// Nombre de persona tras preposición: 2+ palabras Capitalizadas (evita pisar
// keywords de una palabra como "Binance" o all-caps como "USDT").
const NOMBRE_RE = new RegExp(`\\b(${PREP_SRC})\\s+${NAME_SRC}`, "g");

/** Enmascara RUT, números de cuenta y nombres de persona de un texto. */
export function redactForAI(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(RUT_RE, "[RUT]")
    .replace(NOMBRE_RE, (_m, prep: string) => `${prep} [NOMBRE]`)
    .replace(CUENTA_RE, "[NUM]");
}

/**
 * ¿Minimización PII activa hacia el LLM? (auditoría #26). Env AI_REDACT_PII=1.
 * Default OFF: el clasificador interno necesita la glosa/RUT crudos y su exactitud
 * está validada bit-a-bit con datos reales — prender esto exige re-validar. Queda
 * en código como interruptor para beta sin cambios grandes con clientes ya activos.
 */
export function redactPiiHabilitado(): boolean {
  return process.env.AI_REDACT_PII === "1";
}

/**
 * Enmascara el cuerpo de un RUT dejando solo los últimos 3 dígitos + verificador
 * (traza suficiente, no reversible a la identidad). "18.512.171-2" → "••.•••.171-2".
 */
export function maskRut(rut: string | null | undefined): string {
  const s = String(rut ?? "").trim();
  if (!s) return s;
  const m = s.match(/(\d{1,3})-([\dkK])$/);
  if (!m) return "[RUT]";
  return `••.•••.${m[1].padStart(3, "0")}-${m[2]}`;
}

/** Token estable y NO reversible (FNV-1a) para agrupar "mismo cliente" sin exponer identidad. */
export function clienteToken(seed: string | null | undefined): string {
  const s = String(seed ?? "").trim().toLowerCase();
  if (!s) return "anon";
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return "c" + (h >>> 0).toString(36);
}

// Allowlist de procesadores aprobados como encargados con RETENCIÓN CERO (DPA
// verificado, en el RAT). Formato "<provider>:<model>". Fail-closed.
const PROCESADORES_APROBADOS = new Set<string>([
  "opencodego:deepseek-v4-flash",
  "opencodego:minimax-m3",
]);

/**
 * Lanza si el procesador no está en la allowlist de retención cero. Úsalo ANTES
 * de mandar datos personales a una IA externa (RUT, montos, nombres).
 */
export function assertApprovedDataProcessor(provider: string, model: string): void {
  const key = `${(provider || "").trim().toLowerCase()}:${(model || "").trim().toLowerCase()}`;
  if (!PROCESADORES_APROBADOS.has(key)) {
    throw new Error(
      `PROCESADOR_NO_APROBADO: "${key}" no está en la allowlist de encargados con retención cero. ` +
        `Datos personales solo pueden ir a un procesador con DPA/zero-retention verificado (Ley 21.719).`,
    );
  }
}

/** Payload mínimo y seudonimizado de una propuesta para una 2ª opinión (F3). */
export function payloadSeguroParaIA(p: {
  id: string;
  descripcion: string | null;
  total: number;
  fecha: string;
  tipoDte: 39 | 41 | null;
  receptorNombre?: string | null;
  receptorRut?: string | null;
}): { ref: string; glosa: string; monto: number; fecha: string; tipo: string; cliente: string } {
  return {
    ref: p.id.slice(0, 8),
    glosa: redactForAI(p.descripcion),
    monto: Math.round(p.total),
    fecha: p.fecha,
    tipo: p.tipoDte === 39 ? "afecta" : p.tipoDte === 41 ? "exenta" : "indef",
    // identidad → token (nunca el RUT/nombre real)
    cliente: clienteToken(p.receptorRut || p.receptorNombre || null),
  };
}
