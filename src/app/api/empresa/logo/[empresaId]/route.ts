import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSsrClient } from "@/lib/supabase/server";
import { getDevSupportMode } from "@/lib/dev/support-mode";

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
  const support = await getDevSupportMode();
  const allowedEmpresaId = support?.ok ? support.empresaId : usuario.empresa_id;
  const resolvedEmpresaId = empresaId === "current" ? allowedEmpresaId : empresaId;
  if (resolvedEmpresaId !== allowedEmpresaId) {
    return new NextResponse("No autorizado", { status: 403 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new NextResponse("Backend mal configurado", { status: 500 });

  const sb = createClient(url, key);
  const logoDir = `${resolvedEmpresaId}/logos`;
  const { data: files, error: listError } = await sb.storage.from("documentos").list(logoDir);
  // SVG bloqueado también al servir (cubre logos .svg subidos antes del
  // bloqueo en upload): un SVG con script servido same-origin sería XSS.
  const logoFile = files?.find((file) => file.name.startsWith("logo.") && !file.name.endsWith(".svg"));

  if (listError || !logoFile) {
    return new NextResponse(null, { status: 204 });
  }

  const { data, error } = await sb.storage.from("documentos").download(`${logoDir}/${logoFile.name}`);
  if (error || !data) return new NextResponse(null, { status: 204 });

  return new NextResponse(data, {
    headers: {
      "Content-Type": data.type === "image/svg+xml" ? "application/octet-stream" : (data.type || "image/png"),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
}
