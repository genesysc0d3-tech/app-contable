import "server-only";

import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { errorMetadata, sanitizeOpsMetadata } from "@/lib/ops/sanitize";

export type OpsSeverity = "info" | "warn" | "error" | "critical";
export type OpsSource =
  | "upload"
  | "ocr"
  | "ia"
  | "pagos"
  | "pagos/webhook"
  | "pagos/cron"
  | "emision"
  | "sii-local"
  | "simpleapi"
  | "telegram"
  | "ops/cron"
  | "dev-support"
  | "auth";

type Sb = SupabaseClient<Database>;

export type OpsEventInput = {
  sb?: Sb;
  severity: OpsSeverity;
  source: OpsSource;
  eventName: string;
  summary: string;
  cuentaId?: string | null;
  empresaId?: string | null;
  usuarioId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient<Database>(url, key);
}

function cleanText(value: string, max = 180) {
  const text = value.trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max)}...[truncated:${text.length}]` : text;
}

export async function recordOpsEvent(input: OpsEventInput) {
  try {
    const sb = input.sb ?? serviceClient();
    if (!sb) return;

    const metadata = sanitizeOpsMetadata(input.metadata);
    const { error } = await sb.from("ops_events").insert({
      severity: input.severity,
      source: cleanText(input.source, 80),
      event_name: cleanText(input.eventName, 120),
      cuenta_id: input.cuentaId ?? null,
      empresa_id: input.empresaId ?? null,
      usuario_id: input.usuarioId ?? null,
      resource_type: input.resourceType ? cleanText(input.resourceType, 80) : null,
      resource_id: input.resourceId ? cleanText(input.resourceId, 120) : null,
      summary: cleanText(input.summary),
      metadata: metadata as Json,
    });
    if (error) console.warn("[ops-events] insert fallo:", error.message);
  } catch (error) {
    console.warn("[ops-events] no se pudo registrar evento:", error instanceof Error ? error.message : String(error));
  }
}

export async function recordOpsError(input: Omit<OpsEventInput, "severity" | "metadata"> & {
  severity?: Extract<OpsSeverity, "error" | "critical">;
  error: unknown;
  metadata?: Record<string, unknown>;
}) {
  await recordOpsEvent({
    ...input,
    severity: input.severity ?? "error",
    metadata: {
      ...input.metadata,
      ...errorMetadata(input.error),
    },
  });
}
