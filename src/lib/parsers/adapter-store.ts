import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import type { AdapterConfig, AdapterRow, TipoVerificacion } from "./types";

type LooseClient = SupabaseClient<Database>;

// AdapterConfig es serializable pero como interface no satisface el index
// signature de Json — cast estructural seguro para las columnas jsonb.
const toJson = (cfg: AdapterConfig): Json => cfg as unknown as Json;

/**
 * Best-effort CRUD for parser_adapters and parser_logs.
 *
 * All functions are wrapped in try/catch so that DB failures NEVER break
 * document parsing — the orchestrator will still fall back to the next layer
 * if the cache lookup fails.
 *
 * MAPAS PROVISORIOS vs CONFIRMADOS (punto 7, 2026-09-30). Diagnóstico en prod:
 * 44 mapas heurísticos se reusaban con confianza 1.0 sin que nadie los hubiera
 * confirmado — aprendíamos nuestra propia adivinanza. Ahora (como GnuCash:
 * `if (selected_manually) store()`, docs/investigacion-aprendizaje-correcciones):
 *   - lo derivado (heurística/nombres/IA) nace `provisorio`, confianza 0.7;
 *   - un reuso SIN prueba cuenta el uso pero NO sube la confianza;
 *   - pasa a `confirmado` solo con prueba: saldo o total del banco, el cliente
 *     ("Se ve bien" / su saldo final cuadró) o el cliente aprobando en Check lo
 *     que el mapa leyó sin editarlo;
 *   - un provisorio NO se comparte entre empresas (un global se usa solo si
 *     está confirmado).
 * FAIL-SAFE: si la columna `estado` todavía no existe en la base (migración
 * 20260930120000 sin aplicar), todo se trata como provisorio y las escrituras
 * reintentan sin las columnas nuevas.
 */

const CONFIANZA_SUCCESS_DELTA = 0.05;
const CONFIANZA_FAILURE_DELTA = -0.25;
const CONFIANZA_DISABLE_THRESHOLD = 0.5;
const DISABLE_DURATION_MINUTES = 60;
/** Confianza con que nace un mapa derivado sin prueba (< 1.0 de un manual). */
export const CONFIANZA_PROVISORIO = 0.7;

export type ConfirmadoPor = "saldo" | "total_banco" | "cliente" | "check" | "manual" | "plantilla";

function getServiceClient(): LooseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key);
}

/** ¿El error es "la columna no existe" (migración sin aplicar)? */
export function esColumnaFaltante(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  return e.code === "42703" || e.code === "PGRST204" || /column .*(estado|confirmado)|(estado|confirmado_\w+).*(does not exist|schema cache)/i.test(e.message ?? "");
}

/** Estado de un mapa; sin la columna (prod sin migrar) → provisorio. */
export function estadoDeAdapter(row: { estado?: string | null } | null | undefined): "provisorio" | "confirmado" {
  return row?.estado === "confirmado" ? "confirmado" : "provisorio";
}

/** ¿Este sello es una PRUEBA que confirma el mapa? */
export function selloEsPrueba(tipo: TipoVerificacion | null | undefined): tipo is "saldo" | "total_banco" | "cliente" {
  return tipo === "saldo" || tipo === "total_banco" || tipo === "cliente";
}

/** Fila mínima para decidir aislamiento cross-tenant (subconjunto de AdapterRow). */
export type AdapterOwnership = {
  confianza: number;
  disabled_until: string | null;
  creado_por_empresa_id: string | null;
  estado?: string | null;
};

/**
 * AISLAMIENTO CROSS-TENANT (lógica pura, testeable). El adapter 'manual' es un
 * mapeo hecho a mano por una empresa (p. ej. monto→columna X). Aplicarlo a las
 * cartolas de OTRA empresa con el mismo formato produciría montos incorrectos en
 * boletas reales (envenenamiento first-writer-wins). Por eso, entre las filas de
 * un fingerprint elegimos:
 *   1) el adapter PROPIO de la empresa (cualquier source),
 *   2) si no hay, uno GLOBAL sin dueño CONFIRMADO (probado por saldo/total del
 *      banco); un global provisorio es una adivinanza y no se comparte,
 *   3) nunca el 'manual' de otra empresa → null (el orquestador re-deriva heurístico).
 * Descarta primero los deshabilitados y los de confianza bajo el umbral.
 */
export function selectAdapterForEmpresa<T extends AdapterOwnership>(
  rows: T[],
  empresaId: string | undefined,
  now: Date = new Date(),
): T | null {
  const usable = rows.filter((row) => {
    if (row.disabled_until && new Date(row.disabled_until) > now) return false;
    if (row.confianza < CONFIANZA_DISABLE_THRESHOLD) return false;
    return true;
  });
  if (!usable.length) return null;
  const propio = empresaId ? usable.find((r) => r.creado_por_empresa_id === empresaId) : undefined;
  if (propio) return propio;
  const global = usable.find((r) => !r.creado_por_empresa_id && estadoDeAdapter(r) === "confirmado");
  return global ?? null;
}

export async function getAdapterByFingerprint(
  fingerprint: string,
  empresaId?: string,
): Promise<AdapterRow | null> {
  try {
    const sb = getServiceClient();
    if (!sb) return null;
    // Solo globales + los propios de ESTA empresa: los formatos privados de otras
    // empresas nunca se leen (ni pueden tapar al global con el limit).
    const { data, error } = await sb
      .from("parser_adapters")
      .select("*")
      .eq("fingerprint", fingerprint)
      .or(empresaId ? `creado_por_empresa_id.is.null,creado_por_empresa_id.eq.${empresaId}` : "creado_por_empresa_id.is.null")
      .order("confianza", { ascending: false })
      .limit(20);
    if (error || !data?.length) return null;
    const elegido = selectAdapterForEmpresa(
      data as unknown as (AdapterOwnership & AdapterRow)[],
      empresaId,
    );
    return elegido ? (elegido as unknown as AdapterRow) : null;
  } catch {
    return null;
  }
}

/**
 * Mapas CONFIRMADOS de la empresa (para avisar "tu banco cambió el formato":
 * esperaba encabezado X, llegó Y). Sin la columna estado → [] (fail-safe).
 */
export async function getAdaptersConfirmadosEmpresa(empresaId: string | undefined): Promise<AdapterRow[]> {
  if (!empresaId) return [];
  try {
    const sb = getServiceClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from("parser_adapters")
      .select("*")
      .eq("creado_por_empresa_id", empresaId)
      .eq("estado" as never, "confirmado" as never)
      .order("last_used_at", { ascending: false })
      .limit(20);
    if (error || !data) return [];
    return data as unknown as AdapterRow[];
  } catch {
    return [];
  }
}

export async function upsertManualAdapter(args: {
  fingerprint: string;
  /** Empresa que crea/edita el adapter. Anti-poison cross-tenant: solo la empresa
   *  dueña puede sobrescribir un adapter existente (first-owner-wins). */
  empresaId: string;
  nombre?: string;
  tipo_doc?: string;
  config: AdapterConfig;
}): Promise<string | null> {
  try {
    const sb = getServiceClient();
    if (!sb) return null;
    // Se busca SOLO el adapter PROPIO de la empresa. Un global u otro ajeno jamás
    // se sobrescribe (anti-poison, auditoría #2/#12), pero tampoco BLOQUEA: antes
    // se devolvía el global y la corrección manual no se guardaba, así que una
    // empresa no podía arreglar un formato global mal leído (2026-09-26). El
    // propio gana en selectAdapterForEmpresa.
    const existing = await sb
      .from("parser_adapters")
      .select("id, creado_por_empresa_id")
      .eq("fingerprint", args.fingerprint)
      .eq("creado_por_empresa_id", args.empresaId)
      .limit(1)
      .maybeSingle();

    // El mapeo a mano ES la confirmación del cliente.
    const confirmado = { estado: "confirmado", confirmado_por: "manual", confirmado_en: new Date().toISOString() };

    if (existing.data?.id) {
      const base = {
        source: "manual",
        config: toJson(args.config),
        nombre: args.nombre ?? null,
        tipo_doc: args.tipo_doc ?? "cartola_bancaria",
        confianza: 1.0,
        disabled_until: null,
        last_failure_reason: null,
      };
      const r = await sb.from("parser_adapters").update({ ...base, ...confirmado } as never).eq("id", existing.data.id);
      if (r?.error && esColumnaFaltante(r.error)) {
        await sb.from("parser_adapters").update(base).eq("id", existing.data.id);
      }
      return existing.data.id as string;
    }

    const base = {
      fingerprint: args.fingerprint,
      nombre: args.nombre ?? null,
      tipo_doc: args.tipo_doc ?? "cartola_bancaria",
      source: "manual",
      config: toJson(args.config),
      confianza: 1.0,
      usage_count: 0,
      success_count: 0,
      last_used_at: new Date().toISOString(),
      creado_por_empresa_id: args.empresaId,
    };
    let res = await sb.from("parser_adapters").insert({ ...base, ...confirmado } as never).select("id").single();
    if (res?.error && esColumnaFaltante(res.error)) {
      res = await sb.from("parser_adapters").insert(base).select("id").single();
    }
    return (res?.data?.id as string) ?? null;
  } catch {
    return null;
  }
}

export async function saveAdapter(args: {
  fingerprint: string;
  nombre?: string;
  tipo_doc?: string;
  source: AdapterRow["source"];
  config: AdapterConfig;
  /** Dueño. null = global (solo plantilla propia o formato con PRUEBA). */
  empresaId?: string | null;
  /** Prueba con que nace el mapa; sin prueba → provisorio (confianza 0.7). */
  confirmadoPor?: ConfirmadoPor | null;
}): Promise<string | null> {
  try {
    const sb = getServiceClient();
    if (!sb) return null;
    const confirmado = !!args.confirmadoPor;
    const base = {
      creado_por_empresa_id: args.empresaId ?? null,
      fingerprint: args.fingerprint,
      nombre: args.nombre ?? null,
      tipo_doc: args.tipo_doc ?? "cartola_bancaria",
      source: args.source,
      config: toJson(args.config),
      confianza: confirmado ? 1.0 : CONFIANZA_PROVISORIO,
      usage_count: 1,
      // Un éxito = una lectura CON prueba; una derivada sin prueba no lo es.
      success_count: confirmado ? 1 : 0,
      last_used_at: new Date().toISOString(),
    };
    const estado = confirmado
      ? { estado: "confirmado", confirmado_por: args.confirmadoPor, confirmado_en: new Date().toISOString() }
      : { estado: "provisorio" };
    let res = await sb.from("parser_adapters").insert({ ...base, ...estado } as never).select("id").single();
    if (res?.error && esColumnaFaltante(res.error)) {
      res = await sb.from("parser_adapters").insert(base as never).select("id").single();
    }
    if (res?.error) {
      // Unique conflict: another worker just created it — fetch existing id
      const existing = await getAdapterByFingerprint(args.fingerprint, args.empresaId ?? undefined);
      return existing?.id ?? null;
    }
    return (res?.data as { id?: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Reuso de un mapa. SIEMPRE cuenta el uso; la confianza y los éxitos suben SOLO
 * si la lectura trajo prueba (saldo / total del banco / cliente). Con prueba, un
 * provisorio pasa a confirmado.
 */
export async function incrementAdapterSuccess(
  adapterId: string,
  opts: { prueba?: TipoVerificacion | null } = {},
): Promise<void> {
  try {
    const sb = getServiceClient();
    if (!sb) return;
    const { data } = await sb
      .from("parser_adapters")
      .select("*")
      .eq("id", adapterId)
      .maybeSingle();
    if (!data) return;
    const row = data as unknown as { confianza: number; success_count: number; usage_count: number; estado?: string | null };
    const conPrueba = selloEsPrueba(opts.prueba);
    await sb
      .from("parser_adapters")
      .update({
        confianza: conPrueba ? Math.min(1.0, row.confianza + CONFIANZA_SUCCESS_DELTA) : row.confianza,
        success_count: row.success_count + (conPrueba ? 1 : 0),
        usage_count: row.usage_count + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", adapterId);
    if (conPrueba && estadoDeAdapter(row) === "provisorio") {
      await confirmarAdapter(adapterId, opts.prueba as ConfirmadoPor);
    }
  } catch {
    /* non-blocking */
  }
}

/**
 * Provisorio → confirmado. Solo con prueba (saldo, total del banco, cliente,
 * Check sin ediciones). Sin la columna en la base: no-op (queda provisorio).
 */
export async function confirmarAdapter(adapterId: string, por: ConfirmadoPor): Promise<boolean> {
  try {
    const sb = getServiceClient();
    if (!sb) return false;
    const { error } = await sb
      .from("parser_adapters")
      .update({ estado: "confirmado", confirmado_por: por, confirmado_en: new Date().toISOString(), confianza: 1.0 } as never)
      .eq("id", adapterId);
    return !error;
  } catch {
    return false;
  }
}

export async function decrementAdapterConfianza(
  adapterId: string,
  reason: string
): Promise<void> {
  try {
    const sb = getServiceClient();
    if (!sb) return;
    const { data } = await sb
      .from("parser_adapters")
      .select("confianza, failure_count")
      .eq("id", adapterId)
      .maybeSingle();
    if (!data) return;
    const newConfianza = Math.max(
      0,
      (data.confianza as number) + CONFIANZA_FAILURE_DELTA
    );
    const disabled_until =
      newConfianza < CONFIANZA_DISABLE_THRESHOLD
        ? new Date(Date.now() + DISABLE_DURATION_MINUTES * 60 * 1000).toISOString()
        : null;
    await sb
      .from("parser_adapters")
      .update({
        confianza: newConfianza,
        failure_count: (data.failure_count as number) + 1,
        last_failure_reason: reason,
        disabled_until,
      })
      .eq("id", adapterId);
  } catch {
    /* non-blocking */
  }
}

export async function logParserEvent(args: {
  documento_id?: string | null;
  fingerprint: string;
  capa_usada: number;
  capa_exitosa: number | null;
  adapter_id: string | null;
  rows_extracted: number;
  validator_failed_checks: string[];
  warnings: string[];
  duration_ms: number;
  error?: string | null;
}): Promise<void> {
  try {
    const sb = getServiceClient();
    if (!sb) return;
    await sb.from("parser_logs").insert({
      documento_id: args.documento_id ?? null,
      fingerprint: args.fingerprint,
      capa_usada: args.capa_usada,
      capa_exitosa: args.capa_exitosa,
      adapter_id: args.adapter_id,
      rows_extracted: args.rows_extracted,
      validator_failed_checks: args.validator_failed_checks,
      warnings: args.warnings,
      duration_ms: args.duration_ms,
      error: args.error ?? null,
    });
  } catch {
    /* non-blocking */
  }
}

/**
 * El mapa con que se leyó un documento (traza parser_logs → adapter), SOLO si
 * es de la empresa (un global o ajeno no se confirma por un cliente).
 */
export async function adapterDelDocumento(
  sb: LooseClient,
  documentoId: string,
  empresaId: string,
): Promise<{ id: string; estado: "provisorio" | "confirmado" } | null> {
  try {
    const { data: log } = await sb
      .from("parser_logs")
      .select("adapter_id, created_at")
      .eq("documento_id", documentoId)
      .not("adapter_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const id = (log as { adapter_id?: string | null } | null)?.adapter_id;
    if (!id) return null;
    const { data: ad } = await sb.from("parser_adapters").select("*").eq("id", id).maybeSingle();
    const row = ad as unknown as { id: string; creado_por_empresa_id: string | null; estado?: string | null } | null;
    if (!row || row.creado_por_empresa_id !== empresaId) return null;
    return { id: row.id, estado: estadoDeAdapter(row) };
  } catch {
    return null;
  }
}
