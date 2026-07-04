import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface SiiPageMapPayload {
  job_id?: string | null;
  map?: unknown;
}

const globalStore = globalThis as typeof globalThis & {
  __appContableSiiPageMaps?: Array<{ received_at: string; user_id: string | null; job_id: string | null; map: unknown }>;
};

function pageMapEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.MASSDTE_ENABLE_SII_PAGE_MAP === "1";
}

function pageMaps() {
  if (!globalStore.__appContableSiiPageMaps) globalStore.__appContableSiiPageMaps = [];
  return globalStore.__appContableSiiPageMaps;
}

function redactText(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{1,2}\.?\d{3}\.?\d{3}-?[\dkK]\b/g, "[rut]")
    .replace(/\b(clave|password|token|cookie|authorization)\b\s*[:=]?\s*\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 240);
  } catch {
    return redactText(value);
  }
}

function sanitizeMap(value: unknown, depth = 0, key = ""): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") {
    if (/url|href|src/i.test(key)) return safeUrl(value);
    if (/clave|password|token|cookie|authorization|secret/i.test(key)) return "[redacted]";
    return redactText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeMap(item, depth + 1, key));
  if (typeof value !== "object") return null;

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 60)) {
    if (/clave|password|token|cookie|authorization|secret/i.test(entryKey)) {
      output[entryKey] = "[redacted]";
      continue;
    }
    output[entryKey] = sanitizeMap(entryValue, depth + 1, entryKey);
  }
  return output;
}

export async function POST(request: Request) {
  if (!pageMapEnabled()) {
    return NextResponse.json({ ok: true, stored: false, disabled: true });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  let payload: SiiPageMapPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const entry = {
    received_at: new Date().toISOString(),
    user_id: user.id,
    job_id: typeof payload.job_id === "string" ? payload.job_id : null,
    map: sanitizeMap(payload.map ?? null),
  };

  const maps = pageMaps();
  maps.push(entry);
  if (maps.length > 10) maps.splice(0, maps.length - 10);

  if (process.env.NODE_ENV !== "production") {
    console.info("[sii-local-page-map]", entry);
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  if (!pageMapEnabled()) return NextResponse.json({ ok: true, maps: [], disabled: true });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  return NextResponse.json({ ok: true, maps: pageMaps().filter((entry) => entry.user_id === user.id) });
}

export const dynamic = "force-dynamic";
