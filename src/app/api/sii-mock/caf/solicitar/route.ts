import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";

/**
 * Mock SII: solicitud de Código de Autorización de Folios (CAF).
 * En producción: el contribuyente solicita un rango al SII via web service y
 * recibe un CAF.xml firmado con llave RSA del SII.
 *
 * Mock:
 *   - Recibe { empresa_id, tipo_dte, cantidad }
 *   - Calcula el siguiente folio_desde basado en el último CAF emitido para
 *     ese empresa+tipo (continúa la secuencia como hace el SII real)
 *   - Inserta nuevo registro en boletas_caf_mock
 *   - Retorna el rango asignado
 *
 * Restricciones:
 *   - cantidad min 10, max 1000 (límites parecidos al SII real)
 *   - tipo_dte ∈ {39, 41, 61}
 */

const TIPOS_VALIDOS = [39, 41, 61] as const;
const MIN_FOLIOS = 10;
const MAX_FOLIOS = 1000;

export async function POST(request: Request) {
  let body: { empresa_id?: string; tipo_dte?: number; cantidad?: number } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const { tipo_dte, cantidad } = body;

  // Auth: el empresa_id se DERIVA del usuario autenticado (no se confía en el body),
  // para que nadie mintee folios para una empresa ajena.
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  const empresa_id = usuario?.empresa_id ?? null;
  if (!empresa_id) return NextResponse.json({ ok: false, error: "SIN_EMPRESA" }, { status: 403 });

  if (typeof tipo_dte !== "number" || !TIPOS_VALIDOS.includes(tipo_dte as 39 | 41 | 61)) {
    return NextResponse.json(
      { ok: false, error: "TIPO_DTE_INVALIDO", detalle: `Solo se permite ${TIPOS_VALIDOS.join(", ")}` },
      { status: 400 },
    );
  }
  if (typeof cantidad !== "number" || cantidad < MIN_FOLIOS || cantidad > MAX_FOLIOS) {
    return NextResponse.json(
      { ok: false, error: "CANTIDAD_FUERA_DE_RANGO", detalle: `Min ${MIN_FOLIOS}, max ${MAX_FOLIOS}` },
      { status: 400 },
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: "BACKEND_CONFIG_MISSING" }, { status: 500 });
  }
  const sb = createClient(url, key);

  // Buscar el último folio_hasta de esta empresa+tipo para continuar la secuencia
  const { data: last } = await sb
    .from("boletas_caf_mock")
    .select("folio_hasta")
    .eq("empresa_id", empresa_id)
    .eq("tipo_dte", tipo_dte)
    .order("folio_hasta", { ascending: false })
    .limit(1)
    .maybeSingle();

  const folio_desde = ((last?.folio_hasta as number | undefined) ?? 0) + 1;
  const folio_hasta = folio_desde + cantidad - 1;

  const { data: inserted, error } = await sb
    .from("boletas_caf_mock")
    .insert({
      empresa_id,
      tipo_dte,
      folio_desde,
      folio_hasta,
      folio_actual: folio_desde,
      estado: "activo",
    })
    .select("id, folio_desde, folio_hasta, fecha_vence")
    .single();

  if (error || !inserted) {
    return NextResponse.json({ ok: false, error: "DB_INSERT_FAILED", detalle: error?.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    caf_id: inserted.id,
    tipo_dte,
    folio_desde: inserted.folio_desde,
    folio_hasta: inserted.folio_hasta,
    cantidad,
    fecha_vence: inserted.fecha_vence,
    mensaje: `CAF asignado: ${cantidad} folios de tipo ${tipo_dte} (mock)`,
  });
}
