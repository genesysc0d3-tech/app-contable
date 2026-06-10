import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

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
