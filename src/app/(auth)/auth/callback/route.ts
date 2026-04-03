import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

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
          return NextResponse.redirect(`${origin}/onboarding`);
        }
      }

      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/login`);
}
