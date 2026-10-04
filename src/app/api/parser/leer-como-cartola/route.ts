import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { recordCuentaAudit } from "@/lib/audit/account";
import { documentoMarcadoNoEsCartola, quitarNoEsCartola } from "@/lib/parsers/adapter-store";
import { bajarCartola, clienteServicio, huellaDeLibro } from "@/lib/parsers/documento-cartola";
import { reprocesoPosible } from "@/lib/parsers/reproceso-posible";

/**
 * DESHACER "No es una cartola" (vuelta 6c). GET ?documento_id → ¿este
 * documento fue marcado así? (la tarjeta muestra el enlace "Leerlo como
 * cartola"). POST → quita la marca del mapa de la EMPRESA para el formato de ese
 * PDF y lo reprocesa (mismas validaciones que el reproceso).
 */
type Contexto =
  | { ok: false; res: NextResponse }
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string; empresaId: string };

async function contexto(): Promise<Contexto> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  const { data: usuario } = await supabase.from("usuarios").select("empresa_id").eq("id", user.id).single();
  if (!usuario?.empresa_id) return { ok: false, res: NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 }) };
  return { ok: true, supabase, userId: user.id, empresaId: usuario.empresa_id };
}

export async function GET(request: Request): Promise<NextResponse> {
  const c = await contexto();
  if (!c.ok) return c.res;
  const documentoId = new URL(request.url).searchParams.get("documento_id");
  if (!documentoId) return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });
  return NextResponse.json({ marcado: await documentoMarcadoNoEsCartola(c.empresaId, documentoId) });
}

export async function POST(request: Request): Promise<NextResponse> {
  const c = await contexto();
  if (!c.ok) return c.res;
  const { supabase, userId, empresaId } = c;

  const writeBlock = await getDevSupportWriteBlock("parser_leer_como_cartola");
  if (writeBlock) return NextResponse.json({ error: writeBlock.error }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { documento_id?: string };
  const documentoId = body.documento_id;
  if (!documentoId) return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });

  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("id, tipo, storage_provider, storage_path, empresa_id")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .single();
  if (!documento) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (documento.tipo !== "pdf") return NextResponse.json({ error: "Solo PDF" }, { status: 400 });

  const svc = clienteServicio();
  const posible = await reprocesoPosible(svc, documentoId);
  if (!posible.ok) return NextResponse.json({ error: posible.error }, { status: posible.status });

  let archivo: Awaited<ReturnType<typeof bajarCartola>>;
  try { archivo = await bajarCartola(supabase, documento, { cache: true }); }
  catch { return NextResponse.json({ error: "Este PDF no se puede leer como cartola" }, { status: 422 }); }
  const huella = huellaDeLibro(archivo.buf);
  if (!huella) return NextResponse.json({ error: "No pudimos leer el PDF" }, { status: 422 });
  const quitadas = await quitarNoEsCartola(empresaId, huella);
  if (quitadas === null) return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
  if (quitadas === 0) return NextResponse.json({ error: "Este PDF no estaba marcado como «No es una cartola»" }, { status: 422 });

  if (svc) {
    await recordCuentaAudit({
      sb: svc, empresaId, usuarioId: userId,
      accion: "cartola_leer_como_cartola",
      recursoTipo: "documento_subido",
      recursoId: documentoId,
      resumen: "El cliente deshizo «No es una cartola»: el PDF se vuelve a leer como cartola",
      metadata: { accion: "leer_como_cartola" },
    });
  }

  let reprocessStarted = false;
  try {
    const origin = new URL(request.url).origin;
    const res = await fetch(`${origin}/api/procesar-documento`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: request.headers.get("cookie") ?? "" },
      body: JSON.stringify({ documento_id: documentoId }),
    });
    reprocessStarted = res.ok;
  } catch (err) {
    console.error("[leer-como-cartola] reprocess error:", err);
  }
  return NextResponse.json({ ok: true, reprocessStarted });
}
