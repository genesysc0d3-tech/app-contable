// Reglas PURAS de los avisos y novedades (2026-10-01). Sin DOM ni red: las usa el
// server (filtro de audiencia), la pantalla (cola) y /dev (validación + vista previa).
//
// El RLS de avisos_app ya filtra vigencia y empresa en la base; acá vive el ESPEJO
// (para no confiar en una caché vieja) y lo que el RLS no puede saber: qué mesa se
// está mirando y con qué versión corre la pestaña.

export type TipoAviso = "novedad" | "mantencion" | "urgente";
export type FormatoAviso = "toast" | "tarjeta" | "popup";
export type MesaAviso = "boletas" | "facturas";

export const TIPOS: readonly TipoAviso[] = ["novedad", "mantencion", "urgente"];
export const FORMATOS: readonly FormatoAviso[] = ["toast", "tarjeta", "popup"];
export const MESAS: readonly MesaAviso[] = ["boletas", "facturas"];

/** Lo que viaja al navegador (sin activo/creado_por: no le importan a la clienta). */
export interface AvisoApp {
  id: string;
  tipo: TipoAviso;
  titulo: string;
  cuerpo: string;
  formato: FormatoAviso;
  desde: string;
  hasta: string;
  empresa_ids: string[] | null;
  mesa: MesaAviso | null;
  version_min: string | null;
  created_at: string | null;
}

/** El toast se cierra solo a los 8 s (también cuenta como visto). */
export const TOAST_MS = 8_000;
export const TITULO_MAX = 120;
export const CUERPO_MAX = 600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function esUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Vive en [desde, hasta). Fechas rotas = no vigente (no se muestra). */
export function avisoVigente(a: Pick<AvisoApp, "desde" | "hasta">, now: Date | number): boolean {
  const t = typeof now === "number" ? now : now.getTime();
  const d = Date.parse(a.desde);
  const h = Date.parse(a.hasta);
  if (!Number.isFinite(d) || !Number.isFinite(h)) return false;
  return d <= t && t < h;
}

/** empresa_ids null = todas; con lista, solo la empresa activa si está en ella. */
export function avisoParaEmpresa(a: Pick<AvisoApp, "empresa_ids">, empresaId: string | null): boolean {
  if (a.empresa_ids == null) return true;
  return !!empresaId && a.empresa_ids.includes(empresaId);
}

/** mesa null = en cualquier parte; con mesa, solo mirando esa mesa. */
export function avisoParaMesa(a: Pick<AvisoApp, "mesa">, mesaActual: MesaAviso | null): boolean {
  if (a.mesa == null) return true;
  return a.mesa === mesaActual;
}

const RUTAS_MESA = [/^\/massdte(\/|$)/, /^\/escritorio\/v5(\/|$)/];
/** ¿Qué mesa está mirando? Solo en massDTE; la mesa va en la URL (boleta por defecto). */
export function mesaDeUbicacion(pathname: string, search: string): MesaAviso | null {
  if (!RUTAS_MESA.some((r) => r.test(pathname))) return null;
  const mesa = new URLSearchParams(search).get("mesa");
  return mesa === "factura" ? "facturas" : "boletas";
}

export type VersionPestana = { version: string; builtAt: string | null };
const ISO_RE = /^\d{4}-\d{2}-\d{2}/;

/**
 * "Novedades de esta versión". version_min puede ser:
 *  - una fecha ISO de build → la pestaña construida en esa fecha o después cumple
 *    (las versiones son commits, sin orden: el orden lo da la fecha de build);
 *  - un commit (≥ 7 caracteres) → solo esa versión exacta.
 * Sin versión mínima, siempre. Pestaña sin fecha de build: no (quizás no tiene la novedad).
 */
export function versionCumple(min: string | null | undefined, pestana: VersionPestana): boolean {
  const m = (min ?? "").trim();
  if (!m) return true;
  if (ISO_RE.test(m)) {
    const req = Date.parse(m);
    const built = pestana.builtAt ? Date.parse(pestana.builtAt) : NaN;
    if (!Number.isFinite(req) || !Number.isFinite(built)) return false;
    return built >= req;
  }
  if (m.length < 7) return false;
  return pestana.version === m || pestana.version.startsWith(m);
}

/** Popup SOLO para urgentes: un popup no urgente (dato raro) baja a tarjeta. */
export function formatoEfectivo(a: Pick<AvisoApp, "tipo" | "formato">): FormatoAviso {
  if (a.formato === "popup" && a.tipo !== "urgente") return "tarjeta";
  return a.formato;
}

/** Urgentes primero; después por inicio (lo más antiguo primero); id para desempatar. */
export function ordenarCola<T extends Pick<AvisoApp, "id" | "tipo" | "desde">>(avisos: T[]): T[] {
  return [...avisos].sort((a, b) => {
    const u = Number(b.tipo === "urgente") - Number(a.tipo === "urgente");
    if (u) return u;
    const d = (Date.parse(a.desde) || 0) - (Date.parse(b.desde) || 0);
    if (d) return d;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** ¿La fila que llegó del server tiene forma de aviso? (basura → se ignora). */
export function esAvisoValido(x: unknown): x is AvisoApp {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return typeof a.id === "string" && typeof a.titulo === "string" && typeof a.desde === "string" && typeof a.hasta === "string"
    && (TIPOS as readonly unknown[]).includes(a.tipo) && (FORMATOS as readonly unknown[]).includes(a.formato);
}

// ── Markdown mínimo: **negrita** y [texto](url). Nada de HTML. ──────────────────
export type ParteMd = { t: "texto"; v: string } | { t: "negrita"; v: string } | { t: "link"; v: string; href: string };

/** Solo https/http absolutos o rutas internas "/algo" (no "//host", no javascript:). */
export function hrefSeguro(url: string): boolean {
  if (/^\/(?!\/)/.test(url)) return true;
  return /^https?:\/\/[^\s]+$/i.test(url);
}

const TOKEN_RE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
export function partesMarkdown(texto: string): ParteMd[] {
  const out: ParteMd[] = [];
  const empujarTexto = (v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev && prev.t === "texto") prev.v += v; else out.push({ t: "texto", v });
  };
  let ultimo = 0;
  for (const m of texto.matchAll(TOKEN_RE)) {
    const i = m.index ?? 0;
    empujarTexto(texto.slice(ultimo, i));
    if (m[1] !== undefined) out.push({ t: "negrita", v: m[1] });
    else if (hrefSeguro(m[3])) out.push({ t: "link", v: m[2], href: m[3] });
    else empujarTexto(m[0]);
    ultimo = i + m[0].length;
  }
  empujarTexto(texto.slice(ultimo));
  return out;
}

// ── Validación de lo que escribe el operador en /dev ────────────────────────────
export type AvisoInput = {
  tipo: string;
  formato: string;
  titulo: string;
  cuerpo: string;
  /** ISO. */
  desde: string;
  /** ISO. */
  hasta: string;
  /** Vacío = todas las empresas. */
  empresaIds: string[];
  mesa: string | null;
  versionMin: string;
};

export type FilaAviso = {
  tipo: TipoAviso;
  formato: FormatoAviso;
  titulo: string;
  cuerpo: string;
  desde: string;
  hasta: string;
  empresa_ids: string[] | null;
  mesa: MesaAviso | null;
  version_min: string | null;
};

/** Allowlist campo a campo (jamás spread del payload). */
export function validarAvisoInput(input: AvisoInput): { ok: true; fila: FilaAviso } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Aviso inválido" };
  const tipo = input.tipo as TipoAviso;
  if (!TIPOS.includes(tipo)) return { ok: false, error: "Tipo inválido" };
  const formato = input.formato as FormatoAviso;
  if (!FORMATOS.includes(formato)) return { ok: false, error: "Formato inválido" };
  if (formato === "popup" && tipo !== "urgente") return { ok: false, error: "El popup es solo para avisos urgentes" };
  const titulo = typeof input.titulo === "string" ? input.titulo.trim().replace(/\s+/g, " ") : "";
  if (!titulo) return { ok: false, error: "Falta el título" };
  if (titulo.length > TITULO_MAX) return { ok: false, error: `El título pasa de ${TITULO_MAX} caracteres` };
  const cuerpo = typeof input.cuerpo === "string" ? input.cuerpo.trim() : "";
  if (cuerpo.length > CUERPO_MAX) return { ok: false, error: `El texto pasa de ${CUERPO_MAX} caracteres` };
  const d = Date.parse(input.desde);
  const h = Date.parse(input.hasta);
  if (!Number.isFinite(d) || !Number.isFinite(h)) return { ok: false, error: "Fechas inválidas" };
  if (h <= d) return { ok: false, error: "«Hasta» tiene que ser después de «desde»" };
  const ids = Array.isArray(input.empresaIds) ? input.empresaIds.map((x) => (typeof x === "string" ? x.trim() : x)).filter((x) => x !== "") : [];
  if (ids.some((x) => !esUuid(x))) return { ok: false, error: "Hay un ID de empresa inválido" };
  if (ids.length > 200) return { ok: false, error: "Demasiadas empresas (máx. 200)" };
  const mesa = input.mesa == null || input.mesa === "" ? null : (input.mesa as MesaAviso);
  if (mesa !== null && !MESAS.includes(mesa)) return { ok: false, error: "Mesa inválida" };
  const versionMin = typeof input.versionMin === "string" ? input.versionMin.trim() : "";
  if (versionMin.length > 64) return { ok: false, error: "Versión inválida" };
  if (versionMin && !ISO_RE.test(versionMin) && !/^[0-9a-z][0-9a-z_-]{6,63}$/i.test(versionMin)) {
    return { ok: false, error: "Versión: fecha ISO de build o commit (7+ caracteres)" };
  }
  return {
    ok: true,
    fila: {
      tipo,
      formato,
      titulo,
      cuerpo,
      desde: new Date(d).toISOString(),
      hasta: new Date(h).toISOString(),
      empresa_ids: ids.length ? [...new Set(ids as string[])] : null,
      mesa,
      version_min: versionMin || null,
    },
  };
}
