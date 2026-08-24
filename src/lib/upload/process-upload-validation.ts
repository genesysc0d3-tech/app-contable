export type UploadTipo = "excel" | "pdf" | "csv" | "imagen";

export const MAX_PROCESAR_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Tope del contexto escrito. Corto a propósito: un párrafo largo confunde al
 *  modelo más de lo que ayuda, y limita lo que se puede colar por ahí. */
export const MAX_CONTEXTO_CHARS = 300;

const TIPO_CONFIG: Record<UploadTipo, { extensions: string[]; mimes: string[]; defaultMime: string }> = {
  excel: {
    extensions: ["xls", "xlsx"],
    mimes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    defaultMime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  pdf: {
    extensions: ["pdf"],
    mimes: ["application/pdf"],
    defaultMime: "application/pdf",
  },
  csv: {
    extensions: ["csv"],
    mimes: ["text/csv", "application/csv"],
    defaultMime: "text/csv",
  },
  imagen: {
    extensions: ["jpg", "jpeg", "png", "webp"],
    mimes: ["image/jpeg", "image/png", "image/webp"],
    defaultMime: "image/jpeg",
  },
};

export type ValidatedProcesarUpload = {
  ok: true;
  base64: string;
  bytes: number;
  nombre: string;
  tipo: UploadTipo;
  contentType: string;
  /** Lo que el dueño escribió sobre esta cartola (opcional, recortado). */
  contexto: string | null;
};

export type InvalidProcesarUpload = {
  ok: false;
  error: string;
  status: 400 | 413 | 415 | 422;
};

export function sanitizeUploadFilename(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const lastSegment = input.trim().split(/[\\/]/).filter(Boolean).pop() ?? "";
  const sanitized = lastSegment
    .replace(/[\x00-\x1f\x7f<>:"|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 160);
  return sanitized || null;
}

function extensionFor(nombre: string): string | null {
  const match = nombre.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? null;
}

function normalizeBase64(input: unknown): { ok: true; base64: string; bytes: number } | InvalidProcesarUpload {
  if (typeof input !== "string") return { ok: false, error: "BASE64_REQUERIDO", status: 422 };
  let base64 = input.trim();
  if (base64.startsWith("data:")) {
    const comma = base64.indexOf(",");
    base64 = comma >= 0 ? base64.slice(comma + 1) : "";
  }
  base64 = base64.replace(/\s+/g, "");
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, error: "BASE64_INVALIDO", status: 422 };
  }

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length * 3) / 4 - padding;
  if (bytes <= 0) return { ok: false, error: "ARCHIVO_VACIO", status: 422 };
  if (bytes > MAX_PROCESAR_UPLOAD_BYTES) return { ok: false, error: "ARCHIVO_DEMASIADO_GRANDE", status: 413 };
  return { ok: true, base64, bytes };
}

function normalizeTipo(input: unknown): UploadTipo | null {
  const tipo = typeof input === "string" ? input.trim().toLowerCase() : "excel";
  return tipo in TIPO_CONFIG ? tipo as UploadTipo : null;
}

export function validateProcesarUploadPayload(body: {
  nombre?: unknown;
  base64?: unknown;
  tipo?: unknown;
  mime?: unknown;
  contexto?: unknown;
}): ValidatedProcesarUpload | InvalidProcesarUpload {
  const base64 = normalizeBase64(body.base64);
  if (!base64.ok) return base64;

  const nombre = sanitizeUploadFilename(body.nombre);
  if (!nombre) return { ok: false, error: "NOMBRE_REQUERIDO", status: 422 };

  const tipo = normalizeTipo(body.tipo);
  if (!tipo) return { ok: false, error: "TIPO_NO_PERMITIDO", status: 415 };

  const config = TIPO_CONFIG[tipo];
  const ext = extensionFor(nombre);
  if (ext && !config.extensions.includes(ext)) {
    return { ok: false, error: "EXTENSION_NO_PERMITIDA", status: 415 };
  }

  const mime = typeof body.mime === "string" ? body.mime.trim().toLowerCase() : "";
  if (mime && !config.mimes.includes(mime)) {
    return { ok: false, error: "MIME_NO_PERMITIDO", status: 415 };
  }

  // Contexto: se RECORTA en vez de rechazar. Es opcional y un texto largo no es
  // motivo para no subir la cartola. Los saltos de línea se aplanan porque el
  // texto va a entrar dentro de un bloque del prompt.
  const contextoRaw = typeof body.contexto === "string" ? body.contexto : "";
  const contexto = contextoRaw.replace(/\s+/g, " ").trim().slice(0, MAX_CONTEXTO_CHARS) || null;

  return {
    ok: true,
    base64: base64.base64,
    bytes: base64.bytes,
    nombre,
    tipo,
    contentType: mime || config.defaultMime,
    contexto,
  };
}
