import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { recordCuentaAudit } from "@/lib/audit/account";
import { upsertManualAdapter } from "@/lib/parsers/adapter-store";
import { bajarCartola, clienteServicio, configDelCliente, configValida, huellaDeLibro } from "@/lib/parsers/documento-cartola";
import { reprocesoPosible } from "@/lib/parsers/reproceso-posible";

/**
 * "No es una cartola" del popup (vuelta 6, A2): un PDF SIN marca propia de banco
 * que el router dejó pasar (p. ej. el estado de cuenta de un proveedor). Se
 * guarda en el mapa del CLIENTE para este formato (solo su empresa, nunca
 * global) y se reprocesa: el lector ya no lo lee y el PDF sigue el flujo de
 * antes (texto → IA), sin movimientos de banco del lector.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("empresa_id").eq("id", user.id).single();
  if (!usuario?.empresa_id) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });
  const empresaId = usuario.empresa_id;

  const writeBlock = await getDevSupportWriteBlock("parser_no_es_cartola");
  if (writeBlock) return NextResponse.json({ error: writeBlock.error }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { documento_id?: string; config?: unknown };
  const documentoId = body.documento_id;
  if (!documentoId) return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });
  if (!configValida(body.config)) return NextResponse.json({ error: "config inválido" }, { status: 400 });

  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("id, tipo, storage_provider, storage_path, empresa_id")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .single();
  if (!documento) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (documento.tipo !== "pdf") return NextResponse.json({ error: "Solo PDF" }, { status: 400 });

  // Primero, ¿el reproceso puede partir? Si no (emitidas, emisión a medias, job
  // en curso), no se guarda la marca: quedaría un formato "fuera del lector" con
  // los movimientos que el lector ya creó.
  const svc = clienteServicio();
  const posible = await reprocesoPosible(svc, documentoId);
  if (!posible.ok) return NextResponse.json({ error: posible.error }, { status: posible.status });

  let archivo: Awaited<ReturnType<typeof bajarCartola>>;
  try { archivo = await bajarCartola(supabase, documento, { cache: true }); }
  catch { return NextResponse.json({ error: "Archivo no disponible" }, { status: 500 }); }
  // Solo un PDF sin marca de banco: uno con marca (formato conocido, cuenta
  // corriente, banco en el encabezado) no se saca del lector desde el popup.
  if (!archivo.pdfSinMarcaBanco) return NextResponse.json({ error: "Este PDF sí trae los datos de un banco" }, { status: 422 });

  // La misma huella que calcula el orquestador (1ª hoja con filas de la grilla).
  const huella = huellaDeLibro(archivo.buf);
  if (!huella) return NextResponse.json({ error: "No pudimos leer el PDF" }, { status: 422 });

  const adapterId = await upsertManualAdapter({
    fingerprint: huella,
    empresaId,
    nombre: "No es cartola (dicho por el cliente)",
    config: { ...configDelCliente(body.config), revision_cliente: { documento_id: documentoId, firma: "", no_es_cartola: true } },
    confirmadoPor: "cliente",
  });
  if (!adapterId) return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });

  if (svc) {
    await recordCuentaAudit({
      sb: svc, empresaId, usuarioId: user.id,
      accion: "cartola_no_es_cartola",
      recursoTipo: "documento_subido",
      recursoId: documentoId,
      resumen: "El cliente dijo que el PDF no es una cartola de su banco",
      metadata: { accion: "no_es_cartola" },
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
    console.error("[no-es-cartola] reprocess error:", err);
  }
  return NextResponse.json({ ok: true, adapter_id: adapterId, reprocessStarted });
}
