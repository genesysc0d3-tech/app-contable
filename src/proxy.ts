import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/masssdte") {
    const target = request.nextUrl.clone();
    target.pathname = "/massdte";
    return NextResponse.redirect(target);
  }

  // Legacy v1-v4 borrado (ver docs/legacy-escritorio-aprendizajes.md). Se
  // conserva el redirect para bookmarks viejos; /escritorio/v5 sigue siendo
  // el código real re-exportado por /massdte, pero la URL canónica es esa.
  const legacyDashboardRoutes = new Set([
    "/escritorio",
    "/escritorio/v2",
    "/escritorio/v3",
    "/escritorio/v4",
    "/escritorio/v5",
  ]);

  if (legacyDashboardRoutes.has(request.nextUrl.pathname)) {
    const target = request.nextUrl.clone();
    target.pathname = "/massdte";
    target.searchParams.delete("legacy");
    return NextResponse.redirect(target);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    // Webhooks/callbacks externos (Telegram, MercadoPago, cron, SII local)
    // NO pasan por el check de sesión: llegan sin cookie de usuario y tienen
    // su propia autenticación (secret header / Bearer). Sin esto el middleware
    // los redirige a /auth/login y nunca se ejecutan.
    "/((?!_next/static|_next/image|favicon.ico|legal(?:/.*)?$|instalar-extension$|descargas(?:/.*)?$|api/empresa/upload-logo|api/empresa/logo/|api/archivo/|api/sii-local/|api/extension/|api/telegram/|api/pagos/webhook|api/pagos/flow/|api/pagos/cron|api/ops/cron|api/document-processing/cron|api/document-processing/kick|api/audit/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
