import { NextResponse } from "next/server";
import { esRolEmision } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { cancelDocumentProcessingJob } from "@/lib/document-processing/queue";
import { recordCuentaAudit } from "@/lib/audit/account";
import {
  esErrorCandadoBD,
  MENSAJE_CANDADO_BD,
  MENSAJE_NO_PUDIMOS_REVISAR,
  revisarBloqueoDocumento,
} from "@/lib/emission/bloqueo-borrado";

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

  // Orden: revisar (candado 1) → movimientos (cascada a propuestas, candado 2) →
  // ia_uso → reset documento.
  const { data: movimientos, error: movErr } = await svc
    .from("movimientos_raw")
    .select("id")
    .eq("documento_id", documento_id);
  if (movErr) {
    return NextResponse.json({ error: MENSAJE_NO_PUDIMOS_REVISAR }, { status: 503 });
  }

  const movIds = (movimientos ?? []).map((m) => m.id);

  if (movIds.length > 0) {
    // CANDADO 1 (fail-closed, doble candado 2026-09-30). INTEGRIDAD TRIBUTARIA: si
    // alguna propuesta ya tiene boleta emitida (folio real en el SII), NO se
    // deshace — se corrige vía Nota de Crédito. INTEGRIDAD DE FOLIO: tampoco con
    // un job de emisión abierto (created/running, vencido o no) ni una LÁPIDA
    // 'revision_pendiente': borrar la propuesta pone emision_jobs.propuesta_id en
    // NULL (ON DELETE SET NULL), la lápida queda huérfana y reprocesar la cartola
    // crea una propuesta nueva SIN candado → doble folio. Si CUALQUIER consulta
    // falla, no se borra nada (antes el error se ignoraba y se borraba igual).
    const bloqueo = await revisarBloqueoDocumento(svc, movIds);
    if ("error" in bloqueo) {
      console.error("[deshacer-documento] revisión de emitidas falló:", bloqueo.error);
      return NextResponse.json({ error: MENSAJE_NO_PUDIMOS_REVISAR }, { status: 503 });
    }
    if (bloqueo.emitidas > 0) {
      return NextResponse.json(
        { error: `Este documento tiene ${bloqueo.emitidas} boleta(s) emitida(s) en el SII. No se puede deshacer; para corregir o anular, emite una Nota de Crédito.` },
        { status: 409 },
      );
    }
    if (bloqueo.emisionesAbiertas > 0) {
      return NextResponse.json(
        { error: "Esta boleta tiene una emisión en curso o quedó a medias en el SII. Espera a que termine o recupera su folio antes de deshacer." },
        { status: 409 },
      );
    }

    // UNA sentencia: movimientos_raw → propuestas_ia es ON DELETE CASCADE, así que
    // el borrado es atómico (sin .in() gigante) y pasa por el trigger de la base
    // (candado 2). Si salta, se revierte todo y el documento queda como estaba.
    const { error: movDelErr } = await svc.from("movimientos_raw").delete().eq("documento_id", documento_id);
    if (movDelErr) {
      if (esErrorCandadoBD(movDelErr)) {
        return NextResponse.json({ error: MENSAJE_CANDADO_BD }, { status: 409 });
      }
      // No dejar el documento a medias: abortamos ANTES de resetear a 'subido'.
      return NextResponse.json({ error: "No se pudo deshacer. No se borró nada; inténtalo de nuevo." }, { status: 500 });
    }
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
