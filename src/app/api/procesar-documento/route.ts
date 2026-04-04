import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { procesarDocumento } from "@/lib/ai/processor";
import { parseExcel } from "@/lib/parsers";

export async function POST(request: Request) {
  const supabase = await createClient();

  // Verify auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  // Get user's empresa
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
    return NextResponse.json(
      { error: "documento_id requerido" },
      { status: 400 }
    );
  }

  // Verify document belongs to user's empresa
  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("id, empresa_id, storage_path, tipo, estado")
    .eq("id", documento_id)
    .eq("empresa_id", usuario.empresa_id)
    .single();

  if (!documento) {
    return NextResponse.json(
      { error: "Documento no encontrado" },
      { status: 404 }
    );
  }

  if (documento.estado === "procesando") {
    return NextResponse.json(
      { error: "Documento ya esta siendo procesado" },
      { status: 409 }
    );
  }

  // Download file content from Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("documentos")
    .download(documento.storage_path);

  if (downloadError || !fileData) {
    return NextResponse.json(
      { error: "Error descargando archivo" },
      { status: 500 }
    );
  }

  // Extract text content based on file type
  let contenido: string;

  if (documento.tipo === "excel") {
    const buffer = await fileData.arrayBuffer();
    contenido = parseExcel(buffer);
  } else if (["csv", "whatsapp"].includes(documento.tipo)) {
    contenido = await fileData.text();
  } else if (documento.tipo === "pdf") {
    // PDF: send as text for now (OCR integration pending)
    contenido = await fileData.text();
  } else if (documento.tipo === "imagen") {
    // TODO: integrate OCR (Mistral vision or Tesseract)
    return NextResponse.json(
      { error: "Procesamiento de imagenes pendiente de integracion OCR" },
      { status: 501 }
    );
  } else {
    contenido = await fileData.text();
  }

  if (!contenido.trim()) {
    return NextResponse.json(
      { error: "Documento vacio o sin contenido legible" },
      { status: 422 }
    );
  }

  // Use after() to keep the serverless function alive after sending the response.
  // Without this, Vercel freezes the function once the response is sent,
  // killing the Mistral processing mid-flight.
  after(async () => {
    try {
      const start = Date.now();
      const result = await procesarDocumento(
        documento.id,
        usuario.empresa_id,
        contenido
      );
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(
        `[procesar-documento] ${documento.id} completado en ${elapsed}s — ${result.movimientos_total} movimientos${result.error ? ` — error: ${result.error}` : ""}`
      );
    } catch (err) {
      console.error(`[procesar-documento] ${documento.id} error fatal:`, err);
    }
  });

  return NextResponse.json({
    ok: true,
    documento_id: documento.id,
    message: "Procesamiento iniciado. Sigue el progreso en tiempo real.",
  });
}
