import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "../database.types";
import { debeRefrescarUltimoAcceso, sesionVencidaPorInactividad } from "@/lib/auth/inactividad-sesion";
import { aalDelToken, necesitaMfa } from "@/lib/auth/mfa-proxy";

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

  // Cierre por inactividad: acá se CIERRA de verdad (signOut revoca del lado del
  // servidor), no solo se redirige. Importa para la extensión: su cookie vive en
  // este mismo Chrome, así que al revocar la sesión la bóveda del SII deja de
  // poder abrirse también allá. El guard de las rutas es el cinturón; esto es el
  // tirante. Ver lib/auth/inactividad-sesion.ts.
  if (user) {
    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (sbUrl && sbKey) {
      const { createClient: createServiceClient } = await import("@supabase/supabase-js");
      const sb = createServiceClient(sbUrl, sbKey);
      const { data: visto } = await sb.from("usuarios").select("ultimo_acceso").eq("id", user.id).maybeSingle();
      // last_sign_in_at: un login recién hecho nunca está "vencido" (incidente 2026-09-22).
      if (sesionVencidaPorInactividad(visto?.ultimo_acceso, Date.now(), user.last_sign_in_at)) {
        try { await supabase.auth.signOut(); } catch { /* igual se manda a login */ }
        const url = request.nextUrl.clone();
        url.pathname = "/auth/login";
        url.searchParams.set("motivo", "sesion_vencida");
        return NextResponse.redirect(url);
      }
      if (debeRefrescarUltimoAcceso(visto?.ultimo_acceso)) {
        await sb.from("usuarios").update({ ultimo_acceso: new Date().toISOString() }).eq("id", user.id);
      }
    }
  }

  if (user) {
    // MFA opt-in (Supabase Auth). Solo afecta a quien YA enroló un factor verificado
    // y está en aal1: debe completar el challenge. FAIL-CLOSED (auditoría #4).
    // Factores = los del USUARIO QUE DEVOLVIÓ EL SERVIDOR (getUser de arriba), NO los
    // de la cookie: getAuthenticatorAssuranceLevel() sin token los lee de la cookie
    // y una cookie editada sin factores se saltaba el MFA (2026-09-28, ver mfa-proxy.ts).
    // El aal sale del access token que getUser acaba de validar contra Auth.
    const { data: sesion } = await supabase.auth.getSession();
    const needsMfa = necesitaMfa({
      aalActual: aalDelToken(sesion.session?.access_token),
      factoresServidor: user.factors as Array<{ status?: string | null }> | undefined,
    });

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
