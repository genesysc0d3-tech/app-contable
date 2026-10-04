import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportMode } from "@/lib/dev/support-mode";
import { rateLimitKey } from "@/lib/security/rate-limit";
import { enforceRateLimitGlobal } from "@/lib/security/rate-limit-global";
import { bajarCartola, esPlanillaMapeable, configDelCliente, configValida } from "@/lib/parsers/documento-cartola";
import { resumenDeMapa } from "@/lib/parsers/resumen-mapa";

/**
 * RESUMEN EN VIVO del popup "Revisa las columnas" (2026-09-30). SOLO LECTURA:
 * con el mapa que el cliente está eligiendo, lee la cartola COMPLETA (no las 30
 * filas de la vista previa) con el mismo juez del lector y responde cuántas
 * entradas y salidas quedan, el rango de fechas, si queda comprobada y si el
 * banco contradice ese mapa (no guardable). Nada se escribe.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  // El popup lo pide con debounce al cambiar una columna: holgado pero con techo.
  const limited = await enforceRateLimitGlobal({ key: rateLimitKey("parser-resumen", user.id), limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { data: usuario } = await supabase.from("usuarios").select("empresa_id").eq("id", user.id).single();
  if (!usuario?.empresa_id) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { documento_id?: string; config?: unknown };
  if (!body.documento_id) return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });
  if (!configValida(body.config)) return NextResponse.json({ error: "config inválido" }, { status: 400 });

  // Lectura: el operador en modo soporte puede mirar con la empresa que soporta.
  const support = await getDevSupportMode();
  const sb = support?.ok ? support.sb : supabase;
  const empresaId = support?.ok ? support.empresaId : usuario.empresa_id;

  const { data: documento } = await sb
    .from("documentos_subidos")
    .select("id, tipo, storage_provider, storage_path, empresa_id")
    .eq("id", body.documento_id)
    .eq("empresa_id", empresaId)
    .single();
  if (!documento) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (!esPlanillaMapeable(documento.tipo)) return NextResponse.json({ error: "Solo planillas" }, { status: 400 });

  let archivo: Awaited<ReturnType<typeof bajarCartola>>;
  try { archivo = await bajarCartola(sb, documento, { cache: true }); }
  catch { return NextResponse.json({ error: "Archivo no disponible" }, { status: 500 }); }

  // PDF sin marca propia de banco (vuelta 6): nunca "cuadra con tu banco".
  return NextResponse.json(resumenDeMapa(archivo.buf, configDelCliente(body.config), { pdfSinMarcaBanco: archivo.pdfSinMarcaBanco }));
}
