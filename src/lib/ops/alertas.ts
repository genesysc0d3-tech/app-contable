import "server-only";

import { enviarCorreo } from "@/lib/correo";

/**
 * Envío de alertas críticas de operaciones AL TIRO (tanda 1 RPA, 2026-09-10).
 *
 * Hasta hoy la única alerta salía del cron diario (src/app/api/ops/cron/route.ts,
 * sendAlert): si el SII cambiaba su portal a las 9 de la mañana, el correo
 * llegaba al día siguiente. Esto es el MISMO envío (webhook + Telegram + correo,
 * mismas variables de entorno, mismo formato) extraído a un módulo para que
 * también lo pueda gatillar el auto-kill de cambio-sii en el momento.
 *
 * El cron NO se tocó (sigue con su copia interna): cambiarlo sin necesidad es
 * riesgo gratis. Si un día se unifica, este módulo es la fuente.
 *
 * Reglas: solo resúmenes ya sanitizados (sin RUT, sin nombre de cliente, sin
 * payloads). Best-effort: jamás lanza; devuelve si algún canal aceptó.
 */
export interface AlertaFinding {
  severity: string;
  eventName: string;
  summary: string;
}

export interface AlertaOps {
  status: string;
  checkedAt: string;
  findings: AlertaFinding[];
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatAlertText(alerta: AlertaOps, criticos: AlertaFinding[]) {
  const lines = criticos.map((f) => `• ${f.eventName}: ${f.summary}`);
  return [`🔴 MassDTE — ${criticos.length} alerta(s) crítica(s)`, `estado: ${alerta.status}`, ...lines].join("\n");
}

async function sendTelegram(text: string): Promise<boolean> {
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

async function sendWebhook(alerta: AlertaOps, criticos: AlertaFinding[]): Promise<boolean> {
  const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return false;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "app-contable",
      status: alerta.status,
      checked_at: alerta.checkedAt,
      findings: criticos.map((f) => ({ severity: f.severity, event_name: f.eventName, summary: f.summary })),
    }),
  });
  return response.ok;
}

async function sendEmail(alerta: AlertaOps, criticos: AlertaFinding[]): Promise<boolean> {
  const para = process.env.OPS_ALERTA_EMAIL?.trim();
  if (!para) return false;
  const lineas = criticos
    .map((f) => `<li style="margin:6px 0"><b>${escapeHtml(f.eventName)}</b>: ${escapeHtml(f.summary)}</li>`)
    .join("");
  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#1a1a1a">
  <div style="font-size:19px;font-weight:800;letter-spacing:-.02em;margin-bottom:18px">mass<span style="color:#E8553E">DTE</span> · ops</div>
  <p style="font-size:15px;font-weight:700;margin:0 0 10px">Algo crítico en producción</p>
  <ul style="padding-left:18px;font-size:14px;line-height:1.45">${lineas}</ul>
  <p style="font-size:12px;color:#666;margin-top:16px">Revisado ${escapeHtml(alerta.checkedAt)} · estado ${escapeHtml(alerta.status)}. Detalle en el panel /dev.</p>
</div>`;
  const r = await enviarCorreo({
    para,
    asunto: `[massDTE ops] ${criticos.length} crítico${criticos.length === 1 ? "" : "s"} en producción`,
    html,
  });
  return r.ok;
}

/**
 * Manda la alerta por todos los canales configurados. Solo hallazgos `critical`;
 * sin críticos no manda nada. Cada canal se intenta aunque el anterior falle.
 */
export async function enviarAlertaCritica(alerta: AlertaOps): Promise<{ enviada: boolean; errores: string[] }> {
  const criticos = alerta.findings.filter((f) => f.severity === "critical");
  if (criticos.length === 0) return { enviada: false, errores: [] };
  const errores: string[] = [];
  let enviada = false;
  const intentos: Array<[string, () => Promise<boolean>]> = [
    ["webhook", () => sendWebhook(alerta, criticos)],
    ["telegram", () => sendTelegram(formatAlertText(alerta, criticos))],
    ["correo", () => sendEmail(alerta, criticos)],
  ];
  for (const [canal, fn] of intentos) {
    try {
      if (await fn()) enviada = true;
    } catch (error) {
      errores.push(`${canal}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { enviada, errores };
}
