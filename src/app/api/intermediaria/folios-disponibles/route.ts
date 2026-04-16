import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

/**
 * Devuelve folios disponibles por tipo DTE para la empresa del usuario.
 * Usado por la UI para mostrar "te quedan X folios" y bloquear emisión
 * cuando hay 0.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ ok: false, error: "USUARIO_SIN_EMPRESA" }, { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sb = createServiceClient(url, key);

  const { data: cafs } = await sb
    .from("boletas_caf_mock")
    .select("id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado, fecha_vence")
    .eq("empresa_id", usuario.empresa_id)
    .eq("estado", "activo")
    .gt("fecha_vence", new Date().toISOString());

  // Aggregate disponibles por tipo
  const disponiblesPorTipo: Record<number, number> = { 39: 0, 41: 0, 61: 0 };
  for (const c of cafs ?? []) {
    const restantes = (c.folio_hasta as number) - (c.folio_actual as number) + 1;
    disponiblesPorTipo[c.tipo_dte as number] = (disponiblesPorTipo[c.tipo_dte as number] ?? 0) + Math.max(0, restantes);
  }

  return NextResponse.json({
    ok: true,
    disponibles: {
      boleta_afecta: disponiblesPorTipo[39] ?? 0,
      boleta_exenta: disponiblesPorTipo[41] ?? 0,
      nota_credito: disponiblesPorTipo[61] ?? 0,
    },
    cafs: cafs ?? [],
  });
}
