import { NextResponse } from "next/server";
import { esRolEmision } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { cancelDocumentProcessingJob } from "@/lib/document-processing/queue";

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
    .select("empresa_id, rol")
    .eq("id", user.id)
    .single();

  if (!usuario) {
    return NextResponse.json({ error: "Usuario sin empresa" }, { status: 403 });
  }
  // Deshacer borra propuestas/movimientos (destructivo): 'viewer' queda fuera.
  if (!esRolEmision(usuario.rol)) {
    return NextResponse.json({ error: "Tu rol no permite deshacer documentos" }, { status: 403 });
  }

  const body = await request.json();
  const { documento_id } = body;

  if (!documento_id) {
    return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });
  }

  // Verify document belongs to user's empresa
  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("id, empresa_id")
    .eq("id", documento_id)
    .eq("empresa_id", usuario.empresa_id)
    .single();

  if (!documento) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }

  const svc = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Si el worker está procesando el documento en este momento, borrar sus filas
  // ahora choca con los inserts en vuelo (FK / zombie). Se cancela el job; si
  // estaba 'running', se pide reintentar cuando termine en vez de borrar a ciegas.
  const eraVivo = await cancelDocumentProcessingJob(svc, documento_id);
  if (eraVivo) {
    const { data: jobRunning } = await svc
      .from("document_processing_jobs")
      .select("id")
      .eq("documento_id", documento_id)
      .eq("status", "running")
      .maybeSingle();
    if (jobRunning) {
      return NextResponse.json(
        { error: "El documento se está procesando en este momento. Intenta deshacer de nuevo en unos segundos." },
        { status: 409 },
      );
    }
  }

  // Delete in FK order: propuestas → movimientos → ia_uso → reset documento
  // First get movimiento IDs for this document
  const { data: movimientos } = await svc
    .from("movimientos_raw")
    .select("id")
    .eq("documento_id", documento_id);

  const movIds = (movimientos ?? []).map((m) => m.id);

  if (movIds.length > 0) {
    // INTEGRIDAD TRIBUTARIA: si alguna propuesta de este documento ya tiene una
    // boleta emitida (folio real en el SII), NO se puede deshacer — se corrige
    // vía Nota de Crédito. Deshacer orfanaría folios reales. (El UI ya lo oculta;
    // este guard es la defensa server-side.)
    const { data: props } = await svc.from("propuestas_ia").select("id").in("movimiento_id", movIds);
    const propIds = (props ?? []).map((p) => p.id);
    if (propIds.length > 0) {
      const { count } = await svc
        .from("boletas_emitidas")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", usuario.empresa_id)
        .neq("estado", "anulada")
        .in("propuesta_id", propIds);
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: `Este documento tiene ${count} boleta(s) emitida(s) en el SII. No se puede deshacer; para corregir o anular, emite una Nota de Crédito.` },
          { status: 409 },
        );
      }
    }
    // Delete propuestas linked to these movimientos
    await svc.from("propuestas_ia").delete().in("movimiento_id", movIds);
  }

  // Delete movimientos
  await svc.from("movimientos_raw").delete().eq("documento_id", documento_id);

  // Delete ia_uso
  await svc.from("ia_uso").delete().eq("documento_id", documento_id);

  // Reset document state to "subido" (not delete — keep file in Storage)
  await svc
    .from("documentos_subidos")
    .update({
      estado: "subido",
      movimientos_detectados: 0,
      progreso_ia: null,
    })
    .eq("id", documento_id);

  return NextResponse.json({ ok: true });
}
