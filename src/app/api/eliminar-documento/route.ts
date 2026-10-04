import { NextResponse } from "next/server";
import { esRolEmision } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { deleteFromR2 } from "@/lib/r2";
import { esPathDeEmpresa } from "@/lib/storage";
import { recordCuentaAudit } from "@/lib/audit/account";
import { resumenPropuestasABorrar } from "@/lib/propuestas/resumen-borrado";
import { cancelDocumentProcessingJob } from "@/lib/document-processing/queue";
import {
  esErrorCandadoBD,
  MENSAJE_CANDADO_BD,
  MENSAJE_NO_PUDIMOS_REVISAR,
  revisarBloqueoDocumento,
} from "@/lib/emission/bloqueo-borrado";

// Elimina un documento COMPLETO de la mesa: archivo físico (R2/Supabase, incluido
// el álbum Telegram), movimientos, propuestas y la fila. Es el hermano duro de
// /api/deshacer-documento (que resetea a "subido" y conserva el archivo).
// DOBLE CANDADO (2026-09-30): si el documento tiene ≥1 boleta emitida en el SII
// (folio real) o una emisión abierta/lápida, NO se puede eliminar — candado 1 en
// la app (fail-closed) y candado 2 en la base (trigger PROPUESTA_CON_EMISION).
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

  const { data: movimientos, error: movErr } = await svc
    .from("movimientos_raw")
    .select("id")
    .eq("documento_id", documento_id);
  if (movErr) {
    return NextResponse.json({ error: MENSAJE_NO_PUDIMOS_REVISAR }, { status: 503 });
  }

  const movIds = (movimientos ?? []).map((m) => m.id);

  // CANDADO 1 (fail-closed, doble candado 2026-09-30): con boletas emitidas en el
  // SII, un job de emisión en vuelo o una LÁPIDA (a medias / sin respuesta) este
  // documento está congelado — borrarlo orfanaría folios reales (propuesta_id →
  // NULL) y re-subir la cartola podría emitir dos veces. Si CUALQUIER consulta
  // falla, no se borra nada. En trozos de 100 (cartolas grandes = URL larga).
  // CANDADO 2: el trigger PROPUESTA_CON_EMISION de la base, más abajo.
  const bloqueo = await revisarBloqueoDocumento(svc, movIds);
  if ("error" in bloqueo) {
    console.error("[eliminar-documento] revisión de emitidas falló:", bloqueo.error);
    return NextResponse.json({ error: MENSAJE_NO_PUDIMOS_REVISAR }, { status: 503 });
  }
  const propIds = bloqueo.propIds;
  if (bloqueo.emitidas > 0) {
    return NextResponse.json(
      { error: `Este documento tiene ${bloqueo.emitidas} boleta(s) emitida(s) en el SII y no se puede eliminar. Para corregir o anular, escríbenos a soporte.` },
      { status: 409 },
    );
  }
  if (bloqueo.emisionesAbiertas > 0) {
    return NextResponse.json(
      { error: "Esta boleta tiene una emisión en curso o quedó a medias en el SII. Espera a que termine o recupera su folio antes de eliminar." },
      { status: 409 },
    );
  }

  // Movimientos ANTES que los archivos, en UNA sola sentencia: la cascada
  // movimientos_raw → propuestas_ia es atómica y pasa por el trigger. Si el
  // candado 2 salta (carrera: una emisión arrancó recién), la base revierte TODO y
  // el archivo sigue intacto. Si después falla el borrado del archivo, el documento
  // queda sin movimientos pero con su archivo y su fila: reintentar eliminar lo cierra.
  // Rastro del borrado (Fase 1 medición): SOLO conteos de lo que se va, para la
  // auditoría. Best-effort (null si la base no lo tiene); nunca frena el borrado.
  const propuestasResumen = propIds.length > 0
    ? await resumenPropuestasABorrar(svc, { empresaId: documento.empresa_id, documentoId: documento_id })
    : null;

  if (movIds.length > 0) {
    const { error: movDelErr } = await svc.from("movimientos_raw").delete().eq("documento_id", documento_id);
    if (movDelErr) {
      if (esErrorCandadoBD(movDelErr)) {
        return NextResponse.json({ error: MENSAJE_CANDADO_BD }, { status: 409 });
      }
      return NextResponse.json({ error: "No se pudo eliminar el documento. No se borró nada; inténtalo de nuevo." }, { status: 500 });
    }
  }

  // Si el archivo no se puede borrar, los movimientos ya se fueron: que la fila no
  // siga contando movimientos que no existen (reintentar eliminar lo termina).
  const marcarSinMovimientos = async () => {
    if (movIds.length > 0) {
      await svc.from("documentos_subidos").update({ movimientos_detectados: 0 }).eq("id", documento_id);
    }
  };

  // Archivos físicos ANTES que la fila: si el borrado del storage falla y ya no
  // existiera el puntero en la DB, quedaría PII infindable (cartola huérfana).
  // Álbum Telegram: varias imágenes bajo el mismo provider del documento.
  const album = (documento.album_imagenes as Array<{ path?: string }> | null) ?? [];
  const paths = [documento.storage_path, ...album.map((img) => img?.path)]
    // Solo archivos de ESTA empresa (auditoría 2026-10-01): un path ajeno escrito en la
    // fila borraría con service role el archivo de otra empresa. Lo ajeno se ignora.
    .filter((p): p is string => Boolean(p) && p !== "memoria" && esPathDeEmpresa(p, documento.empresa_id));
  if (documento.storage_provider === "r2") {
    for (const p of paths) {
      try {
        await deleteFromR2(p);
      } catch {
        await marcarSinMovimientos();
        return NextResponse.json(
          { error: "No se pudo eliminar el archivo del almacenamiento. Intenta de nuevo." },
          { status: 500 },
        );
      }
    }
  } else if (documento.storage_provider === "supabase" && paths.length > 0) {
    const { error: rmErr } = await svc.storage.from("documentos").remove(paths);
    if (rmErr) {
      await marcarSinMovimientos();
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

  // Propuestas y movimientos ya se fueron arriba (cascada). Queda ia_uso → fila.
  await svc.from("ia_uso").delete().eq("documento_id", documento_id);
  const { error: delErr } = await svc.from("documentos_subidos").delete().eq("id", documento_id);
  if (delErr) {
    if (esErrorCandadoBD(delErr)) {
      return NextResponse.json({ error: MENSAJE_CANDADO_BD }, { status: 409 });
    }
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
    metadata: {
      nombre_archivo: documento.nombre_archivo, tipo: documento.tipo, propuestas: propIds.length, movimientos: movIds.length,
      ...(propuestasResumen ? { propuestas_resumen: propuestasResumen } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
