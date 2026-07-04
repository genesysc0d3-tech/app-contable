import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { collectOpsSnapshot } from "@/lib/ops/diagnostics";
import { recordOpsError, recordOpsEvent } from "@/lib/ops/events";

function requireCronAuth(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient<Database>(url, key);
}

type OpsSnapshot = Awaited<ReturnType<typeof collectOpsSnapshot>>;

function formatAlertText(snapshot: OpsSnapshot) {
  const critical = snapshot.findings.filter((finding) => finding.severity === "critical");
  const lines = critical.map((finding) => `• ${finding.eventName}: ${finding.summary}`);
  return [
    `🔴 MassDTE — ${critical.length} alerta(s) crítica(s)`,
    `estado: ${snapshot.status}`,
    ...lines,
  ].join("\n");
}

// Bot de alertas DEDICADO (separado del bot de comprobantes TELEGRAM_BOT_TOKEN).
// Las alertas son resúmenes ya sanitizados; no llevan datos crudos.
async function sendTelegramAlert(text: string): Promise<boolean> {
  const token = process.env.OPS_TG_BOT_TOKEN?.trim();
  const chatId = process.env.OPS_TG_CHAT_ID?.trim();
  if (!token || !chatId) return false;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  return res.ok;
}

async function sendAlert(snapshot: OpsSnapshot) {
  if (snapshot.findings.every((finding) => finding.severity !== "critical")) return false;

  let sent = false;

  const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "app-contable",
        status: snapshot.status,
        checked_at: snapshot.checkedAt,
        metrics: snapshot.metrics,
        findings: snapshot.findings.map((finding) => ({
          severity: finding.severity,
          event_name: finding.eventName,
          summary: finding.summary,
        })),
      }),
    });
    if (response.ok) sent = true;
  }

  if (await sendTelegramAlert(formatAlertText(snapshot))) sent = true;

  return sent;
}

export async function GET(request: Request) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
  }

  const sb = serviceClient();
  if (!sb) return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });

  try {
    const snapshot = await collectOpsSnapshot(sb);
    const recordableFindings = snapshot.findings.filter((finding) => !finding.eventName.startsWith("ops_"));

    await Promise.all(recordableFindings.map((finding) => recordOpsEvent({
      sb,
      severity: finding.severity,
      source: "ops/cron",
      eventName: finding.eventName,
      summary: finding.summary,
      metadata: finding.metadata,
    })));

    let alerted = false;
    try {
      alerted = await sendAlert(snapshot);
    } catch (alertError) {
      await recordOpsError({
        sb,
        severity: "error",
        source: "ops/cron",
        eventName: "ops_alert_failed",
        summary: "No se pudo enviar alerta operacional",
        error: alertError,
      });
    }

    return NextResponse.json({
      ok: true,
      checked_at: snapshot.checkedAt,
      status: snapshot.status,
      metrics: snapshot.metrics,
      findings: snapshot.findings,
      query_errors: snapshot.queryErrors,
      alerted,
    });
  } catch (error) {
    await recordOpsError({
      sb,
      severity: "critical",
      source: "ops/cron",
      eventName: "ops_cron_failed",
      summary: "El cron de salud operacional fallo",
      error,
    });
    return NextResponse.json({ ok: false, error: "ERROR_INTERNO" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
