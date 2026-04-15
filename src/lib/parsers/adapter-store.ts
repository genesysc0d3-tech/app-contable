import { createClient } from "@supabase/supabase-js";
import type { AdapterConfig, AdapterRow } from "./types";

// Using an untyped client here because parser_adapters and parser_logs are
// newer than the last database.types.ts regeneration. Every call is already
// wrapped in try/catch and returns null on failure, so loose typing has no
// runtime impact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseClient = any;

/**
 * Best-effort CRUD for parser_adapters and parser_logs.
 *
 * All functions are wrapped in try/catch so that DB failures NEVER break
 * document parsing — the orchestrator will still fall back to the next layer
 * if the cache lookup fails.
 */

const CONFIANZA_SUCCESS_DELTA = 0.05;
const CONFIANZA_FAILURE_DELTA = -0.25;
const CONFIANZA_DISABLE_THRESHOLD = 0.5;
const DISABLE_DURATION_MINUTES = 60;

function getServiceClient(): LooseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function getAdapterByFingerprint(
  fingerprint: string
): Promise<AdapterRow | null> {
  try {
    const sb = getServiceClient();
    if (!sb) return null;
    const { data, error } = await sb
      .from("parser_adapters")
      .select("*")
      .eq("fingerprint", fingerprint)
      .maybeSingle();
    if (error || !data) return null;
    // Respect disabled_until
    if (data.disabled_until && new Date(data.disabled_until) > new Date()) {
      return null;
    }
    if ((data.confianza as number) < CONFIANZA_DISABLE_THRESHOLD) return null;
    return data as unknown as AdapterRow;
  } catch {
    return null;
  }
}

export async function upsertManualAdapter(args: {
  fingerprint: string;
  nombre?: string;
  tipo_doc?: string;
  config: AdapterConfig;
}): Promise<string | null> {
  try {
    const sb = getServiceClient();
    if (!sb) return null;
    const existing = await sb
      .from("parser_adapters")
      .select("id")
      .eq("fingerprint", args.fingerprint)
      .maybeSingle();

    if (existing.data?.id) {
      await sb
        .from("parser_adapters")
        .update({
          source: "manual",
          config: args.config,
          nombre: args.nombre ?? null,
          tipo_doc: args.tipo_doc ?? "cartola_bancaria",
          confianza: 1.0,
          disabled_until: null,
          last_failure_reason: null,
        })
        .eq("id", existing.data.id);
      return existing.data.id as string;
    }

    const { data } = await sb
      .from("parser_adapters")
      .insert({
        fingerprint: args.fingerprint,
        nombre: args.nombre ?? null,
        tipo_doc: args.tipo_doc ?? "cartola_bancaria",
        source: "manual",
        config: args.config,
        confianza: 1.0,
        usage_count: 0,
        success_count: 0,
        last_used_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    return (data?.id as string) ?? null;
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
}): Promise<string | null> {
  try {
    const sb = getServiceClient();
    if (!sb) return null;
    const { data, error } = await sb
      .from("parser_adapters")
      .insert({
        fingerprint: args.fingerprint,
        nombre: args.nombre ?? null,
        tipo_doc: args.tipo_doc ?? "cartola_bancaria",
        source: args.source,
        config: args.config,
        confianza: 1.0,
        usage_count: 1,
        success_count: 1,
        last_used_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      // Unique conflict: another worker just created it — fetch existing id
      const existing = await getAdapterByFingerprint(args.fingerprint);
      return existing?.id ?? null;
    }
    return data?.id ?? null;
  } catch {
    return null;
  }
}

export async function incrementAdapterSuccess(adapterId: string): Promise<void> {
  try {
    const sb = getServiceClient();
    if (!sb) return;
    const { data } = await sb
      .from("parser_adapters")
      .select("confianza, success_count, usage_count")
      .eq("id", adapterId)
      .maybeSingle();
    if (!data) return;
    const newConfianza = Math.min(
      1.0,
      (data.confianza as number) + CONFIANZA_SUCCESS_DELTA
    );
    await sb
      .from("parser_adapters")
      .update({
        confianza: newConfianza,
        success_count: (data.success_count as number) + 1,
        usage_count: (data.usage_count as number) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", adapterId);
  } catch {
    /* non-blocking */
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
