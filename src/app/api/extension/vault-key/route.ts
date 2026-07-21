import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { requireAccountApiAccess } from "@/lib/api/account-guard";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { recordOpsEvent } from "@/lib/ops/events";

// Endpoint del "casillero" de la bóveda SII v2 (envelope encryption). Entrega WS
// —una mitad de la llave, 32 bytes por usuario+dispositivo— SOLO al service worker
// de la extensión, autenticado con la sesión de la app. La otra mitad (las
// credenciales cifradas) jamás sale del equipo del usuario; este servidor NUNCA
// ve la Clave Tributaria. Ley 21.719: Art. 14 quinquies a) (cifrado), Art. 14
// quáter (privacidad desde el diseño), Art. 14 sexies (revocación = medida de
// resguardo ante brecha), y la auditoría de cada entrega cubre la carga de la
// prueba del Art. 14 quinquies (inciso final: el responsable debe ACREDITAR que
// las medidas existían y funcionaban).
export const runtime = "nodejs";

const WS_BYTES = 32;

// El gate anti-XSS: el Origin de un fetch lo pone el navegador, no el JS. Un XSS en
// la PÁGINA de la app llevaría Origin = origen de la app → rechazado. Solo el SW de
// la extensión manda Origin chrome-extension://<id>. (Por eso el endpoint es POST:
// un GET mismo-origen no lleva header Origin y el gate sería inservible.)
function originAllowed(origin: string | null): boolean {
  if (!origin || !origin.startsWith("chrome-extension://")) return false;
  const allow = (process.env.EXTENSION_ORIGIN_ALLOWLIST || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  // Sin allowlist (dev): basta que sea una extensión. Con allowlist (prod): match exacto.
  return allow.length === 0 || allow.includes(origin);
}

// WS se guarda CIFRADO en reposo con un secreto de entorno (defensa en profundidad:
// un dump de la DB solo no rinde llaves; hace falta también el secreto del entorno).
// EXTENSION_VAULT_WRAP_SECRET DEBE ser aleatorio de alta entropía (≥32 chars: idealmente
// `openssl rand -base64 32`), NO una frase — con sha256 crudo, un secreto débil sería
// fuerza-bruteable desde un dump de la DB.
function wrapKey(): Buffer | null {
  const secret = process.env.EXTENSION_VAULT_WRAP_SECRET;
  if (!secret || secret.length < 32) return null;
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptWs(wsB64: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(wsB64, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function decryptWs(stored: string, key: Buffer): string | null {
  try {
    const [ivB64, tagB64, ctB64] = String(stored).split(":");
    if (!ivB64 || !tagB64 || !ctB64) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    return null;
  }
}

function noStore(json: unknown, status = 200) {
  return NextResponse.json(json, { status, headers: { "Cache-Control": "no-store" } });
}

function cleanDeviceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
}

export async function POST(request: Request) {
  if (!originAllowed(request.headers.get("origin"))) {
    return noStore({ ok: false, error: "ORIGIN_NO_PERMITIDO" }, 403);
  }

  const guard = await requireAccountApiAccess({ requireEmissionRole: true });
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit({
    key: rateLimitKey("ext-vault-key", guard.userId),
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const key = wrapKey();
  if (!key) return noStore({ ok: false, error: "VAULT_WRAP_SECRET_MISSING" }, 500);

  let body: { action?: string; device_id?: string; all_devices?: boolean };
  try {
    body = await request.json();
  } catch {
    return noStore({ ok: false, error: "BAD_JSON" }, 400);
  }
  const action = body.action;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  // Cliente SIN tipar para la tabla nueva (los tipos generados aún no la incluyen
  // hasta el db push). Es service-role: la tabla no es legible con el JWT del usuario.
  const db = createRawClient(url, serviceKey);

  // ── Revocar (kill-switch, Art. 14 sexies): brickea la bóveda del dispositivo ─────
  if (action === "revoke") {
    if (body.all_devices) {
      await db.from("extension_vault_keys").delete().eq("usuario_id", guard.userId);
    } else {
      const deviceId = cleanDeviceId(body.device_id);
      if (!deviceId) return noStore({ ok: false, error: "DEVICE_ID_INVALIDO" }, 400);
      await db.from("extension_vault_keys").delete().eq("usuario_id", guard.userId).eq("device_id", deviceId);
    }
    await recordOpsEvent({
      severity: "warn", source: "sii-local", eventName: "sii_vault_key_revoked",
      summary: "Bóveda SII revocada (kill-switch)", usuarioId: guard.userId,
      resourceType: "extension_vault", metadata: { all_devices: Boolean(body.all_devices) },
    });
    return noStore({ ok: true, revoked: true });
  }

  const deviceId = cleanDeviceId(body.device_id);
  if (!deviceId) return noStore({ ok: false, error: "DEVICE_ID_INVALIDO" }, 400);

  // ── Registrar (setup): acuña un WS nuevo y lo guarda cifrado. Idempotente por
  //    reemplazo: re-configurar ROTA el WS (la extensión re-envuelve VK). ───────────
  if (action === "register") {
    const ws = crypto.randomBytes(WS_BYTES).toString("base64");
    const { error } = await db.from("extension_vault_keys").upsert({
      usuario_id: guard.userId,
      device_id: deviceId,
      ws_cifrado: encryptWs(ws, key),
      version: 2,
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: "usuario_id,device_id" });
    if (error) return noStore({ ok: false, error: "VAULT_KEY_REGISTER_FAILED", detalle: error.message }, 500);
    await recordOpsEvent({
      severity: "info", source: "sii-local", eventName: "sii_vault_key_registered",
      summary: "Bóveda SII conectada en un dispositivo", usuarioId: guard.userId,
      resourceType: "extension_vault",
    });
    return noStore({ ok: true, user_id: guard.userId, ws });
  }

  // ── Entregar (desbloqueo automático en cada emisión) ─────────────────────────────
  if (action === "get") {
    const { data, error } = await db
      .from("extension_vault_keys")
      .select("ws_cifrado, revoked_at")
      .eq("usuario_id", guard.userId)
      .eq("device_id", deviceId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) return noStore({ ok: false, error: "VAULT_KEY_GET_FAILED", detalle: error.message }, 500);
    if (!data) return noStore({ ok: false, error: "VAULT_KEY_NO_ENCONTRADA" }, 404);
    const ws = decryptWs(String((data as { ws_cifrado: string }).ws_cifrado), key);
    if (!ws) return noStore({ ok: false, error: "VAULT_KEY_CORRUPTA" }, 500);
    await db.from("extension_vault_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("usuario_id", guard.userId).eq("device_id", deviceId);
    // Auditoría de CADA entrega: la carga de la prueba del Art. 14 quinquies.
    await recordOpsEvent({
      severity: "info", source: "sii-local", eventName: "sii_vault_key_delivered",
      summary: "Llave de bóveda SII entregada a la extensión", usuarioId: guard.userId,
      resourceType: "extension_vault",
    });
    return noStore({ ok: true, user_id: guard.userId, ws });
  }

  return noStore({ ok: false, error: "ACTION_INVALIDA" }, 400);
}
