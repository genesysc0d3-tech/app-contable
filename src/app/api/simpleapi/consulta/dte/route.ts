import { proxySimpleApiMultipart } from "@/lib/emission/simpleapi-multipart-proxy";

export async function POST(request: Request) {
  return proxySimpleApiMultipart(request, "consulta/dte");
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
