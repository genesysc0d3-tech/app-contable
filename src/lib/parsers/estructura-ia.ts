import { randomUUID } from "node:crypto";
import type { AdapterConfig, Row, TipoVerificacion } from "./types";
import { findTransactionBlockStart } from "./heuristic";
import { derivarNumberFormat } from "./numeros";
import { requirePaidModel } from "../ai/model-guard";

/**
 * PASO DE ESTRUCTURA CON DEEPSEEK — SEGUNDA OPINIÓN del mapa (punto 9, 2026-09-30).
 *
 * Reglas duras:
 *  - La IA NUNCA es juez y NUNCA lee montos: devuelve SOLO un AdapterConfig
 *    (qué columna es qué). Los montos los lee applyAdapter desde las celdas y lo
 *    que decide es la prueba (saldo / total del banco / cliente).
 *  - Proveedor FIJO: DeepSeek vía OpenCode Go (OPENCODE_GO_API_KEY, base
 *    https://opencode.ai/zen/go/v1, modelo deepseek-v4-flash, header
 *    x-opencode-session obligatorio, User-Agent). No depende de AI_PROVIDER: ni
 *    Fireworks, ni Mistral, ni Gemma pueden entrar por acá.
 *  - La grilla va ENMASCARADA: textos reducidos a su FORMA ("Aa5 a2 A7"), sin
 *    nombres, RUT ni glosas reales; números con su forma/magnitud ("#7"). Solo
 *    los TÍTULOS de columnas viajan como texto, y el vocabulario de banderas
 *    (A/C, Cargo/Abono) que no identifica a nadie.
 *  - Timeout 20 s; si falla o tarda → se sigue sin IA.
 *  - Detrás de LECTOR_ESTRUCTURA_IA=1 (apagado por defecto).
 *
 * Experimento que lo respalda: docs/experimento-estructura-deepseek-2026-09-30.md
 * ("dos opiniones + desempate por saldo": 44 OK / 1 silencioso, vs 38 / 5).
 */

export const OPENCODE_GO_CHAT_URL = "https://opencode.ai/zen/go/v1/chat/completions";
export const MODELO_ESTRUCTURA = "deepseek-v4-flash";
export const TIMEOUT_ESTRUCTURA_MS = 20_000;

export function estructuraIaActiva(env: Record<string, string | undefined> = process.env): boolean {
  return env.LECTOR_ESTRUCTURA_IA === "1";
}

/** Vocabulario de banderas de dirección: no identifica a nadie, es señal. */
const BANDERA_RE = /^(a|c|d|h|cargo|abono|d[eé]bito|cr[eé]dito|ingreso|egreso|dep[oó]sito|giro|haber|debe)$/i;

/**
 * Forma de una celda de DATOS, sin su contenido: letras → A/a, dígitos → 9, con
 * el largo de cada corrida ("Transf de EMPRESA" → "Aa5 a2 A7"; "76.123.456-7" →
 * "92.93.93-9"). Números tipados → "#" + cantidad de dígitos (y signo).
 */
export function formaDeCelda(v: unknown): string {
  if (v == null || v === "") return "·";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "·" : "fecha";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "·";
    const ent = String(Math.trunc(Math.abs(v)));
    return `${v < 0 ? "-" : ""}#${ent.length}`;
  }
  const s = String(v).trim().replace(/\s+/g, " ");
  if (!s) return "·";
  if (BANDERA_RE.test(s)) return s.slice(0, 8);
  const clases = s
    .replace(/[A-ZÁÉÍÓÚÑÜ]/g, "A")
    .replace(/[a-záéíóúñü]/g, "a")
    .replace(/\d/g, "9");
  const runs = clases.match(/A+|a+|9+|[^Aa9]/g) ?? [];
  const out = runs.map((r) => (/^[Aa9]+$/.test(r) && r.length > 1 ? `${r[0]}${r.length}` : r)).join("");
  return out.slice(0, 24);
}

/** Título de columna: se manda como texto (normalizado y corto). */
function titulo(v: unknown): string {
  if (v == null || v === "") return "·";
  if (v instanceof Date || typeof v === "number") return formaDeCelda(v);
  return String(v).trim().replace(/\s+/g, " ").slice(0, 28) || "·";
}

/**
 * La grilla que ve DeepSeek: índices de fila y columna, primeras 22 + últimas 6
 * filas. Solo la fila de títulos (la anterior al primer bloque de movimientos)
 * va como texto; todo lo demás, enmascarado.
 */
export function grillaEnmascarada(rows: Row[]): string {
  const tx = findTransactionBlockStart(rows);
  const filaTitulos = tx > 0 ? tx - 1 : -1;
  const idx = rows.map((_, i) => i);
  const mostrar = idx.length <= 30 ? idx : [...idx.slice(0, 22), ...idx.slice(-6)];
  let prev = -1;
  const out: string[] = [];
  for (const i of mostrar) {
    if (prev >= 0 && i !== prev + 1) out.push("… (filas omitidas)");
    const r = rows[i] ?? [];
    const cel = i === filaTitulos ? titulo : formaDeCelda;
    out.push(`fila ${i}: ` + (r.length ? r.map((v, j) => `[${j}] ${cel(v)}`).join(" | ") : "(vacía)"));
    prev = i;
  }
  return out.join("\n");
}

export const TOOL_MAPA = {
  type: "function",
  function: {
    name: "mapa_cartola",
    description: "Devuelve SOLO la estructura de la cartola bancaria: qué columna cumple qué rol. No devuelvas montos.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["layout", "header_row", "primera_fila_datos", "date_format", "number_format", "fecha", "descripcion", "n_documento", "cargo", "abono", "saldo", "monto", "tipo_flujo_col", "razon"],
      properties: {
        layout: { type: "string", enum: ["two_cols", "single_col", "transactions_log"], description: "two_cols = columnas separadas de cargo y abono; single_col = una columna de monto + columna con letra/palabra que dice si es cargo o abono; transactions_log = un monto sin tipo" },
        header_row: { type: "integer", description: "fila de títulos; -1 si no hay títulos" },
        primera_fila_datos: { type: "integer", description: "índice de la primera fila que es un movimiento" },
        date_format: { type: "string", enum: ["dd/mm/yyyy", "yyyy-mm-dd", "dd-mm-yyyy", "unknown"] },
        number_format: { type: "string", enum: ["chilean", "generic"], description: "chilean = 1.234.567 (punto de miles); generic = 1,234,567 (coma de miles)" },
        fecha: { type: "integer" },
        descripcion: { type: "integer", description: "glosa del movimiento (no códigos/hash)" },
        n_documento: { type: "integer", description: "-1 si no hay" },
        cargo: { type: "integer", description: "columna de SALIDAS de plata (two_cols); -1 si no aplica" },
        abono: { type: "integer", description: "columna de ENTRADAS de plata (two_cols); -1 si no aplica" },
        saldo: { type: "integer", description: "-1 si no hay" },
        monto: { type: "integer", description: "single_col/transactions_log: columna del monto; -1 si no aplica" },
        tipo_flujo_col: { type: "integer", description: "single_col: columna con C/A, Cargo/Abono, D/C; -1 si no aplica" },
        razon: { type: "string", description: "una frase" },
      },
    },
  },
} as const;

const SISTEMA =
  "Eres un lector de ESTRUCTURA de cartolas bancarias chilenas exportadas a Excel. Recibes una grilla con índices de fila y columna ([j] = columna j). " +
  "Los datos vienen ENMASCARADOS: 'A'/'a' = letras (con el largo de la corrida: 'Aa5' = una mayúscula y 5 minúsculas), '9' = dígitos, '#7' = número de 7 dígitos, 'fecha' = fecha de Excel, '·' = vacía. " +
  "Solo la fila de títulos viene en texto. Identifica qué columna es la fecha, la glosa, las salidas (cargos/egresos/débitos), las entradas (abonos/ingresos/créditos/depósitos) y el saldo. " +
  "Los títulos pueden estar en otro idioma, ser genéricos o no existir: decide por el CONTENIDO (el saldo va lleno en todas las filas; cargo y abono nunca tienen valor en la misma fila; un N° de documento es un código). " +
  "Filas de basura arriba (logo, cuenta, saldo inicial) NO son datos. No inventes columnas.";

/** Convierte la respuesta del tool en un AdapterConfig SANO (índices en rango). */
export function configDesdeRespuesta(a: Record<string, unknown>, rows: Row[]): AdapterConfig | null {
  const ncols = rows.reduce((m, r) => Math.max(m, r?.length ?? 0), 0);
  const int = (k: string) => (typeof a[k] === "number" && Number.isInteger(a[k]) ? (a[k] as number) : NaN);
  const col = (k: string) => { const v = int(k); return Number.isFinite(v) && v >= -1 && v < ncols ? v : NaN; };
  const layout = a.layout;
  if (layout !== "two_cols" && layout !== "single_col" && layout !== "transactions_log") return null;
  const fecha = col("fecha"); const descripcion = col("descripcion");
  const cargo = col("cargo"); const abono = col("abono"); const saldo = col("saldo");
  const monto = col("monto"); const tipo = col("tipo_flujo_col"); const ndoc = col("n_documento");
  const primera = int("primera_fila_datos");
  if ([fecha, descripcion, cargo, abono, saldo, monto, tipo, ndoc].some((x) => Number.isNaN(x))) return null;
  if (fecha < 0 || descripcion < 0 || !(primera >= 0 && primera < rows.length)) return null;
  if (layout === "two_cols" && (cargo < 0 || abono < 0 || cargo === abono)) return null;
  if (layout === "single_col" && (monto < 0 || tipo < 0)) return null;
  if (layout === "transactions_log" && monto < 0) return null;
  const df = a.date_format;
  const date_format: AdapterConfig["date_format"] =
    df === "dd/mm/yyyy" || df === "yyyy-mm-dd" || df === "dd-mm-yyyy" ? df : "unknown";
  const plata = layout === "two_cols" ? [cargo, abono, saldo] : [monto, saldo];
  const cfg: AdapterConfig = {
    header_row: Math.max(0, int("header_row") || 0),
    skip_rows_before_data: primera,
    date_format,
    // El formato de número NO se le cree a la IA: sale de las celdas.
    number_format: derivarNumberFormat(rows as unknown[][], primera, plata),
    layout,
    ...(layout === "transactions_log" ? { default_tipo_flujo: "entrada" as const } : {}),
    columns: layout === "two_cols"
      ? { fecha, descripcion, n_documento: ndoc, cargo, abono, saldo }
      : { fecha, descripcion, n_documento: ndoc, cargo: monto, abono: monto, saldo, monto, tipo_flujo_col: layout === "single_col" ? tipo : -1 },
  };
  return cfg;
}

export interface RespuestaEstructura {
  cfg: AdapterConfig | null;
  ms: number;
  error?: string;
}

/**
 * Pide el mapa a DeepSeek (OpenCode Go). Nunca lanza: ante cualquier falla o
 * timeout devuelve cfg=null y el lector sigue sin IA.
 */
export async function mapaPorIA(
  rows: Row[],
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; apiKey?: string; sessionId?: string } = {},
): Promise<RespuestaEstructura> {
  const t0 = Date.now();
  const apiKey = opts.apiKey ?? process.env.OPENCODE_GO_API_KEY;
  if (!apiKey) return { cfg: null, ms: 0, error: "sin OPENCODE_GO_API_KEY" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_ESTRUCTURA_MS);
  try {
    const model = requirePaidModel(MODELO_ESTRUCTURA, "lector: paso de estructura");
    const res = await (opts.fetchImpl ?? fetch)(OPENCODE_GO_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenCode Go exige un session id (400 MissingSessionID sin él).
        "x-opencode-session": opts.sessionId ?? randomUUID(),
        "User-Agent": "massdte-lector-estructura/1.0",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        tools: [TOOL_MAPA],
        tool_choice: { type: "function", function: { name: "mapa_cartola" } },
        messages: [
          { role: "system", content: SISTEMA },
          { role: "user", content: grillaEnmascarada(rows) },
        ],
      }),
      signal: controller.signal,
    });
    const txt = await res.text();
    if (!res.ok) return { cfg: null, ms: Date.now() - t0, error: `HTTP ${res.status}` };
    const j = JSON.parse(txt) as { choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[] };
    const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { cfg: null, ms: Date.now() - t0, error: "sin tool_call" };
    const cfg = configDesdeRespuesta(JSON.parse(args) as Record<string, unknown>, rows);
    return cfg ? { cfg, ms: Date.now() - t0 } : { cfg: null, ms: Date.now() - t0, error: "mapa fuera de rango" };
  } catch (e) {
    const aborto = (e as Error)?.name === "AbortError";
    return { cfg: null, ms: Date.now() - t0, error: aborto ? "timeout" : (e as Error)?.message ?? "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Cómo le fue a UN mapa aplicado a la hoja (lo calcula el orquestador). */
export interface EvaluacionMapa {
  /** Pasó el validador (filas, fechas, montos, saldo si hay). */
  valido: boolean;
  /** Firma de lo leído (fecha|monto|tipo ordenados): dos mapas "iguales" leen lo mismo. */
  firma: string;
  /** Sello de verificación de ese mapa. */
  sello: TipoVerificacion;
}

export interface DecisionDosOpiniones {
  elegido: "lector" | "ia" | null;
  /** Texto de la disputa si las dos opiniones no coinciden y la prueba no desempata. */
  disputa: string | null;
}

/**
 * POLÍTICA "DOS OPINIONES" (experimento 2026-09-30): corren el lector y DeepSeek.
 *   - iguales (leen lo mismo) → el lector; si además hay prueba, confirmado.
 *   - distintos → gana el ÚNICO que tiene prueba (saldo / total del banco);
 *   - distintos y ambos con prueba, o ninguno → queda el lector (o el único
 *     válido) como PROVISORIO y se pide confirmación al cliente (disputa).
 * La IA nunca decide sola: sin prueba, su opinión solo crea la duda visible.
 */
export function decidirDosOpiniones(lector: EvaluacionMapa | null, ia: EvaluacionMapa | null): DecisionDosOpiniones {
  const prueba = (e: EvaluacionMapa | null) => !!e && e.valido && (e.sello === "saldo" || e.sello === "total_banco");
  const lv = !!lector?.valido;
  const iv = !!ia?.valido;
  if (!lv && !iv) return { elegido: null, disputa: null };
  if (lv && !iv) return { elegido: "lector", disputa: null };
  if (!lv && iv) return { elegido: "ia", disputa: prueba(ia) ? null : "Solo la segunda opinión (IA de estructura) entendió el formato: falta confirmarlo" };
  if (lector!.firma === ia!.firma) return { elegido: "lector", disputa: null };
  const pl = prueba(lector); const pi = prueba(ia);
  if (pl && !pi) return { elegido: "lector", disputa: null };
  if (pi && !pl) return { elegido: "ia", disputa: null };
  return {
    elegido: "lector",
    disputa: pl
      ? "Dos lecturas distintas y las dos cuadran: falta que confirmes cuál es la buena"
      : "El lector y la segunda opinión leen distinto y nada del banco desempata: revisa la muestra",
  };
}
