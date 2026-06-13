// TEMPORAL — diagnóstico Cloudflare Vercel→OpenCode. BORRAR.
import { NextResponse } from "next/server";
const TOKEN = "fda72973b0c9070e";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function probe(method: string, path: string, body?: object) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 12000);
  const t0 = Date.now();
  try {
    const res = await fetch(`https://opencode.ai/zen/go/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.OPENCODE_GO_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": UA,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const txt = await res.text();
    return { status: res.status, ms: Date.now() - t0, body: txt.slice(0, 160) };
  } catch (e) {
    return { status: "throw", ms: Date.now() - t0, body: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(to);
  }
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("k") !== TOKEN)
    return NextResponse.json({ error: "no" }, { status: 401 });
  const get = await probe("GET", "/models");
  const post = await probe("POST", "/chat/completions", {
    model: "minimax-m3",
    temperature: 0.1,
    messages: [{ role: "user", content: "responde solo: ok" }],
  });
  return NextResponse.json({ tiene_key: !!process.env.OPENCODE_GO_API_KEY, GET_models: get, POST_chat: post });
}
export const dynamic = "force-dynamic";
export const maxDuration = 40;
