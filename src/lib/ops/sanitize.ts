import type { Json } from "@/lib/database.types";

const SENSITIVE_KEY_RE = /(authorization|cookie|token|secret|password|passwd|clave|api[_-]?key|service[_-]?role|cert|certificate|private[_-]?key|base64|xml|pdf|prompt|response|raw|payload|html)/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const RUT_RE = /\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b/g;
// Sin anclas: un token no siempre viene solo. `Invalid JWT: eyJhbGci…` traía
// la credencial entera en medio de una frase y pasaba de largo.
const LONG_BASE64_RE = /[A-Za-z0-9+/_-]{60,}={0,2}/g;
// Un JWT viene partido en tres por puntos, y cada trozo puede ser corto: la
// regla de arriba redactaba el medio y dejaba la cabecera intacta. Empiezan
// con `eyJ` porque es el base64 de `{"`. Va PRIMERO, para tomarlo entero.
const JWT_RE = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g;
// Una URL en un mensaje de error trae host, ruta y a veces la firma completa.
const URL_RE = /\bhttps?:\/\/\S+/gi;
// Rutas de Storage tipo `{empresa_id}/{uuid}/cartola-santander.xlsx`: el nombre
// del archivo que subió el cliente es dato suyo, no del sistema.
const PATH_RE = /\b[\w-]{6,}\/[\w-]{8,}\/\S+/g;

const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_ITEMS = 8;
const MAX_OBJECT_KEYS = 24;
const MAX_DEPTH = 4;

function maskEmail(value: string) {
  return value.replace(EMAIL_RE, (email) => {
    const [name, domain] = email.split("@");
    if (!name || !domain) return "[email]";
    return `${name.slice(0, 2)}***@${domain}`;
  });
}

function maskRut(value: string) {
  return value.replace(RUT_RE, (rut) => {
    const clean = rut.replace(/\./g, "");
    return `${clean.slice(0, 2)}***-${clean.slice(-1)}`;
  });
}

/**
 * Limpia un texto antes de que llegue a `ops_events` — y de ahí al panel del
 * operador, al webhook y a Telegram.
 *
 * El orden importa: primero URL y rutas (que pueden CONTENER un correo o un
 * token), después el token suelto, y al final correo y RUT sobre lo que quede.
 */
export function sanitizeString(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  let safe = trimmed
    .replace(URL_RE, "[url]")
    .replace(JWT_RE, "[token]")
    .replace(PATH_RE, "[ruta]")
    .replace(LONG_BASE64_RE, (t) => `[redacted:${t.length}]`);
  safe = maskRut(maskEmail(safe));
  if (safe.length > MAX_STRING_LENGTH) safe = `${safe.slice(0, MAX_STRING_LENGTH)}...[truncated:${safe.length}]`;
  return safe;
}

function toJson(value: unknown, depth: number): Json {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `[truncated:array:${value.length}]`;
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => toJson(item, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return "[truncated:object]";

    const output: Record<string, Json> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
      const cleanKey = sanitizeString(key).replace(/[^a-z0-9_.:-]+/gi, "_").slice(0, 80) || "key";
      output[cleanKey] = SENSITIVE_KEY_RE.test(key) ? `[redacted:${typeof raw}]` : toJson(raw, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function sanitizeOpsMetadata(metadata: Record<string, unknown> = {}): Record<string, Json> {
  const sanitized = toJson(metadata, 0);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized as Record<string, Json>
    : {};
}

export function errorMetadata(error: unknown): Record<string, Json> {
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: sanitizeString(error.message),
    };
  }
  return { error_message: sanitizeString(String(error)) };
}
