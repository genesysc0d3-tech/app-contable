import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "../database.types";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/auth");
  const isPublicRoute = isAuthRoute || pathname === "/bloqueado";

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  if (user) {
    // MFA opt-in (Supabase Auth). Solo afecta a quien YA enroló un factor verificado
    // y está en aal1: debe completar el challenge. FAIL-CLOSED (auditoría #4): si el
    // chequeo de aal falla, NO dejamos pasar a quien tiene un factor verificado —
    // pero sí a quien no enroló MFA (no tiene nada que completar, no lo encerramos).
    let needsMfa = false;
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      needsMfa = aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2";
    } catch {
      const factores = (user.factors ?? []) as Array<{ status?: string | null }>;
      needsMfa = factores.some((f) => f.status === "verified");
    }

    if (needsMfa) {
      // Rutas protegidas → al challenge. Cualquier /auth/* (challenge, logout,
      // callback) queda permitido, para no encerrar al usuario.
      if (!isAuthRoute) {
        const url = request.nextUrl.clone();
        url.pathname = "/auth/mfa";
        return NextResponse.redirect(url);
      }
      return supabaseResponse;
    }

    // Sin MFA pendiente: comportamiento previo (logueado en /auth/* → "/").
    if (isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
