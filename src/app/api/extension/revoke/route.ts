import { NextResponse } from "next/server";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { requireAccountApiAccess } from "@/lib/api/account-guard";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";
import { recordOpsEvent } from "@/lib/ops/events";

// Kill-switch de la bóveda SII alcanzable DESDE LA APP (no desde la extensión):
// si el usuario pierde el equipo, revoca desde el teléfono/otro navegador. Borra
// TODAS las llaves WS del usuario → cada bóveda (en cualquier dispositivo) queda
// inservible: sin WS no se puede desenvolver VK, y el ciphertext local sin VK es
// indescifrable. Ley 21.719 Art. 14 sexies: "medida de solución o resguardo" para
// responder a un incidente. A diferencia de /api/extension/vault-key (que exige
// Origin chrome-extension://), esta ruta la llama la PÁGINA de la app con su sesión.
export const runtime = "nodejs";

export async function POST() {
  const guard = await requireAccountApiAccess({ requireEmissionRole: true });
  if (!guard.ok) return guard.response;

  const limited = enforceRateLimit({
    key: rateLimitKey("ext-vault-revoke", guard.userId),
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const db = createRawClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { error } = await db.from("extension_vault_keys").delete().eq("usuario_id", guard.userId);
  if (error) {
    return NextResponse.json({ ok: false, error: "REVOKE_FAILED", detalle: error.message }, { status: 500 });
  }

  await recordOpsEvent({
    severity: "warn", source: "sii-local", eventName: "sii_vault_revoked_from_app",
    summary: "Bóveda SII revocada en todos los equipos (desde la app)", usuarioId: guard.userId,
    resourceType: "extension_vault",
  });
  return NextResponse.json({ ok: true, revoked: true }, { headers: { "Cache-Control": "no-store" } });
}
