import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSsrClient } from "@/lib/supabase/server";

const ALLOWED_MIME = new Set([
  "image/png", "image/svg+xml", "image/webp", "image/gif", "image/jpeg",
]);

export async function POST(request: Request) {
  const supabase = await createSsrClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return NextResponse.json({ error: "Usuario sin empresa" }, { status: 400 });
  }
  const empresaId = usuario.empresa_id;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Error al leer formulario" }, { status: 400 });
  }

  const file = formData.get("logo");
  if (!file || typeof file !== "object" || !("size" in file) || !("type" in file) || !("arrayBuffer" in file)) {
    return NextResponse.json({ error: "Selecciona una imagen" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type as string)) {
    return NextResponse.json({ error: "Formato no soportado. Usa PNG, SVG, WebP, GIF o JPG" }, { status: 400 });
  }
  if (file.size > 2 * 1024 * 1024) {
    return NextResponse.json({ error: "El logo no puede superar 2MB" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Backend mal configurado" }, { status: 500 });
  }

  const sb = createClient(url, key);
  const { data: buckets, error: bucketsError } = await sb.storage.listBuckets();
  if (bucketsError) {
    return NextResponse.json({ error: `Error storage: ${bucketsError.message}` }, { status: 500 });
  }
  if (!buckets?.some((bucket) => bucket.id === "documentos")) {
    const { error: createBucketError } = await sb.storage.createBucket("documentos", {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
    });
    if (createBucketError) {
      return NextResponse.json({ error: `Error creando bucket: ${createBucketError.message}` }, { status: 500 });
    }
  }
  const ext = (file as File).name
    ? ((file as File).name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "png")
    : "png";
  const logoDir = `${empresaId}/logos`;
  const storagePath = `${logoDir}/logo.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { data: oldFiles } = await sb.storage.from("documentos").list(logoDir);
  if (oldFiles?.length) {
    await sb.storage.from("documentos").remove(oldFiles.map((oldFile) => `${logoDir}/${oldFile.name}`));
  }

  const { error: uploadError } = await sb.storage
    .from("documentos")
    .upload(storagePath, buffer, { contentType: file.type as string, upsert: true });
  if (uploadError) {
    return NextResponse.json({ error: `Error subiendo: ${uploadError.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path: storagePath });
}
