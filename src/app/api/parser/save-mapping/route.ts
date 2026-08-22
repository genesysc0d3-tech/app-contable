import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { computeFingerprint } from "@/lib/parsers/fingerprint";
import { upsertManualAdapter } from "@/lib/parsers/adapter-store";
import type { AdapterConfig, Row } from "@/lib/parsers/types";
import { descargarDocumento } from "@/lib/storage";

function isValidConfig(cfg: unknown): cfg is AdapterConfig {
  if (!cfg || typeof cfg !== "object") return false;
  const c = cfg as Partial<AdapterConfig>;
  if (typeof c.header_row !== "number" || typeof c.skip_rows_before_data !== "number") return false;
  if (!c.columns || typeof c.columns !== "object") return false;
  const cols = c.columns;
  if (typeof cols.fecha !== "number" || typeof cols.descripcion !== "number") return false;
  return true;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario) return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });

  // Modo soporte = solo lectura: guardar un mapeo MUTA los datos del cliente.
  // Error honesto en vez del "Documento no encontrado" fantasma de antes.
  const writeBlock = await getDevSupportWriteBlock("parser_save_mapping");
  if (writeBlock) return NextResponse.json({ error: writeBlock.error }, { status: 403 });

  const body = await request.json();
  const { documento_id, config, nombre, reprocess } = body as {
    documento_id: string;
    config: AdapterConfig;
    nombre?: string;
    reprocess?: boolean;
  };

  if (!documento_id) return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });
  if (!isValidConfig(config)) return NextResponse.json({ error: "config inválido" }, { status: 400 });

  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("*")
    .eq("id", documento_id)
    .eq("empresa_id", usuario.empresa_id)
    .single();
  if (!documento) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  if (documento.tipo !== "excel") {
    return NextResponse.json({ error: "Mapeo solo para Excel" }, { status: 400 });
  }

  const provider = documento.storage_provider === "r2" ? "r2" : "supabase";
  const bajar = async (path: string): Promise<Buffer> => {
    const { data, error } = await supabase.storage.from("documentos").download(path);
    if (error || !data) throw new Error("no file");
    return Buffer.from(await data.arrayBuffer());
  };
  let fileBuf: Buffer;
  try { fileBuf = await descargarDocumento(provider, documento.storage_path, bajar); }
  catch { return NextResponse.json({ error: "Archivo no disponible" }, { status: 500 }); }
  const ab = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength) as ArrayBuffer;
  const workbook = XLSX.read(ab, { type: "array" });
  const firstSheet = workbook.SheetNames.find((n) => {
    const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[n], { header: 1, defval: "" });
    return rows.length > 0;
  });
  if (!firstSheet) return NextResponse.json({ error: "Excel vacío" }, { status: 422 });

  const rows = XLSX.utils.sheet_to_json<Row>(workbook.Sheets[firstSheet], { header: 1, defval: "" });
  const fingerprint = computeFingerprint(rows);

  const adapterId = await upsertManualAdapter({
    fingerprint,
    empresaId: usuario.empresa_id,
    nombre: nombre ?? `Manual (${firstSheet})`,
    config,
  });

  if (!adapterId) {
    return NextResponse.json({ error: "No se pudo guardar el adapter" }, { status: 500 });
  }

  let reprocessStarted = false;
  if (reprocess) {
    try {
      const origin = new URL(request.url).origin;
      const cookie = request.headers.get("cookie") ?? "";
      const res = await fetch(`${origin}/api/procesar-documento`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ documento_id }),
      });
      reprocessStarted = res.ok;
    } catch (err) {
      console.error("[save-mapping] reprocess error:", err);
    }
  }

  return NextResponse.json({ ok: true, adapter_id: adapterId, fingerprint, reprocessStarted });
}
