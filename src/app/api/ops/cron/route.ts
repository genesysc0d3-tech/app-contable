import { NextResponse } from "next/server";
import { enviarCorreo } from "@/lib/correo";
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

  // CORREO (2026-09-05): el canal más fácil. El bot de ops nunca se creó y el
  // vigilante del respaldo gritaba al vacío — el hallazgo quedaba en el panel,
  // que hay que ir a mirar. Resend YA está en producción y la app ya manda
  // correos: reusarlo no exige crear nada. Misma dirección que usa el propio
  // respaldo del Mac mini para sus alertas, así todo llega al mismo buzón.
  if (await sendEmailAlert(snapshot)) sent = true;

  return sent;
}

async function sendEmailAlert(snapshot: OpsSnapshot): Promise<boolean> {
  const para = process.env.OPS_ALERTA_EMAIL?.trim();
  if (!para) return false;
  const criticos = snapshot.findings.filter((f) => f.severity === "critical");
  const lineas = criticos
    .map((f) => `<li style="margin:6px 0"><b>${escapeHtml(f.eventName)}</b>: ${escapeHtml(f.summary)}</li>`)
    .join("");
  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#1a1a1a">
  <div style="font-size:19px;font-weight:800;letter-spacing:-.02em;margin-bottom:18px">mass<span style="color:#E8553E">DTE</span> · ops</div>
  <p style="font-size:15px;font-weight:700;margin:0 0 10px">Algo crítico en producción</p>
  <ul style="padding-left:18px;font-size:14px;line-height:1.45">${lineas}</ul>
  <p style="font-size:12px;color:#666;margin-top:16px">Revisado ${escapeHtml(snapshot.checkedAt)} · estado ${escapeHtml(snapshot.status)}. Detalle en el panel /dev.</p>
</div>`;
  const r = await enviarCorreo({ para, asunto: `[massDTE ops] ${criticos.length} crítico${criticos.length === 1 ? "" : "s"} en producción`, html });
  return r.ok;
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
