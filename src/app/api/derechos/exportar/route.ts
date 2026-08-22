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

  // TODAS las empresas de la cuenta, incluidas las desactivadas por downgrade
  // (activa=false): el derecho de acceso/portabilidad no depende del plan — la
  // interfaz puede ocultarlas, la exportación jamás.
  let empresaIds = [guard.empresaId];
  const { data: cuentaLink } = await guard.service
    .from("cuenta_empresas")
    .select("cuenta_id")
    .eq("empresa_id", guard.empresaId)
    .maybeSingle();
  if (cuentaLink?.cuenta_id) {
    const { data: vinculos } = await guard.service
      .from("cuenta_empresas")
      .select("empresa_id")
      .eq("cuenta_id", cuentaLink.cuenta_id);
    if (vinculos?.length) empresaIds = Array.from(new Set(vinculos.map((v) => v.empresa_id)));
  }

  const { data: empresas } = await guard.service
    .from("empresas")
    .select("*")
    .in("id", empresaIds);
  datos.empresas = empresas ?? [];

  for (const tabla of TABLAS_EMPRESA) {
    const { data, error } = await guard.service
      .from(tabla)
      .select("*")
      .in("empresa_id", empresaIds)
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
