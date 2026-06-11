import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { parseExcel } from "@/lib/parsers";
import { procesarDocumento } from "@/lib/ai/processor";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });

  let body: { nombre?: string; base64?: string; tipo?: string; mime?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "BAD_JSON" }, { status: 400 });
  }

  if (!body.base64) return NextResponse.json({ error: "BASE64_REQUERIDO" }, { status: 422 });
  if (!body.nombre) return NextResponse.json({ error: "NOMBRE_REQUERIDO" }, { status: 422 });

  const buffer = Buffer.from(body.base64, "base64");
  const tipo = body.tipo || "excel";
  const mime = typeof body.mime === "string" && /^[\w-]+\/[\w.+-]+$/.test(body.mime) ? body.mime : null;

  const { data: doc, error: docError } = await supabase
    .from("documentos_subidos")
    .insert({
      empresa_id: usuario.empresa_id,
      nombre_archivo: body.nombre,
      tipo,
      storage_path: "memoria",
      estado: "subido",
    })
    .select()
    .single();

  if (docError) return NextResponse.json({ error: docError.message }, { status: 500 });
  if (!doc) return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });

  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createServiceClient<Database>(svcUrl, svcKey);

  // Guardar archivo en Storage para FieldMapper y otros usos
  const storagePath = `${usuario.empresa_id}/${doc.id}/${body.nombre}`;
  const contentType = mime
    ?? (tipo === "pdf"
      ? "application/pdf"
      : tipo === "csv"
        ? "text/csv"
        : tipo === "imagen"
          ? "image/jpeg"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const { error: storageError } = await svc.storage
    .from("documentos")
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });

  if (!storageError) {
    await svc.from("documentos_subidos").update({ storage_path: storagePath }).eq("id", doc.id);
  }

  // Marcar como procesando y devolver respuesta inmediatamente
  await svc.from("documentos_subidos").update({ estado: "procesando" }).eq("id", doc.id);

  // Procesar en segundo plano (no await)
  procesarEnBackground(doc.id, usuario.empresa_id, buffer, tipo, {
    mime: contentType,
    nombre: body.nombre,
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    documento_id: doc.id,
    message: "Procesamiento iniciado.",
  });
}

async function procesarEnBackground(
  documentoId: string,
  empresaId: string,
  buffer: Buffer,
  tipo: string,
  archivo: { mime: string; nombre: string },
) {
  try {
    let contenido: string;
    let preExtracted: import("@/lib/parsers/types").PreExtractedMovimiento[] | null = null;

    if (tipo === "excel") {
      const arrayBuf = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as unknown as ArrayBuffer;
      const parsed = await parseExcel(arrayBuf, { documento_id: documentoId });
      contenido = parsed.content;
      preExtracted = parsed.preExtracted;
    } else if (tipo === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const pdfParser = new PDFParse(new Uint8Array(buffer));
      const pdfData = await pdfParser.getText();
      contenido = pdfData.text;
    } else if (tipo === "imagen") {
      // Foto/captura de cartola: OCR con Mistral antes de clasificar.
      const { ocrAndGroupImages } = await import("@/lib/ai/ocr");
      const { groupedText } = await ocrAndGroupImages([{
        base64: buffer.toString("base64"),
        mimeType: archivo.mime,
        fileName: archivo.nombre,
      }]);
      contenido = groupedText;
    } else {
      contenido = buffer.toString("utf-8");
    }

    if (!contenido.trim()) throw new Error("Documento vacio o sin contenido legible");

    const result = await procesarDocumento(
      documentoId,
      empresaId,
      contenido,
      undefined,
      preExtracted ?? undefined
    );

    if (result.error) {
      console.error(`[bg] ${documentoId} error:`, result.error);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[bg] ${documentoId} error fatal:`, errorMsg);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const svc = createServiceClient<Database>(url, key);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (svc as any).from("documentos_subidos").update({
      estado: "error",
      progreso_ia: { estado: "error", error: errorMsg },
    }).eq("id", documentoId);
  }
}
