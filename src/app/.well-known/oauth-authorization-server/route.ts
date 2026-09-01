import { NextResponse } from "next/server";
import { metadataAuthorizationServer } from "@/lib/mcp/oauth";

// RFC 8414: los clientes MCP (claude.ai, ChatGPT) descubren acá dónde
// autorizar, canjear tokens y registrarse.
export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return NextResponse.json(metadataAuthorizationServer(origin), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
