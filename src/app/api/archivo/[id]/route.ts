import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSsrClient } from "@/lib/supabase/server";
import { getFileR2 } from "@/lib/storage";

// Ruta única de SERVIDO de archivos (S0c). Resuelve el provider del documento
// (r2 | supabase) y devuelve los bytes — provider-agnóstica para el cliente.
// Auth por sesión (cookies) + RLS: el usuario solo ve documentos de su empresa.
// Las imágenes/PDF del visor apuntan acá en vez de bajar el blob por el cliente,
// así el egress sale de Supabase y, cuando el archivo esté en R2, es gratis.
export const runtime = "nodejs";

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", heif: "image/heif", bmp: "image/bmp",
  tiff: "image/tiff", pdf: "application/pdf",
};
function mimeFor(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  return EXT_MIME[ext] ?? "application/octet-stream";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSsrClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("No autorizado", { status: 401 });

  const { id } = await params;
  // RLS hace la autorización: el usuario solo ve documentos de su empresa.
  const { data: doc, error } = await supabase
    .from("documentos_subidos")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !doc) return new NextResponse("No encontrado", { status: 404 });

  const row = doc as unknown as {
    storage_path: string | null; nombre_archivo: string | null; storage_provider?: string;
    album_imagenes?: Array<{ path?: string; mime?: string; name?: string }> | null;
  };

  // ?i = índice de imagen del álbum (galería del visor/editor). Sin i → archivo principal.
  // Por ÍNDICE (nunca ruta cruda): resuelve contra el album_imagenes del propio doc ya
  // autorizado por RLS → sin superficie de path traversal / cross-tenant.
  let storagePath = row.storage_path;
  let contentType = mimeFor(row.nombre_archivo ?? row.storage_path ?? "");
  const iRaw = new URL(_req.url).searchParams.get("i");
  if (iRaw !== null && Array.isArray(row.album_imagenes)) {
    const idx = Number(iRaw);
    const img = Number.isInteger(idx) && idx >= 0 ? row.album_imagenes[idx] : undefined;
    if (img?.path) { storagePath = img.path; contentType = img.mime ?? mimeFor(img.name ?? img.path); }
  }
  if (!storagePath) return new NextResponse("No encontrado", { status: 404 });
  const provider = row.storage_provider === "r2" ? "r2" : "supabase";

  let body: Buffer | Blob;
  if (provider === "r2") {
    try {
      body = await getFileR2(storagePath);
    } catch {
      return new NextResponse("Error leyendo archivo", { status: 502 });
    }
  } else {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return new NextResponse("Backend mal configurado", { status: 500 });
    const sb = createClient(url, key);
    const { data: file, error: dlErr } = await sb.storage.from("documentos").download(storagePath);
    if (dlErr || !file) return new NextResponse("No encontrado", { status: 404 });
    body = file;
  }

  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
