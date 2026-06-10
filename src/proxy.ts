import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/masssdte") {
    const target = request.nextUrl.clone();
    target.pathname = "/massdte";
    return NextResponse.redirect(target);
  }

  const legacyDashboardRoutes = new Set([
    "/escritorio",
    "/escritorio/v2",
    "/escritorio/v3",
    "/escritorio/v4",
    "/escritorio/v5",
  ]);

  if (legacyDashboardRoutes.has(request.nextUrl.pathname)) {
    const devBypass = process.env.NODE_ENV !== "production" && request.nextUrl.searchParams.get("legacy") === "1";
    if (!devBypass) {
      const target = request.nextUrl.clone();
      target.pathname = "/massdte";
      target.searchParams.delete("legacy");
      return NextResponse.redirect(target);
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/empresa/upload-logo|api/empresa/logo/|api/sii-local/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
