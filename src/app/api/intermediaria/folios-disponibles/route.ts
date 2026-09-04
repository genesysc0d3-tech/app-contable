import { NextResponse } from "next/server";
import { requireAccountApiAccess } from "@/lib/api/account-guard";

/**
 * Devuelve folios disponibles por tipo DTE para la empresa del usuario.
 * Usado por la UI para mostrar "te quedan X folios" y bloquear emisión
 * cuando hay 0.
 */
export async function GET() {
  const guard = await requireAccountApiAccess({ requirePlanOTrial: true, requireEmissionRole: true });
  if (!guard.ok) return guard.response;

  const { data: cafs } = await guard.service
    .from("boletas_caf_mock")
    .select("id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado, fecha_vence")
    .eq("empresa_id", guard.empresaId)
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
