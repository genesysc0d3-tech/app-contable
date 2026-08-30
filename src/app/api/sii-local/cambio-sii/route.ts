import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recordOpsEvent } from "@/lib/ops/events";
import { ANCLA_LABELS, ANCLA_LABELS_BOLETA, describeAncla } from "@/lib/emission/sii-libreto";

/**
 * Aviso de POSIBLE CAMBIO DEL PORTAL DEL SII.
 *
 * El worker del RPA avisa (vía app-bridge) que un ANCLA ESTRUCTURAL del portal
 * —un selector/form del libreto que SIEMPRE debería existir— no apareció. Eso,
 * repetido en varias empresas, casi siempre significa que el SII cambió su
 * página. Se registra como evento de ops `warn`; el umbral a "crítico"
 * (varias empresas distintas en poco rato → Telegram) lo calcula el panel /dev
 * al leer (ver collectOpsSnapshot).
 *
 * NO frena nada de la emisión y NO recibe datos del cliente: solo el ROL del
 * ancla del portal (público), la página, la versión y el tipo. El `ancla` se
 * valida contra la lista blanca de roles conocidos para que un cliente no pueda
 * inyectar texto arbitrario en ops_events.
 */
interface CambioSiiPayload {
  job_id?: string | null;
  portal?: string | null;
  ancla?: string | null;
  error?: string | null;
  page_kind?: string | null;
  libreto_version?: number | null;
  extension_version?: string | null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

  let payload: CambioSiiPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  // Lista blanca: solo roles de ancla conocidos. Cualquier otra cosa se
  // normaliza a "otro" — el cliente no escribe texto libre en ops_events.
  const anclaRaw = typeof payload.ancla === "string" ? payload.ancla.trim() : "";
  const anclaConocida = anclaRaw in ANCLA_LABELS || anclaRaw in ANCLA_LABELS_BOLETA;
  const ancla = anclaConocida ? anclaRaw : "otro";
  const portal = payload.portal === "boletas" ? "boletas" : "facturas";
  const tipoDoc = portal === "boletas" ? "boleta" : "factura";

  // empresa_id del usuario (para poder contar EMPRESAS distintas en el umbral).
  const { data: u } = await supabase.from("usuarios").select("empresa_id").eq("id", user.id).maybeSingle();

  await recordOpsEvent({
    severity: "warn", // 1 empresa = a vigilar; la escalada a crítico es en lectura
    source: "sii-local",
    eventName: "sii_local_posible_cambio_ancla",
    summary: `Portal SII (${tipoDoc}): no apareció ${describeAncla(ancla)}`,
    empresaId: u?.empresa_id ?? null,
    usuarioId: user.id,
    resourceType: "emision_job",
    resourceId: typeof payload.job_id === "string" ? payload.job_id : null,
    metadata: {
      ancla, // rol estable → clave de agrupación en /dev
      portal,
      error: typeof payload.error === "string" ? payload.error.slice(0, 60) : null,
      page_kind: typeof payload.page_kind === "string" ? payload.page_kind.slice(0, 40) : null,
      libreto_version: typeof payload.libreto_version === "number" ? payload.libreto_version : null,
      extension_version: typeof payload.extension_version === "string" ? payload.extension_version : null,
    },
  });

  return NextResponse.json({ ok: true });
}
