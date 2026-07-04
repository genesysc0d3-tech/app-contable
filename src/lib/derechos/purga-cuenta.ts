import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

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
};

/**
 * Purga TOTAL de una cuenta (auditoría #27B — "la eliminación total la procesa el
 * operador"). Borra:
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

  // 2. Documentos de esas empresas (para ubicar las filas huérfanas de PII).
  const docIds: string[] = [];
  for (const batch of enBloques(empresaIds, CHUNK)) {
    const { data, error } = await sb.from("documentos_subidos").select("id").in("empresa_id", batch);
    if (error) throw new Error(`No se pudieron leer documentos: ${error.message}`);
    docIds.push(...(data ?? []).map((d) => d.id));
  }

  // 3. PII huérfana PRIMERO (documento_id SET NULL): audit_chunks + parser_logs.
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

  // 4. Empresas (cascade lleva docs/movimientos/clientes/propuestas/boletas/etc.).
  for (const batch of enBloques(empresaIds, CHUNK)) {
    const { error } = await sb.from("empresas").delete().in("id", batch);
    if (error) throw new Error(`No se pudieron borrar empresas: ${error.message}`);
  }

  // 5. La cuenta (cascade lleva miembros/suscripciones/refills/addons/auditoría).
  const { error: cuErr } = await sb.from("cuentas").delete().eq("id", cuentaId);
  if (cuErr) throw new Error(`No se pudo borrar la cuenta: ${cuErr.message}`);

  return { empresas: empresaIds.length, documentos: docIds.length, auditChunks, parserLogs };
}
