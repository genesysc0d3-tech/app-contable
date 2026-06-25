import { NextResponse } from "next/server";
import { requireAccountApiAccess } from "@/lib/api/account-guard";
import { recordOpsEvent } from "@/lib/ops/events";

// Derecho de ACCESO + PORTABILIDAD (Ley 21.719, Art. 14): el titular descarga
// todos sus datos en formato estructurado. Solo lectura. No incluye contraseñas
// ni secretos (la autenticación vive en Supabase Auth, no en estas tablas).

// Tablas con datos del titular, scopeadas por empresa_id (tolerante por tabla).
const TABLAS_EMPRESA = [
  "clientes",
  "proveedores",
  "boletas_emitidas",
  "documentos_subidos",
  "movimientos_raw",
  "propuestas_ia",
  "documentos_tributarios",
  "gastos",
] as const;

export async function GET() {
  const guard = await requireAccountApiAccess();
  if (!guard.ok) return guard.response;

  const datos: Record<string, unknown> = {};

  const { data: usuario } = await guard.service
    .from("usuarios")
    .select("id, email, nombre, rol, empresa_id, created_at")
    .eq("id", guard.userId)
    .maybeSingle();
  datos.usuario = usuario ?? null;

  const { data: empresa } = await guard.service
    .from("empresas")
    .select("*")
    .eq("id", guard.empresaId)
    .maybeSingle();
  datos.empresa = empresa ?? null;

  for (const tabla of TABLAS_EMPRESA) {
    const { data, error } = await guard.service
      .from(tabla)
      .select("*")
      .eq("empresa_id", guard.empresaId)
      .limit(5000);
    datos[tabla] = error ? { no_exportable: error.message } : (data ?? []);
  }

  await recordOpsEvent({
    sb: guard.service,
    severity: "info",
    source: "derechos",
    eventName: "derecho_acceso_export",
    summary: "Exportación de datos del titular (acceso/portabilidad)",
    metadata: { empresa_id: guard.empresaId },
  }).catch(() => {});

  const payload = JSON.stringify(
    { exportado_at: new Date().toISOString(), titular: guard.userId, datos },
    null,
    2,
  );

  return new NextResponse(payload, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="mis-datos-${guard.empresaId}.json"`,
    },
  });
}

export const dynamic = "force-dynamic";
