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
 *   - lo derivado (heurística/nombres/IA) se guarda SIEMPRE como de la empresa
 *     que subió la cartola; nace `provisorio` (confianza 0.7) o, con prueba
 *     ESTRICTA (saldo al peso / total del banco), `confirmado` para esa empresa;
 *   - un reuso SIN prueba cuenta el uso pero NO sube la confianza;
 *   - pasa a `confirmado` solo con prueba: saldo o total del banco, el cliente
 *     ("Se ve bien" sin alertas / su saldo final cuadró) o el cliente aprobando
 *     FILA A FILA en Check lo que el mapa leyó sin editarlo (no "Aprobar
 *     cartola" en bloque);
 *   - GLOBAL (compartido) solo por CONSENSO de pruebas OBJETIVAS (saldo al peso
 *     o total del banco) de 2+ dueños y cuentas bancarias distintas
 *     (hayConsensoParaGlobal). "Se ve bien"/Check confirman solo lo propio. Un
 *     global se usa solo si está confirmado, y NO si los títulos de la hoja lo
 *     contradicen (orquestador).
 * MAPAS GLOBALES VIEJOS (antes de la migración 20260930140000): la migración los
 * deja `provisorio`, así que NINGUNA empresa los vuelve a usar (no pasan por
 * selectAdapterForEmpresa) y tampoco se "re-confirman solos": quedan muertos en
 * la tabla, sin borrarse. El primer día cada clienta sin mapa propio re-deriva
 * su formato con la heurística actual (misma lectura determinística que hoy;
 * ~2-30 ms), y ese mapa queda como SUYO (confirmado si el saldo cierra al peso,
 * provisorio si no). Los manuales ya eran propios y siguen iguales.
 * FAIL-SAFE: si la columna `estado` todavía no existe en la base (migración
 * 20260930140000 sin aplicar), todo se trata como provisorio y las escrituras
 * reintentan sin las columnas nuevas.
 */

const CONFIANZA_SUCCESS_DELTA = 0.05;
const CONFIANZA_FAILURE_DELTA = -0.25;
const CONFIANZA_DISABLE_THRESHOLD = 0.5;
const DISABLE_DURATION_MINUTES = 60;
/** Confianza con que nace un mapa derivado sin prueba (< 1.0 de un manual). */
export const CONFIANZA_PROVISORIO = 0.7;

export type ConfirmadoPor = "saldo" | "total_banco" | "cliente" | "check" | "manual" | "plantilla" | "consenso";

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

/**
 * Prod SIN la migración 20260930140000 (la fila no trae la columna `estado`):
 * se emula su backfill — manual y plantilla massDTE = confirmados, el resto
 * provisorio. Sin esto el mapa que la clienta confirmó en el popup (source
 * manual) no contaba y CADA cartola del formato volvía a pedir "Revisa las
 * columnas" (revisión adversarial 2026-09-30). Con la columna, no se toca.
 */
export function conEstadoLegado<T extends { source?: string | null; config?: unknown; estado?: string | null; confirmado_por?: string | null }>(row: T): T {
  if ("estado" in row) return row;
  if (row.source === "manual") return { ...row, estado: "confirmado", confirmado_por: "manual" };
  if ((row.config as { plantilla?: unknown } | null)?.plantilla === true) return { ...row, estado: "confirmado", confirmado_por: "plantilla" };
  return { ...row, estado: "provisorio", confirmado_por: null };
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

/** Lo que define un mapa (sin títulos ni filas de encabezado, que varían por empresa). */
function claveDeMapa(cfg: AdapterConfig | null | undefined): string {
  if (!cfg) return "";
  const c = cfg.columns ?? ({} as AdapterConfig["columns"]);
  return JSON.stringify([
    cfg.layout ?? "two_cols", cfg.date_format, cfg.number_format, cfg.default_tipo_flujo ?? null,
    c.fecha, c.descripcion, c.n_documento, c.cargo, c.abono, c.saldo, c.monto ?? -1, c.tipo_flujo_col ?? -1,
  ]);
}

/**
 * ¿Hay CONSENSO para compartir este mapa con todas las empresas? (vuelta 2 de
 * la revisión adversarial, N1 CRÍTICO: el consenso se "fabricaba" con dos
 * empresas del mismo dueño confirmadas por "Se ve bien"/Check y envenenaba a
 * otros tenants). Solo cuenta:
 *   - PRUEBA OBJETIVA: confirmado_por saldo (al peso) o total_banco; "cliente",
 *     "check", "manual" nunca vuelven global un mapa;
 *   - de DUEÑOS distintos (cuenta pagadora distinta, `cuenta_id`);
 *   - y de CUENTAS BANCARIAS distintas (`config.cuenta_huella`; sin huella no
 *     se puede probar que sean distintas → no cuenta).
 * Hacen falta 2 confirmaciones distintas en dueño Y cuenta bancaria. Lógica pura.
 */
export type FilaConsenso = {
  creado_por_empresa_id: string | null;
  estado?: string | null;
  confirmado_por?: string | null;
  /** Dueño (cuenta pagadora) de la empresa. */
  cuenta_id?: string | null;
  config: AdapterConfig;
};
export function hayConsensoParaGlobal(filas: FilaConsenso[], config: AdapterConfig): boolean {
  const clave = claveDeMapa(config);
  const validas = filas.filter((f) =>
    f.creado_por_empresa_id && estadoDeAdapter(f) === "confirmado"
    && (f.confirmado_por === "saldo" || f.confirmado_por === "total_banco")
    && !!f.cuenta_id && !!f.config?.cuenta_huella
    && claveDeMapa(f.config) === clave);
  const elegidas: FilaConsenso[] = [];
  for (const f of validas) {
    if (elegidas.every((e) => e.cuenta_id !== f.cuenta_id && e.config.cuenta_huella !== f.config.cuenta_huella)) elegidas.push(f);
    if (elegidas.length >= 2) return true;
  }
  return false;
}

/**
 * Si hay consenso (ver hayConsensoParaGlobal) para esta huella y todavía no hay
 * un global confirmado igual, crea el global (confirmado_por = consenso). Solo
 * lo llama el orquestador tras una lectura con prueba objetiva. Best-effort.
 */
export async function promoverMapaGlobalSiHayConsenso(fingerprint: string, config: AdapterConfig): Promise<boolean> {
  try {
    const sb = getServiceClient();
    if (!sb) return false;
    const { data, error } = await sb
      .from("parser_adapters")
      .select("*")
      .eq("fingerprint", fingerprint)
      .limit(50);
    if (error || !data) return false;
    const filas = data as unknown as (AdapterRow & { creado_por_empresa_id: string | null })[];
    const clave = claveDeMapa(config);
    if (filas.some((f) => !f.creado_por_empresa_id && estadoDeAdapter(f) === "confirmado" && claveDeMapa(f.config) === clave)) return false;
    const empresas = [...new Set(filas.map((f) => f.creado_por_empresa_id).filter((x): x is string => !!x))];
    if (empresas.length < 2) return false;
    const { data: ce } = await sb
      .from("cuenta_empresas" as never)
      .select("cuenta_id, empresa_id")
      .in("empresa_id", empresas)
      .eq("activa", true);
    const duenoDe = new Map(((ce ?? []) as { cuenta_id: string; empresa_id: string }[]).map((r) => [r.empresa_id, r.cuenta_id]));
    const conDueno: FilaConsenso[] = filas.map((f) => ({ ...f, cuenta_id: f.creado_por_empresa_id ? duenoDe.get(f.creado_por_empresa_id) ?? null : null }));
    if (!hayConsensoParaGlobal(conDueno, config)) return false;
    const origen = filas.find((f) => f.creado_por_empresa_id && claveDeMapa(f.config) === clave)!;
    const id = await saveAdapter({
      fingerprint,
      nombre: origen.nombre ?? undefined,
      source: origen.source,
      // Sin la cuenta ni la revisión de un documento de la empresa de origen.
      config: { ...config, titulos: config.titulos, cuenta_huella: undefined, revision_cliente: undefined },
      empresaId: null,
      confirmadoPor: "consenso",
    });
    return !!id;
  } catch {
    return false;
  }
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
      (data as unknown as (AdapterOwnership & AdapterRow)[]).map(conEstadoLegado),
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
  /**
   * El cliente eligió las columnas en el popup "Revisa las columnas" y dijo
   * "Listo": el mapa queda confirmado por el CLIENTE, solo para su empresa (un
   * mapa "cliente" nunca cuenta para volverse global: hayConsensoParaGlobal).
   */
  confirmadoPor: Extract<ConfirmadoPor, "cliente">;
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

    // Las columnas que eligió el cliente SON su confirmación.
    const confirmado = { estado: "confirmado", confirmado_por: args.confirmadoPor, confirmado_en: new Date().toISOString() };

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
 * La empresa YA tiene un mapa propio para esta huella: se REUSA esa fila (nunca
 * otra inserción por lectura). El mapa se reemplaza por el nuevo (p. ej. el de un
 * formato conocido sobre una adivinanza vieja) y se cuenta el uso; con prueba,
 * el provisorio pasa a confirmado (incrementAdapterSuccess).
 */
export async function reusarAdapterPropio(
  adapterId: string,
  config: AdapterConfig,
  opts: { nombre?: string; source?: AdapterRow["source"]; prueba?: TipoVerificacion | null } = {},
): Promise<string> {
  try {
    const sb = getServiceClient();
    if (sb) {
      await sb.from("parser_adapters")
        .update({ config: toJson(config), ...(opts.nombre ? { nombre: opts.nombre } : {}), ...(opts.source ? { source: opts.source } : {}) } as never)
        .eq("id", adapterId);
    }
  } catch {
    /* non-blocking */
  }
  await incrementAdapterSuccess(adapterId, { prueba: opts.prueba ?? null });
  return adapterId;
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
): Promise<{ id: string; estado: "provisorio" | "confirmado"; fingerprint?: string; config?: AdapterConfig } | null> {
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
    const row = ad as unknown as { id: string; creado_por_empresa_id: string | null; estado?: string | null; fingerprint?: string; config?: AdapterConfig } | null;
    if (!row || row.creado_por_empresa_id !== empresaId) return null;
    return { id: row.id, estado: estadoDeAdapter(row), fingerprint: row.fingerprint, config: row.config };
  } catch {
    return null;
  }
}
