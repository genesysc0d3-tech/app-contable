import { NextResponse } from "next/server";
import { metadataProtectedResource } from "@/lib/mcp/oauth";

// RFC 9728: el recurso protegido (/api/mcp) declara quién lo autoriza.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json(metadataProtectedResource(origin), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
