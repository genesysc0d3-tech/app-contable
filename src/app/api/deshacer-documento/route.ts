import { NextResponse } from "next/server";
import { esRolEmision } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { cancelDocumentProcessingJob } from "@/lib/document-processing/queue";
import { recordCuentaAudit } from "@/lib/audit/account";

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
    .select("id, empresa_id, nombre_archivo")
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
      // INTEGRIDAD DE FOLIO: además de boletas ya registradas, bloquear si hay un
      // job de emisión EN VUELO ('created'/'running') o una LÁPIDA
      // 'revision_pendiente' (folio posiblemente emitido, aún sin registrar).
      // Borrar la propuesta pone emision_jobs.propuesta_id en NULL (ON DELETE SET
      // NULL): la lápida queda huérfana y reprocesar la cartola crea una propuesta
      // nueva SIN candado → re-emisión de un folio ya quemado, o doble boleta
      // cuando el job en vuelo aterrice.
      const { count: jobsActivos } = await svc
        .from("emision_jobs")
        .select("job_id", { count: "exact", head: true })
        .in("propuesta_id", propIds)
        .in("estado", ["created", "running", "revision_pendiente"]);
      if ((jobsActivos ?? 0) > 0) {
        return NextResponse.json(
          { error: "Esta boleta tiene una emisión en curso o quedó a medias en el SII. Espera a que termine o recupera su folio antes de deshacer." },
          { status: 409 },
        );
      }
    }
    // Delete propuestas linked to these movimientos
    const { error: propDelErr } = await svc.from("propuestas_ia").delete().in("movimiento_id", movIds);
    if (propDelErr) {
      // No dejar el documento a medias: si el borrado falla, abortamos ANTES de
      // resetear a 'subido' (antes se ignoraba y el estado quedaba inconsistente).
      return NextResponse.json({ error: "No se pudo deshacer. Intenta de nuevo." }, { status: 500 });
    }
  }

  // Delete movimientos
  const { error: movDelErr } = await svc.from("movimientos_raw").delete().eq("documento_id", documento_id);
  if (movDelErr) {
    return NextResponse.json({ error: "No se pudo deshacer. Intenta de nuevo." }, { status: 500 });
  }

  // Delete ia_uso
  await svc.from("ia_uso").delete().eq("documento_id", documento_id);

  // Reset document state to "subido" (not delete — keep file in Storage)
  const { error: resetErr } = await svc
    .from("documentos_subidos")
    .update({
      estado: "subido",
      movimientos_detectados: 0,
      progreso_ia: null,
    })
    .eq("id", documento_id);
  if (resetErr) {
    return NextResponse.json({ error: "No se pudo deshacer. Intenta de nuevo." }, { status: 500 });
  }

  // Rastro de auditoría (antes deshacer no dejaba registro pese a ser destructivo).
  await recordCuentaAudit({
    sb: svc,
    empresaId: usuario.empresa_id,
    usuarioId: user.id,
    accion: "documento_deshecho",
    recursoTipo: "documento",
    recursoId: documento_id,
    resumen: `Documento "${documento.nombre_archivo}" deshecho (${movIds.length} movimientos)`,
    metadata: { nombre_archivo: documento.nombre_archivo, movimientos: movIds.length },
  });

  return NextResponse.json({ ok: true });
}
