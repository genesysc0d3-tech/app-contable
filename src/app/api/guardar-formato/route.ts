import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  let body: { fingerprint?: string; nombre?: string; roles?: string[]; headerRow?: string[]; txStart?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  if (!body.fingerprint || !body.roles || body.roles.length === 0) {
    return NextResponse.json({ error: "FALTAN_DATOS" }, { status: 422 });
  }

  const roles = body.roles as string[];

  // Build adapter config from roles
  const columnIdx: Record<string, number> = {};
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    if (role === "ignorar") continue;
    columnIdx[role] = i;
  }

  // Determine layout using detected txStart or headers
  const txStart = body.txStart ?? 0;
  const hasHeader = (body.headerRow?.some((h) => h.trim()) ?? false) || txStart > 0;
  const config = {
    header_row: hasHeader ? Math.max(0, txStart - 1) : -1,
    skip_rows_before_data: txStart,
    data_row: hasHeader ? Math.max(0, txStart) : 0,
    date_row: 0,
    date_format: "dd/mm/yyyy",
    layout: "single_col",
    columns: columnIdx,
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createServiceClient(url, serviceKey);

  // Save to parser_adapters
  const { error: upsertError } = await sb
    .from("parser_adapters")
    .upsert({
      fingerprint: body.fingerprint,
      source: "manual",
      nombre: body.nombre || `Formato manual`,
      config,
      confianza: 1.0,
      usage_count: 0,
      success_count: 0,
      failure_count: 0,
    }, { onConflict: "fingerprint" });

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, fingerprint: body.fingerprint });
}
