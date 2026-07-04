import { NextResponse } from "next/server";
import { requireAccountApiAccess } from "@/lib/api/account-guard";
import { recordCuentaAudit } from "@/lib/audit/account";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import {
  CURRENT_EMISSION_AUTHORIZATION_VERSION,
  cleanEmissionAuthorizationProvider,
  getEmissionAuthorizationStatus,
  recordEmissionAuthorization,
  safeAuthorizationMetadata,
} from "@/lib/emission/authorizations";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  const guard = await requireAccountApiAccess({ requirePlan: true, requireEmissionRole: true });
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const provider = cleanEmissionAuthorizationProvider(url.searchParams.get("provider"));
  if (!provider) return NextResponse.json({ ok: false, error: "PROVIDER_INVALID" }, { status: 400 });

  try {
    const status = await getEmissionAuthorizationStatus({
      sb: guard.service,
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      userId: guard.userId,
      provider,
    });

    return NextResponse.json({ ok: true, provider, ...status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "EMISSION_AUTHORIZATION_QUERY_FAILED", detalle: error instanceof Error ? error.message : undefined },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return NextResponse.json({ ok: false, error: "DEV_SUPPORT_READ_ONLY", detalle: supportBlock.error }, { status: 403 });

  const guard = await requireAccountApiAccess({ requirePlan: true, requireEmissionRole: true });
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit({
    key: rateLimitKey("emision-authorizations-post", guard.userId),
    limit: 8,
    windowMs: 60_000,
  });
  if (limited) return limited;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const provider = cleanEmissionAuthorizationProvider(payload.provider);
  if (!provider) return NextResponse.json({ ok: false, error: "PROVIDER_INVALID" }, { status: 400 });

  try {
    const status = await recordEmissionAuthorization({
      sb: guard.service,
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      userId: guard.userId,
      provider,
      source: "emision_directa",
      metadata: safeAuthorizationMetadata(payload),
    });

    await recordCuentaAudit({
      sb: guard.service,
      cuentaId: guard.cuentaId,
      empresaId: guard.empresaId,
      usuarioId: guard.userId,
      accion: "emision_autorizacion_aceptada",
      recursoTipo: "emission_authorization",
      recursoId: status.authorization_id ?? null,
      resumen: provider === "sii_local"
        ? "Usuario autorizo emision asistida via SII local"
        : "Usuario autorizo emision via SimpleAPI",
      metadata: {
        provider,
        legal_version: CURRENT_EMISSION_AUTHORIZATION_VERSION,
        ...safeAuthorizationMetadata(payload),
      },
    });

    return NextResponse.json({ ok: true, provider, ...status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "EMISSION_AUTHORIZATION_INSERT_FAILED", detalle: error instanceof Error ? error.message : undefined },
      { status: 500 },
    );
  }
}
