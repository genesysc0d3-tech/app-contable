import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// Estado del conector MCP para el USUARIO de la sesión — alimenta el chip
// "MCP ✓/✕" de la barra de la mesa. Solo dice QUÉ asistente está enchufado
// (Claude / ChatGPT / otro), jamás devuelve tokens ni hashes.
//
// "Vivo" = no revocado Y (tiene refresh para renovarse, o su access no ha
// vencido, o es un token manual sin expiración).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "NO_AUTH" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  const service = createServiceClient(url, key);

  const { data, error } = await service
    .from("mcp_tokens")
    .select("expires_at, refresh_token_hash, origen, oauth_clients(redirect_uris)")
    .eq("usuario_id", user.id)
    .is("revoked_at", null);
  if (error) return NextResponse.json({ error: "QUERY_FAILED" }, { status: 500 });

  let claude = false, chatgpt = false, otros = 0;
  const ahora = Date.now();
  for (const t of data ?? []) {
    const vivo = t.refresh_token_hash != null || t.expires_at == null || new Date(t.expires_at).getTime() > ahora;
    if (!vivo) continue;
    // El embed puede tipear objeto o arreglo según la FK: se normaliza a lista de strings.
    const cliente = (Array.isArray(t.oauth_clients) ? t.oauth_clients[0] : t.oauth_clients) as { redirect_uris?: unknown } | null;
    const uris: string[] = Array.isArray(cliente?.redirect_uris) ? cliente.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (uris.some((u) => /^https:\/\/claude\.(ai|com)\//.test(u))) claude = true;
    else if (uris.some((u) => /^https:\/\/(chatgpt|openai)\.com\//.test(u))) chatgpt = true;
    else otros += 1; // token manual del script u otro cliente permitido
  }

  return NextResponse.json({ claude, chatgpt, otros }, { headers: { "cache-control": "no-store" } });
}
