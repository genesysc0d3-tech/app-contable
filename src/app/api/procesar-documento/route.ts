import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ||
  "https://n8n-production-47ecb.up.railway.app/webhook/procesar-documento";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();

  if (!usuario) {
    return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });
  }

  const body = await request.json();
  const { documento_id } = body;

  if (!documento_id) {
    return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });
  }

  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("id, empresa_id, storage_path, tipo, estado")
    .eq("id", documento_id)
    .eq("empresa_id", usuario.empresa_id)
    .single();

  if (!documento) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }

  if (documento.estado === "procesando") {
    return NextResponse.json({ error: "Documento ya esta siendo procesado" }, { status: 409 });
  }

  // Dispatch to n8n webhook — responds immediately, n8n processes in background
  try {
    const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documento_id: documento.id,
        empresa_id: usuario.empresa_id,
        storage_path: documento.storage_path,
        tipo: documento.tipo,
      }),
    });

    if (!n8nResponse.ok) {
      console.error(`[procesar-documento] n8n webhook error: ${n8nResponse.status}`);
      return NextResponse.json({ error: "Error al iniciar procesamiento" }, { status: 502 });
    }
  } catch (err) {
    console.error("[procesar-documento] n8n webhook unreachable:", err);
    return NextResponse.json({ error: "Servicio de procesamiento no disponible" }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    documento_id: documento.id,
    message: "Procesamiento iniciado en n8n. Sigue el progreso en tiempo real.",
  });
}

/*
 * FALLBACK: Procesamiento directo en Vercel (comentado)
 * Descomentar si n8n no está disponible y se necesita procesamiento local.
 * Limitado a 60s en Vercel Hobby.
 *
 * import { after } from "next/server";
 * import { procesarDocumento } from "@/lib/ai/processor";
 * import { parseExcel } from "@/lib/parsers";
 * import { ocrAndGroupImages } from "@/lib/ai/ocr";
 *
 * // ... (descargar archivo, parsear, llamar procesarDocumento con after())
 */
