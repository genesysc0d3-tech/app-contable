import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/config/ai-key
 * Returns whether an AI provider key is configured (never returns the actual key).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "NO_AUTH" }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(`${url}/rest/v1/app_config?name=eq.ai_api_key&select=value`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!res.ok) return NextResponse.json({ configured: false });
  const data = await res.json();
  const configured = Array.isArray(data) && data.length > 0 && !!data[0].value;

  return NextResponse.json({ configured });
}

/**
 * POST /api/config/ai-key
 * Body: { key: string } — saves the AI provider API key to the database.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "NO_AUTH" }, { status: 401 });

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  if (!body.key || typeof body.key !== "string" || !body.key.trim()) {
    return NextResponse.json({ error: "KEY_REQUIRED" }, { status: 422 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  // Upsert: insert or update the api_key config entry
  const upsertRes = await fetch(`${url}/rest/v1/app_config?name=eq.ai_api_key`, {
    method: "PUT",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      name: "ai_api_key",
      value: body.key.trim(),
      updated_at: new Date().toISOString(),
    }),
  });

  if (!upsertRes.ok) {
    const text = await upsertRes.text().catch(() => "");
    return NextResponse.json({ error: "DB_ERROR", detalle: text }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
