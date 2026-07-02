import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { POLICY_VERSION } from "@/lib/legal/version";

function safeNextPath(value: string | null): string | null {
  const next = String(value ?? "").trim();
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

async function hasPendingInvite(email: string | undefined): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!email || !url || !key) return false;

  const sb = createServiceClient(url, key);
  const { data } = await sb
    .from("empresa_invitaciones")
    .select("id")
    .eq("estado", "pendiente")
    .gt("expires_at", new Date().toISOString())
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

async function registrarConsentimientoGoogle(
  user: { id: string; email?: string },
  request: Request,
): Promise<void> {
  try {
    const cookieHeader = request.headers.get("cookie") ?? "";
    const m = cookieHeader.match(/(?:^|;\s*)massdte_consent=([^;]+)/);
    if (!m) return; // sin intención de consentimiento (login normal, no signup)
    const version = decodeURIComponent(m[1]).slice(0, 32) || POLICY_VERSION;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const sb = createServiceClient(url, key);
    const { data: existing } = await sb
      .from("consentimientos")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (existing) return; // ya consintió antes
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || request.headers.get("x-real-ip") || null;
    const userAgent = request.headers.get("user-agent") || null;
    await sb.from("consentimientos").insert({
      user_id: user.id,
      email: user.email ?? null,
      documento: "politica-privacidad+terminos",
      version,
      ip,
      user_agent: userAgent,
    });
  } catch {
    // best-effort: no romper el login
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check if user already has a usuario record
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        await registrarConsentimientoGoogle(user, request);
        const { data: usuario } = await supabase
          .from("usuarios")
          .select("id")
          .eq("id", user.id)
          .single();

        if (!usuario) {
          if (next?.startsWith("/invitar/") && await hasPendingInvite(user.email)) {
            return NextResponse.redirect(`${origin}${next}`);
          }
          return NextResponse.redirect(`${origin}/onboarding`);
        }
      }

      return NextResponse.redirect(`${origin}${next ?? "/"}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login`);
}
