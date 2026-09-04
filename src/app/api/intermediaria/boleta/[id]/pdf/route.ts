import { NextResponse } from "next/server";
import { downloadFromR2 } from "@/lib/r2";
import { requireAccountApiAccess } from "@/lib/api/account-guard";

function getPdfMeta(proveedorRespuesta: unknown): { storagePath: string | null; provider: string | null } {
  if (!proveedorRespuesta || typeof proveedorRespuesta !== "object") return { storagePath: null, provider: null };
  const pdf = (proveedorRespuesta as { pdf?: unknown }).pdf;
  if (!pdf || typeof pdf !== "object") return { storagePath: null, provider: null };
  const sp = (pdf as { storage_path?: unknown }).storage_path;
  const pv = (pdf as { provider?: unknown }).provider;
  return {
    storagePath: typeof sp === "string" && sp.trim() ? sp.trim() : null,
    provider: typeof pv === "string" ? pv : null,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireAccountApiAccess({ requirePlanOTrial: true });
  if (!guard.ok) return guard.response;

  const { data: boleta, error } = await guard.service
    .from("boletas_emitidas")
    .select("id, tipo_dte, folio, proveedor_respuesta")
    .eq("id", id)
    .eq("empresa_id", guard.empresaId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!boleta) return NextResponse.json({ ok: false, error: "NO_ENCONTRADA" }, { status: 404 });

  const { storagePath, provider } = getPdfMeta(boleta.proveedor_respuesta);
  if (!storagePath) return NextResponse.json({ ok: false, error: "PDF_NO_DISPONIBLE" }, { status: 404 });

  const headers = {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="boleta-sii-${boleta.tipo_dte}-${boleta.folio}.pdf"`,
    "Cache-Control": "private, max-age=60",
  };

  // El PDF vive en R2 (Cloudflare) o en Supabase Storage según el marcador.
  if (provider === "r2") {
    try {
      const buffer = await downloadFromR2(storagePath);
      return new Response(new Uint8Array(buffer), { headers });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "R2_DOWNLOAD_FAILED" }, { status: 500 });
    }
  }

  const { data: file, error: downloadError } = await guard.service.storage.from("documentos").download(storagePath);
  if (downloadError || !file) return NextResponse.json({ ok: false, error: downloadError?.message ?? "PDF_DOWNLOAD_FAILED" }, { status: 500 });

  return new Response(file, { headers });
}

export const dynamic = "force-dynamic";
