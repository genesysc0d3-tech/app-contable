import { NextResponse } from "next/server";
import { requireAccountApiAccess } from "@/lib/api/account-guard";
import { recordOpsEvent } from "@/lib/ops/events";

// Derecho de SUPRESIÓN (Ley 21.719, Art. 14). Conservador y seguro:
// - Anonimiza la PII del propio perfil (nombre → placeholder; es NOT NULL).
// - Registra la solicitud (auditoría), sin contenido.
// - NO borra documentos tributarios (DTE): se conservan 6 años (Código Tributario).
// - NO toca la empresa, datos compartidos ni el usuario de Auth (eso afecta el
//   login y datos de la empresa → lo procesa el operador). Sin CASCADE a ciegas.

export async function POST(request: Request) {
  const guard = await requireAccountApiAccess();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  if ((body as { confirmar?: unknown })?.confirmar !== true) {
    return NextResponse.json(
      {
        ok: false,
        error: "CONFIRMACION_REQUERIDA",
        detalle: 'Envía { "confirmar": true } para ejercer la supresión.',
      },
      { status: 400 },
    );
  }

  const { error } = await guard.service
    .from("usuarios")
    .update({ nombre: "[titular eliminado]" })
    .eq("id", guard.userId);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "SUPRESION_FALLIDA", detalle: error.message },
      { status: 500 },
    );
  }

  await recordOpsEvent({
    sb: guard.service,
    severity: "info",
    source: "derechos",
    eventName: "derecho_supresion_solicitado",
    summary: "Solicitud de supresión del titular (PII de perfil anonimizada)",
    metadata: { usuario_id: guard.userId },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    mensaje:
      "Anonimizamos tu nombre y registramos tu solicitud de supresión. " +
      "Los documentos tributarios (DTE) se conservan 6 años por obligación legal (Código Tributario). " +
      "La eliminación total de la cuenta y el acceso la procesa el operador, porque afecta el inicio de sesión y datos compartidos de la empresa.",
  });
}

export const dynamic = "force-dynamic";
