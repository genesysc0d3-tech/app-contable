import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

export type EmissionAuthorizationProvider = "sii_local" | "simpleapi";

export const CURRENT_EMISSION_AUTHORIZATION_VERSION = "massdte-emision-real-v1-2026-06-23";

type Sb = SupabaseClient<Database>;

export interface EmissionAuthorizationStatus {
  authorized: boolean;
  legal_version: string;
  authorization_id?: string;
  accepted_at?: string;
}

export function cleanEmissionAuthorizationProvider(value: unknown): EmissionAuthorizationProvider | null {
  return value === "sii_local" || value === "simpleapi" ? value : null;
}

export function safeAuthorizationMetadata(input: Record<string, unknown> = {}): Record<string, Json> {
  const metadata: Record<string, Json> = {};

  const tipoDte = Number(input.tipo_dte);
  if (Number.isInteger(tipoDte) && [33, 34, 39, 41].includes(tipoDte)) {
    metadata.tipo_dte = tipoDte;
  }

  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (/^[a-z0-9_:-]{1,48}$/i.test(source)) {
    metadata.source = source;
  }

  const uiContext = typeof input.ui_context === "string" ? input.ui_context.trim() : "";
  if (/^[a-z0-9_:-]{1,48}$/i.test(uiContext)) {
    metadata.ui_context = uiContext;
  }

  return metadata;
}

export async function getEmissionAuthorizationStatus(args: {
  sb: Sb;
  cuentaId: string;
  empresaId: string;
  userId: string;
  provider: EmissionAuthorizationProvider;
  legalVersion?: string;
}): Promise<EmissionAuthorizationStatus> {
  const legalVersion = args.legalVersion ?? CURRENT_EMISSION_AUTHORIZATION_VERSION;
  const now = new Date().toISOString();

  const { data, error } = await args.sb
    .from("emission_authorizations")
    .select("id, accepted_at, legal_version")
    .eq("cuenta_id", args.cuentaId)
    .eq("empresa_id", args.empresaId)
    .eq("usuario_id", args.userId)
    .eq("provider", args.provider)
    .eq("legal_version", legalVersion)
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .maybeSingle();

  if (error) throw new Error(`EMISSION_AUTHORIZATION_QUERY_FAILED:${error.message}`);

  if (!data) return { authorized: false, legal_version: legalVersion };
  return {
    authorized: true,
    legal_version: data.legal_version,
    authorization_id: data.id,
    accepted_at: data.accepted_at,
  };
}

export async function recordEmissionAuthorization(args: {
  sb: Sb;
  cuentaId: string;
  empresaId: string;
  userId: string;
  provider: EmissionAuthorizationProvider;
  source?: string;
  metadata?: Record<string, unknown>;
  legalVersion?: string;
}): Promise<EmissionAuthorizationStatus> {
  const legalVersion = args.legalVersion ?? CURRENT_EMISSION_AUTHORIZATION_VERSION;
  const existing = await getEmissionAuthorizationStatus({ ...args, legalVersion });
  if (existing.authorized) return existing;

  const metadata = safeAuthorizationMetadata({
    ...(args.metadata ?? {}),
    source: args.source ?? "emision_directa",
  });

  const { data, error } = await args.sb
    .from("emission_authorizations")
    .insert({
      cuenta_id: args.cuentaId,
      empresa_id: args.empresaId,
      usuario_id: args.userId,
      provider: args.provider,
      legal_version: legalVersion,
      source: args.source ?? "emision_directa",
      metadata,
    })
    .select("id, accepted_at, legal_version")
    .single();

  if (error) {
    const retry = await getEmissionAuthorizationStatus({ ...args, legalVersion });
    if (retry.authorized) return retry;
    throw new Error(`EMISSION_AUTHORIZATION_INSERT_FAILED:${error.message}`);
  }

  return {
    authorized: true,
    legal_version: data.legal_version,
    authorization_id: data.id,
    accepted_at: data.accepted_at,
  };
}
