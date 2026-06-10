import { proxySimpleApiMultipart } from "@/lib/emission/simpleapi-multipart-proxy";

export async function POST(request: Request) {
  return proxySimpleApiMultipart(request, "impresion/base64/carta/v2/cedible");
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
