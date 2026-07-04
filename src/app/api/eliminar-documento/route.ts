import { NextResponse } from "next/server";
import { esRolEmision } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { deleteFromR2 } from "@/lib/r2";
import { recordCuentaAudit } from "@/lib/audit/account";
import { cancelDocumentProcessingJob } from "@/lib/document-processing/queue";

// Elimina un documento COMPLETO de la mesa: archivo físico (R2/Supabase, incluido
// el álbum Telegram), movimientos, propuestas y la fila. Es el hermano duro de
// /api/deshacer-documento (que resetea a "subido" y conserva el archivo).
// BARRERA FINAL intacta: si el documento tiene ≥1 boleta emitida en el SII
// (folio real), NO se puede eliminar — igual que deshacer, se corrige vía soporte.
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
  // Eliminar es más destructivo que deshacer: mismos roles permitidos.
  if (!esRolEmision(usuario.rol)) {
    return NextResponse.json({ error: "Tu rol no permite eliminar documentos" }, { status: 403 });
  }

  const body = await request.json();
  const { documento_id } = body;

  if (!documento_id) {
    return NextResponse.json({ error: "documento_id requerido" }, { status: 400 });
  }

  const { data: documento } = await supabase
    .from("documentos_subidos")
    .select("id, empresa_id, nombre_archivo, tipo, estado, storage_path, storage_provider, album_imagenes")
    .eq("id", documento_id)
    .eq("empresa_id", usuario.empresa_id)
    .single();

  if (!documento) {
    return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
  }

  // Los registros de boletas ya emitidas (boleta_unica / boleta_sii_local / …)
  // no son cartolas: son el comprobante de un folio real. No se eliminan de acá.
  if ((documento.tipo ?? "").startsWith("boleta_")) {
    return NextResponse.json(
      { error: "Este registro corresponde a una boleta emitida — se ve en la pestaña Boletas y no se puede eliminar." },
      { status: 409 },
    );
  }
  if (documento.estado === "procesando") {
    return NextResponse.json(
      { error: "El documento se está procesando. Cancela el procesamiento antes de eliminarlo." },
      { status: 409 },
    );
  }

  const svc = createServiceClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // El estado del documento no basta: puede decir "error" (cancelado) mientras el
  // job durable sigue 'running' e inserta filas. Cancelamos el job y, si estaba en
  // vuelo, pedimos reintentar en vez de borrar bajo un worker activo (FK/zombie).
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
        { error: "El documento se está procesando en este momento. Intenta eliminarlo de nuevo en unos segundos." },
        { status: 409 },
      );
    }
  }

  const { data: movimientos } = await svc
    .from("movimientos_raw")
    .select("id")
    .eq("documento_id", documento_id);

  const movIds = (movimientos ?? []).map((m) => m.id);
  let propIds: string[] = [];

  if (movIds.length > 0) {
    // INTEGRIDAD TRIBUTARIA (mismo guard que deshacer): con boletas emitidas en
    // el SII este documento está congelado — eliminar orfanaría folios reales.
    const { data: props } = await svc.from("propuestas_ia").select("id").in("movimiento_id", movIds);
    propIds = (props ?? []).map((p) => p.id);
    if (propIds.length > 0) {
      const { count } = await svc
        .from("boletas_emitidas")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", usuario.empresa_id)
        .neq("estado", "anulada")
        .in("propuesta_id", propIds);
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: `Este documento tiene ${count} boleta(s) emitida(s) en el SII y no se puede eliminar. Para corregir o anular, escríbenos a soporte.` },
          { status: 409 },
        );
      }
    }
  }

  // Archivos físicos ANTES que la fila: si el borrado del storage falla y ya no
  // existiera el puntero en la DB, quedaría PII infindable (cartola huérfana).
  // Álbum Telegram: varias imágenes bajo el mismo provider del documento.
  const album = (documento.album_imagenes as Array<{ path?: string }> | null) ?? [];
  const paths = [documento.storage_path, ...album.map((img) => img?.path)]
    .filter((p): p is string => Boolean(p) && p !== "memoria");
  if (documento.storage_provider === "r2") {
    for (const p of paths) {
      try {
        await deleteFromR2(p);
      } catch {
        return NextResponse.json(
          { error: "No se pudo eliminar el archivo del almacenamiento. Intenta de nuevo." },
          { status: 500 },
        );
      }
    }
  } else if (documento.storage_provider === "supabase" && paths.length > 0) {
    const { error: rmErr } = await svc.storage.from("documentos").remove(paths);
    if (rmErr) {
      return NextResponse.json(
        { error: "No se pudo eliminar el archivo del almacenamiento. Intenta de nuevo." },
        { status: 500 },
      );
    }
  }
  // provider "memoria" (uploads efímeros): no hay archivo que borrar.

  // PII asociada primero (mismo orden que la purga ARCO: audit_chunks/parser_logs
  // guardan texto crudo de la cartola y su documento_id quedaría SET NULL).
  await svc.from("audit_chunks").delete().eq("documento_id", documento_id);
  await svc.from("parser_logs").delete().eq("documento_id", documento_id);

  // Orden FK: propuestas → movimientos → ia_uso → fila del documento.
  if (movIds.length > 0) {
    await svc.from("propuestas_ia").delete().in("movimiento_id", movIds);
    await svc.from("movimientos_raw").delete().eq("documento_id", documento_id);
  }
  await svc.from("ia_uso").delete().eq("documento_id", documento_id);
  const { error: delErr } = await svc.from("documentos_subidos").delete().eq("id", documento_id);
  if (delErr) {
    return NextResponse.json({ error: "No se pudo eliminar el documento. Intenta de nuevo." }, { status: 500 });
  }

  await recordCuentaAudit({
    sb: svc,
    empresaId: usuario.empresa_id,
    usuarioId: user.id,
    accion: "documento_eliminado",
    recursoTipo: "documento",
    recursoId: documento_id,
    resumen: `Documento "${documento.nombre_archivo}" eliminado de la mesa (${propIds.length} propuestas, ${movIds.length} movimientos)`,
    metadata: { nombre_archivo: documento.nombre_archivo, tipo: documento.tipo, propuestas: propIds.length, movimientos: movIds.length },
  });

  return NextResponse.json({ ok: true });
}
