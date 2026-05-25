import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUsuario } from "@/lib/dal";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ empresaId: string }> },
) {
  const usuario = await getUsuario();
  const { empresaId } = await params;
  const resolvedEmpresaId = empresaId === "current" ? usuario?.empresa_id : empresaId;

  if (!usuario || usuario.empresa_id !== resolvedEmpresaId) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new NextResponse("Backend mal configurado", { status: 500 });

  const sb = createClient(url, key);
  const { data: empresa, error: empresaError } = await sb
    .from("empresas")
    .select("logo_storage_path, logo_mime_type")
    .eq("id", resolvedEmpresaId)
    .single();

  if (empresaError || !empresa?.logo_storage_path) {
    return new NextResponse("Logo no encontrado", { status: 404 });
  }

  const { data, error } = await sb.storage.from("documentos").download(empresa.logo_storage_path);
  if (error || !data) return new NextResponse("Logo no disponible", { status: 404 });

  return new NextResponse(data, {
    headers: {
      "Content-Type": empresa.logo_mime_type ?? data.type ?? "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
