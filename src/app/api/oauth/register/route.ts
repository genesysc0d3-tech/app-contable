import { NextResponse } from "next/server";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";
import { validarRegistroCliente } from "@/lib/mcp/oauth";
import { clientIpFromRequest, rateLimitKey } from "@/lib/security/rate-limit";
import { enforceRateLimitGlobal } from "@/lib/security/rate-limit-global";

// Registro dinámico de clientes OAuth (RFC 7591). Abierto por diseño (así
// se registran claude.ai/ChatGPT sin coordinación previa), pero estrecho:
// metadata validada (solo https/loopback, máx 10 URIs) y rate-limit por IP.
// Registrarse NO da acceso a nada: solo habilita PEDIR autorización, que
// siempre pasa por el login + consentimiento del usuario.
export async function POST(request: Request) {
  const limited = await enforceRateLimitGlobal({
    key: rateLimitKey("oauth-register", clientIpFromRequest(request)),
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_client_metadata" }, { status: 400 });
  }
  const registro = validarRegistroCliente(body);
  if ("error" in registro) return NextResponse.json({ error: registro.error }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "server_error" }, { status: 500 });
  // oauth_clients entra a database.types al aplicar la migración; cliente sin
  // tipos mientras tanto (mismo patrón que mcp_tokens en su día).
  const svc = createServiceClient(url, key) as unknown as SupabaseClient;

  const { data, error } = await svc
    .from("oauth_clients")
    .insert({ client_name: registro.client_name, redirect_uris: registro.redirect_uris })
    .select("id, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "server_error" }, { status: 500 });

  return NextResponse.json(
    {
      client_id: data.id,
      client_name: registro.client_name,
      redirect_uris: registro.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(new Date(data.created_at).getTime() / 1000),
    },
    { status: 201 },
  );
}
