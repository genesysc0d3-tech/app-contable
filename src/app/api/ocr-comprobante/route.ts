import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extraerComprobante } from "@/lib/comprobante/extract";
import { enforceRateLimit, rateLimitKey } from "@/lib/security/rate-limit";

/**
 * OCR de comprobantes de transferencia (imagen → campos pre-llenables).
 *
 * Recibe JSON { base64, mime }, corre Mistral OCR + heurísticas chilenas y
 * devuelve monto/fecha/glosa/pagador con confianza por campo. NUNCA emite
 * nada: solo pre-llena el formulario y el usuario revisa y aprueba.
 */

const MAX_BYTES = 6 * 1024 * 1024; // 6 MB decodificados

export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (error) {
    console.error("[ocr-comprobante] error no controlado", error);
    return NextResponse.json(
      { ok: false, error: "OCR_COMPROBANTE_FAILED", detalle: "No pude procesar el comprobante. Intenta de nuevo." },
      { status: 500 },
    );
  }
}

async function handlePost(request: Request) {
  // 1. Auth + empresa (mismo patrón que emitir-boleta).
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "NO_AUTH", detalle: "Debes iniciar sesión." }, { status: 401 });
  }

  const limited = enforceRateLimit({
    key: rateLimitKey("ocr-comprobante", user.id),
    limit: 12,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json(
      { ok: false, error: "USUARIO_SIN_EMPRESA", detalle: "Tu cuenta no tiene una empresa configurada." },
      { status: 403 },
    );
  }

  // 2. Body JSON { base64, mime }.
  let body: { base64?: unknown; mime?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "BAD_JSON", detalle: "El cuerpo de la solicitud no es JSON válido." },
      { status: 400 },
    );
  }

  // 3. Solo imágenes (PDF queda fuera a propósito).
  const mime = typeof body.mime === "string" ? body.mime.trim().toLowerCase() : "";
  if (mime === "application/pdf") {
    return NextResponse.json(
      { ok: false, error: "MIME_NO_SOPORTADO", detalle: "PDF no está soportado: sube una foto o captura del comprobante (JPG/PNG)." },
      { status: 415 },
    );
  }
  if (!mime.startsWith("image/")) {
    return NextResponse.json(
      { ok: false, error: "MIME_NO_SOPORTADO", detalle: "El comprobante debe ser una imagen (JPG, PNG o similar)." },
      { status: 415 },
    );
  }

  // 4. Base64 válido y ≤ 6 MB decodificados.
  let base64 = typeof body.base64 === "string" ? body.base64.trim() : "";
  if (base64.startsWith("data:")) {
    const coma = base64.indexOf(",");
    base64 = coma >= 0 ? base64.slice(coma + 1) : "";
  }
  base64 = base64.replace(/\s+/g, "");
  if (base64.length < 100 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return NextResponse.json(
      { ok: false, error: "BASE64_INVALIDO", detalle: "La imagen llegó vacía o corrupta. Vuelve a seleccionarla." },
      { status: 400 },
    );
  }
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = (base64.length * 3) / 4 - padding;
  if (bytes > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "IMAGEN_MUY_GRANDE", detalle: "La imagen supera el máximo de 6 MB. Usa una captura más liviana." },
      { status: 413 },
    );
  }

  // 5. OCR + heurísticas. Falla del proveedor = 502 controlado.
  try {
    const extraccion = await extraerComprobante(base64, mime);
    return NextResponse.json({
      ok: true,
      campos: {
        monto: extraccion.monto,
        fecha: extraccion.fecha,
        glosa: extraccion.glosa,
        pagador: extraccion.pagador,
      },
      confianza: extraccion.confianza,
      textoOcr: extraccion.textoOcr.slice(0, 500),
    });
  } catch (error) {
    console.error("[ocr-comprobante] OCR falló", error);
    return NextResponse.json(
      { ok: false, error: "OCR_FALLIDO", detalle: "No pude leer la imagen del comprobante. Intenta con una captura más nítida." },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";
