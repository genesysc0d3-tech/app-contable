import type { ConfigEmision } from "@/lib/intermediario/client";
import { providerForTipoDte } from "@/lib/intermediario/client";

const DEFAULT_BASE_URL = "https://api.simpleapi.cl/api/v1";
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_SECRET_FILE_BYTES = 8 * 1024 * 1024;
const DTE_GENERAR_PATH = "dte/generar";
const REDACTED = "[redacted]";
const SENSITIVE_KEY_PATTERN = /(?:password|clave|certificado|certificate|pfx|caf|files?2?|secret|private[_-]?key|api[_-]?key|token)/i;

export type SimpleApiProxyError = {
  ok: false;
  status: number;
  error: string;
  detalle?: string;
};

export type SimpleApiProxySuccess = {
  ok: true;
  input: string;
  pfx: File;
  caf: File;
  tipoDte: number;
  folio: number | null;
};

export type SimpleApiProxyPayload = SimpleApiProxySuccess | SimpleApiProxyError;

export function simpleApiConfigured(): boolean {
  return Boolean(process.env.SIMPLEAPI_API_KEY?.trim());
}

export function simpleApiBaseUrl(): string {
  return (process.env.SIMPLEAPI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function simpleApiEndpoint(path = DTE_GENERAR_PATH): string {
  const safePath = path.replace(/^\/+/, "");
  return `${simpleApiBaseUrl()}/${safePath}`;
}

export function simpleApiAuthHeaders(): Record<string, string> | SimpleApiProxyError {
  const apiKey = process.env.SIMPLEAPI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      error: "SIMPLEAPI_API_KEY_MISSING",
      detalle: "Falta configurar SIMPLEAPI_API_KEY en el backend.",
    };
  }

  const headerName = process.env.SIMPLEAPI_AUTH_HEADER?.trim() || "Authorization";
  const prefix = process.env.SIMPLEAPI_AUTH_PREFIX ?? "";
  return { [headerName]: `${prefix}${apiKey}` };
}

export function isSimpleApiProxyError(value: Record<string, string> | SimpleApiProxyError): value is SimpleApiProxyError {
  return "ok" in value && value.ok === false;
}

export function parseSimpleApiMultipart(formData: FormData): SimpleApiProxyPayload {
  const inputValue = formData.get("input");
  if (typeof inputValue !== "string" || !inputValue.trim()) {
    return { ok: false, status: 400, error: "INPUT_REQUIRED", detalle: "El multipart debe incluir el campo input como JSON." };
  }
  if (new TextEncoder().encode(inputValue).byteLength > MAX_INPUT_BYTES) {
    return { ok: false, status: 413, error: "INPUT_TOO_LARGE", detalle: "El JSON input supera el tamaño permitido." };
  }

  const pfx = formData.get("files");
  const caf = formData.get("files2");
  if (!(pfx instanceof File) || pfx.size <= 0) {
    return { ok: false, status: 400, error: "PFX_REQUIRED", detalle: "El multipart debe incluir el certificado PFX en files." };
  }
  if (!(caf instanceof File) || caf.size <= 0) {
    return { ok: false, status: 400, error: "CAF_REQUIRED", detalle: "El multipart debe incluir el CAF XML en files2." };
  }
  if (pfx.size > MAX_SECRET_FILE_BYTES) {
    return { ok: false, status: 413, error: "PFX_TOO_LARGE", detalle: "El certificado PFX supera el tamaño permitido." };
  }
  if (caf.size > MAX_SECRET_FILE_BYTES) {
    return { ok: false, status: 413, error: "CAF_TOO_LARGE", detalle: "El CAF XML supera el tamaño permitido." };
  }

  const tipoDte = extractTipoDte(inputValue);
  if (!tipoDte) {
    return { ok: false, status: 422, error: "TIPO_DTE_REQUIRED", detalle: "No se pudo detectar TipoDTE en input." };
  }

  return { ok: true, input: inputValue, pfx, caf, tipoDte, folio: extractFolio(inputValue) };
}

export function simpleApiAllowedForTipo(config: ConfigEmision, tipoDte: number): boolean {
  return providerForTipoDte(config, tipoDte) === "simpleapi";
}

export function buildSimpleApiGenerarForm(payload: SimpleApiProxySuccess): FormData {
  const upstream = new FormData();
  upstream.set("input", payload.input);
  upstream.set("files", payload.pfx, payload.pfx.name || "certificado.pfx");
  upstream.set("files2", payload.caf, payload.caf.name || "caf.xml");
  return upstream;
}

export function sanitizeSimpleApiResponse(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>());
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (!value || typeof value !== "object") return value;

  if (seen.has(value)) return REDACTED;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    sanitized[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeValue(nested, seen);
  }
  return sanitized;
}

function sanitizeString(value: string): string {
  return value
    .replace(/("(?:password|clave|certificado|certificate|pfx|caf|files?2?|secret|private[_-]?key|api[_-]?key|token)"\s*:\s*")([^"]*)(")/gi, `$1${REDACTED}$3`)
    .replace(/(<(?:Password|Clave|Certificado|Certificate|PFX|CAF|Secret|PrivateKey|ApiKey|Token)>)([\s\S]*?)(<\/\s*(?:Password|Clave|Certificado|Certificate|PFX|CAF|Secret|PrivateKey|ApiKey|Token)>)/gi, `$1${REDACTED}$3`);
}

function extractTipoDte(input: string): number | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    return findTipoDte(parsed);
  } catch {
    return null;
  }
}

function extractFolio(input: string): number | null {
  try {
    const parsed = JSON.parse(input) as unknown;
    return findFolio(parsed);
  } catch {
    return null;
  }
}

function findTipoDte(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTipoDte(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["TipoDTE", "TipoDte", "tipoDTE", "tipo_dte", "tipoDte"]) {
    const raw = record[key];
    const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isInteger(numeric) && numeric > 0) return numeric;
  }

  for (const nested of Object.values(record)) {
    const found = findTipoDte(nested);
    if (found) return found;
  }
  return null;
}

function findFolio(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFolio(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["Folio", "folio"]) {
    const raw = record[key];
    const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isSafeInteger(numeric) && numeric > 0) return numeric;
  }

  for (const nested of Object.values(record)) {
    const found = findFolio(nested);
    if (found) return found;
  }
  return null;
}
