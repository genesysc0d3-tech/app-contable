import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { procesarDocumento } from "@/lib/ai/processor";
import { parseExcel } from "@/lib/parsers";
import { ocrAndGroupImages } from "@/lib/ai/ocr";

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

  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createServiceClient(svcUrl, svcKey);

  // Mark as procesando
  await svc
    .from("documentos_subidos")
    .update({ estado: "procesando" })
    .eq("id", documento.id);

  try {
    // Grouped images path
    if (grouped_images && Array.isArray(grouped_images) && grouped_images.length > 0) {
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

      const { groupedText } = await ocrAndGroupImages(images);
      if (!groupedText.trim()) throw new Error("OCR no extrajo texto de las imágenes");

      const result = await procesarDocumento(
        documento.id,
        usuario.empresa_id,
        groupedText
      );

      return NextResponse.json({
        ok: true,
        documento_id: documento.id,
        movimientos: result.movimientos_total,
        error: result.error ?? null,
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
    let preExtracted: import("@/lib/parsers/types").PreExtractedMovimiento[] | null = null;

    if (documento.tipo === "excel") {
      const buffer = await fileData.arrayBuffer();
      const parsed = await parseExcel(buffer, { documento_id: documento.id });
      contenido = parsed.content;
      preExtracted = parsed.preExtracted;
    } else if (["csv", "whatsapp"].includes(documento.tipo)) {
      contenido = await fileData.text();
    } else if (documento.tipo === "pdf") {
      const arrayBuf = await fileData.arrayBuffer();
      const { PDFParse } = await import("pdf-parse");
      const pdfParser = new PDFParse(new Uint8Array(arrayBuf));
      const pdfData = await pdfParser.getText();
      contenido = pdfData.text;
    } else if (documento.tipo === "imagen") {
      const buffer = await fileData.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const { groupedText } = await ocrAndGroupImages([{
        base64,
        mimeType: "image/jpeg",
        fileName: documento.storage_path.split("/").pop() || "imagen",
      }]);
      if (!groupedText.trim()) throw new Error("OCR no extrajo texto de la imagen");
      contenido = groupedText;
    } else {
      contenido = await fileData.text();
    }

    if (!contenido.trim()) {
      // Update document state to error
      await svc.from("documentos_subidos").update({
        estado: "error",
        progreso_ia: { estado: "error", error: "Documento vacio o sin contenido legible" },
      }).eq("id", documento.id);

      return NextResponse.json({ error: "Documento vacio o sin contenido legible" }, { status: 422 });
    }

    const result = await procesarDocumento(
      documento.id,
      usuario.empresa_id,
      contenido,
      undefined,
      preExtracted ?? undefined
    );

    return NextResponse.json({
      ok: true,
      documento_id: documento.id,
      movimientos: result.movimientos_total,
      error: result.error ?? null,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[procesar-documento] ${documento.id} error:`, errorMsg);

    await svc.from("documentos_subidos").update({
      estado: "error",
      progreso_ia: { estado: "error", error: errorMsg },
    }).eq("id", documento.id);

    return NextResponse.json({ ok: false, error: errorMsg }, { status: 500 });
  }
}
