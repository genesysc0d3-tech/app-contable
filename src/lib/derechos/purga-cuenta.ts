import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { deleteFromR2 } from "@/lib/r2";

type Sb = SupabaseClient<Database>;

const CHUNK = 500;

function* enBloques<T>(arr: T[], n: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n);
}

export type PurgaResumen = {
  empresas: number;
  documentos: number;
  auditChunks: number;
  parserLogs: number;
  /** Archivos borrados del almacenamiento (R2 + Supabase Storage). */
  archivos: number;
  /** Archivos que el proveedor no pudo borrar: quedan para revisión manual. */
  archivosFallidos: string[];
};

/**
 * Purga TOTAL de una cuenta (auditoría #27B — "la eliminación total la procesa el
 * operador"). Borra:
 *  - Los ARCHIVOS FÍSICOS de los documentos (R2, Supabase Storage y los álbumes
 *    de imágenes de Telegram). Hasta 2026-09-04 esto NO se hacía: se borraban
 *    las filas y los binarios quedaban en el proveedor SIN ninguna fila que los
 *    apuntara — cartolas y comprobantes con RUT, nombres y montos de terceros,
 *    imposibles de borrar después desde la app. Un cliente que ejercía su
 *    derecho de supresión se quedaba con sus archivos vivos en dos nubes.
 *    Ojo con el ORDEN: los archivos van ANTES que las filas, porque la fila es
 *    el único puntero al binario (mismo criterio que eliminar-documento).
 *  - Las tablas HUÉRFANAS de PII (audit_chunks / parser_logs): su documento_id es
 *    ON DELETE SET NULL, así que sobreviven al borrado del documento con el texto
 *    CRUDO de las cartolas dentro. Hay que borrarlas explícitamente y ANTES que las
 *    empresas, o quedan huérfanas para siempre (ese es justo el hueco #27).
 *  - Todas las empresas de la cuenta (cascade → documentos, movimientos_raw,
 *    clientes, propuestas_ia, boletas, transacciones, ia_uso, usuarios, cuenta_empresas).
 *  - La cuenta (cascade → cuenta_usuarios, cuenta_addons, suscripciones, refills,
 *    cuenta_audit_events, emission_authorizations).
 *
 * CONSERVA a propósito auth.users + consentimientos (prueba de consentimiento ARCO,
 * Ley 21.719): borrar la identidad de Auth es un paso manual aparte, con criterio
 * legal, por la tensión prueba-de-consentimiento vs derecho-al-olvido.
 *
 * Requiere service-role (borra a través de RLS). NO valida permisos: el llamador
 * (acción dev) hace el gate de operador y la confirmación.
 */
export async function purgarCuentaCompleta(sb: Sb, cuentaId: string): Promise<PurgaResumen> {
  // 1. Empresas de la cuenta (activas o no).
  const { data: ce, error: ceErr } = await sb
    .from("cuenta_empresas")
    .select("empresa_id")
    .eq("cuenta_id", cuentaId);
  if (ceErr) throw new Error(`No se pudieron leer empresas de la cuenta: ${ceErr.message}`);
  const empresaIds = (ce ?? []).map((r) => r.empresa_id).filter((x): x is string => !!x);

  // FRENO DURO (revisión adversarial 2026-08-22): una empresa con boletas
  // emitidas en el SII es historia tributaria con retención obligatoria de 6
  // años (Código Tributario) — la purga JAMÁS puede llevársela en cascada,
  // ni por typo del operador ni por una migración que quedó a medias. Estas
  // cuentas se cierran con criterio humano (anonimizar/retener), no con purga.
  for (const batch of enBloques(empresaIds, CHUNK)) {
    const { count, error } = await sb
      .from("boletas_emitidas")
      .select("id", { count: "exact", head: true })
      .in("empresa_id", batch);
    if (error) throw new Error(`No se pudo verificar boletas emitidas: ${error.message}`);
    if ((count ?? 0) > 0) {
      throw new Error(
        `PURGA_BLOQUEADA: la cuenta tiene ${count} boleta(s) emitida(s) en el SII (retención 6 años). ` +
        "No se puede purgar; el cierre de esta cuenta requiere criterio humano.",
      );
    }
  }

  // 2. Documentos de esas empresas (para ubicar las filas huérfanas de PII).
  const docIds: string[] = [];
  for (const batch of enBloques(empresaIds, CHUNK)) {
    const { data, error } = await sb.from("documentos_subidos").select("id").in("empresa_id", batch);
    if (error) throw new Error(`No se pudieron leer documentos: ${error.message}`);
    docIds.push(...(data ?? []).map((d) => d.id));
  }

  // 3. ARCHIVOS FÍSICOS antes de borrar cualquier fila: la fila es el único
  // puntero al binario. Si se cae en medio, se puede reintentar; al revés
  // quedaría PII infindable. Los fallos NO abortan la purga (dejar la cuenta a
  // medias es peor), pero salen en el resumen para que el operador los cierre a
  // mano — y por eso el resumen los devuelve en vez de tragárselos.
  let archivos = 0;
  const archivosFallidos: string[] = [];
  for (const batch of enBloques(docIds, CHUNK)) {
    const { data: docs, error } = await sb
      .from("documentos_subidos")
      .select("id, storage_path, storage_provider, album_imagenes")
      .in("id", batch);
    if (error) throw new Error(`No se pudieron leer los archivos a borrar: ${error.message}`);
    const porSupabase: string[] = [];
    for (const d of docs ?? []) {
      const album = (d.album_imagenes as Array<{ path?: string }> | null) ?? [];
      const paths = [d.storage_path, ...album.map((img) => img?.path)]
        .filter((x): x is string => Boolean(x) && x !== "memoria");
      if (paths.length === 0) continue;
      if (d.storage_provider === "r2") {
        for (const path of paths) {
          try {
            await deleteFromR2(path);
            archivos += 1;
          } catch {
            archivosFallidos.push(path);
          }
        }
      } else if (d.storage_provider === "supabase") {
        porSupabase.push(...paths);
      }
      // provider "memoria" (uploads efímeros): no hay archivo que borrar.
    }
    if (porSupabase.length > 0) {
      const { error: rmErr } = await sb.storage.from("documentos").remove(porSupabase);
      if (rmErr) archivosFallidos.push(...porSupabase);
      else archivos += porSupabase.length;
    }
  }

  // 4. PII huérfana (documento_id SET NULL): audit_chunks + parser_logs.
  let auditChunks = 0;
  let parserLogs = 0;
  for (const batch of enBloques(docIds, CHUNK)) {
    const a = await sb.from("audit_chunks").delete({ count: "exact" }).in("documento_id", batch);
    if (a.error) throw new Error(`No se pudieron borrar audit_chunks: ${a.error.message}`);
    auditChunks += a.count ?? 0;
    const p = await sb.from("parser_logs").delete({ count: "exact" }).in("documento_id", batch);
    if (p.error) throw new Error(`No se pudieron borrar parser_logs: ${p.error.message}`);
    parserLogs += p.count ?? 0;
  }

  // 5. Empresas (cascade lleva docs/movimientos/clientes/propuestas/boletas/etc.).
  for (const batch of enBloques(empresaIds, CHUNK)) {
    const { error } = await sb.from("empresas").delete().in("id", batch);
    if (error) throw new Error(`No se pudieron borrar empresas: ${error.message}`);
  }

  // 6. La cuenta (cascade lleva miembros/suscripciones/refills/addons/auditoría).
  const { error: cuErr } = await sb.from("cuentas").delete().eq("id", cuentaId);
  if (cuErr) throw new Error(`No se pudo borrar la cuenta: ${cuErr.message}`);

  return { empresas: empresaIds.length, documentos: docIds.length, auditChunks, parserLogs, archivos, archivosFallidos };
}
