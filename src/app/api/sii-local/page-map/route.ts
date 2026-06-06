import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface SiiPageMapPayload {
  job_id?: string | null;
  map?: unknown;
}

const globalStore = globalThis as typeof globalThis & {
  __appContableSiiPageMaps?: Array<{ received_at: string; user_id: string | null; job_id: string | null; map: unknown }>;
};

function pageMaps() {
  if (!globalStore.__appContableSiiPageMaps) globalStore.__appContableSiiPageMaps = [];
  return globalStore.__appContableSiiPageMaps;
}

export async function POST(request: Request) {
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
    map: payload.map ?? null,
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  return NextResponse.json({ ok: true, maps: pageMaps().filter((entry) => entry.user_id === user.id) });
}

export const dynamic = "force-dynamic";
