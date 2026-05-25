import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSsrClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ empresaId: string }> },
) {
  const supabase = await createSsrClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse("No autorizado", { status: 401 });
  }
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) {
    return new NextResponse("No autorizado", { status: 401 });
  }

  const { empresaId } = await params;
  const resolvedEmpresaId = empresaId === "current" ? usuario.empresa_id : empresaId;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new NextResponse("Backend mal configurado", { status: 500 });

  const sb = createClient(url, key);
  const logoDir = `${resolvedEmpresaId}/logos`;
  const { data: files, error: listError } = await sb.storage.from("documentos").list(logoDir);
  const logoFile = files?.find((file) => file.name.startsWith("logo."));

  if (listError || !logoFile) {
    return new NextResponse("Logo no encontrado", { status: 404 });
  }

  const { data, error } = await sb.storage.from("documentos").download(`${logoDir}/${logoFile.name}`);
  if (error || !data) return new NextResponse("Logo no disponible", { status: 404 });

  return new NextResponse(data, {
    headers: {
      "Content-Type": data.type || "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
