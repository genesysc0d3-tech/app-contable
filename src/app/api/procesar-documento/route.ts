import { NextResponse } from "next/server";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { procesarDocumento } from "@/lib/ai/processor";
import { parseExcel } from "@/lib/parsers";
import { ocrAndGroupImages } from "@/lib/ai/ocr";

/**
 * Procesamiento directo en Vercel con after().
 * Usa Promise.all para paralelizar chunks (3 concurrentes).
 * Para cartolas gigantes (2000+ tx) en el futuro, activar workflow n8n:
 *   ID: rZoZmdAAW8csRrjU
 *   Webhook: https://n8n-production-47ecb.up.railway.app/webhook/procesar-documento
 */

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
  const { documento_id, grouped_images } = body;

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

  // For grouped images, download all and OCR them
  if (grouped_images && Array.isArray(grouped_images) && grouped_images.length > 0) {
    after(async () => {
      try {
        const start = Date.now();
        const images: { base64: string; mimeType: string; fileName: string }[] = [];
        for (const imgPath of grouped_images) {
          const { data: fileData } = await supabase.storage
            .from("documentos")
            .download(imgPath.path);
          if (fileData) {
            const buffer = await fileData.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");
            images.push({
              base64,
              mimeType: imgPath.mime || "image/jpeg",
              fileName: imgPath.name || "imagen",
            });
          }
        }

        if (images.length === 0) throw new Error("No se pudieron descargar las imágenes");

        const { groupedText, totalTokensInput, totalTokensOutput } = await ocrAndGroupImages(images);
        if (!groupedText.trim()) throw new Error("OCR no extrajo texto de las imágenes");

        const result = await procesarDocumento(
          documento.id,
          usuario.empresa_id,
          groupedText,
          { ocrTokensInput: totalTokensInput, ocrTokensOutput: totalTokensOutput }
        );

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(
          `[procesar-documento] ${documento.id} OCR+procesado en ${elapsed}s — ${images.length} imgs → ${result.movimientos_total} movimientos${result.error ? ` — error: ${result.error}` : ""}`
        );
      } catch (err) {
        console.error(`[procesar-documento] ${documento.id} OCR error:`, err);
        const { createClient: createServiceClient } = await import("@supabase/supabase-js");
        const svc = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        await svc.from("documentos_subidos").update({
          estado: "error",
          progreso_ia: { estado: "error", error: err instanceof Error ? err.message : String(err) },
        }).eq("id", documento.id);
      }
    });

    return NextResponse.json({
      ok: true,
      documento_id: documento.id,
      message: "OCR + procesamiento iniciado.",
    });
  }

  // Standard file processing
  const { data: fileData, error: downloadError } = await supabase.storage
    .from("documentos")
    .download(documento.storage_path);

  if (downloadError || !fileData) {
    return NextResponse.json({ error: "Error descargando archivo" }, { status: 500 });
  }

  let contenido: string;

  if (documento.tipo === "excel") {
    const buffer = await fileData.arrayBuffer();
    contenido = parseExcel(buffer);
  } else if (["csv", "whatsapp"].includes(documento.tipo)) {
    contenido = await fileData.text();
  } else if (documento.tipo === "pdf") {
    contenido = await fileData.text();
  } else if (documento.tipo === "imagen") {
    after(async () => {
      try {
        const start = Date.now();
        const buffer = await fileData.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const { groupedText, totalTokensInput, totalTokensOutput } = await ocrAndGroupImages([{
          base64,
          mimeType: "image/jpeg",
          fileName: documento.storage_path.split("/").pop() || "imagen",
        }]);

        if (!groupedText.trim()) throw new Error("OCR no extrajo texto de la imagen");

        const result = await procesarDocumento(
          documento.id,
          usuario.empresa_id,
          groupedText,
          { ocrTokensInput: totalTokensInput, ocrTokensOutput: totalTokensOutput }
        );

        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[procesar-documento] ${documento.id} OCR single en ${elapsed}s — ${result.movimientos_total} movimientos`);
      } catch (err) {
        console.error(`[procesar-documento] ${documento.id} OCR error:`, err);
      }
    });

    return NextResponse.json({
      ok: true,
      documento_id: documento.id,
      message: "OCR + procesamiento iniciado.",
    });
  } else {
    contenido = await fileData.text();
  }

  if (!contenido.trim()) {
    return NextResponse.json({ error: "Documento vacio o sin contenido legible" }, { status: 422 });
  }

  after(async () => {
    try {
      const start = Date.now();
      const result = await procesarDocumento(documento.id, usuario.empresa_id, contenido);
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
