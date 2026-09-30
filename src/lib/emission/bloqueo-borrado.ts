// ¿Se puede BORRAR esta cartola / estas propuestas? (doble candado, 2026-09-30)
//
// Regla del fundador: "las emitidas nunca vuelven; el documento en Check con
// emitidas no se puede borrar; solo vuelve lo que no se terminó".
//
// CANDADO 1 (este archivo, en la app): antes de borrar, se revisa si alguna
// propuesta tiene boleta no anulada o un intento de emisión abierto
// (created / running — vencido o no — o la lápida revision_pendiente). Es
// FAIL-CLOSED: si cualquier consulta falla, el llamador NO borra nada. Antes se
// ignoraba el `error` de estas consultas y, si Supabase fallaba, se borraba igual:
// la lápida quedaba huérfana (propuesta_id → NULL, ON DELETE SET NULL) y re-subir
// la cartola podía emitir la misma venta dos veces.
//
// Las consultas van en trozos de 100 ids: un .in() con cientos de uuids pasa el
// largo de URL de PostgREST y vuelve error (era otro camino al fail-open).
//
// CANDADO 2 (en la base): trigger BEFORE DELETE en propuestas_ia
// (migración 20260930120000_candado_borrar_propuesta_emitida.sql) que lanza
// PROPUESTA_CON_EMISION con las mismas condiciones. Si el candado 1 falla (bug,
// carrera, un camino nuevo que se olvidó del guard), el 2 aborta la transacción.
//
// Más estricto que clasificarIntocables (propuestas-intocables.ts): para BORRAR,
// cualquier job created/running cuenta, sin importar vencimiento ni el corte
// SIN_RESPUESTA_DESDE — igual que el trigger. Un running colgado es un resultado
// desconocido; borrar su propuesta lo dejaría sin dueño para siempre.

/** Estados de emision_jobs que impiden borrar su propuesta (mismo set que el trigger). */
export const ESTADOS_JOB_BLOQUEAN_BORRADO = ["created", "running", "revision_pendiente"] as const;

/** Código que lanza el trigger de la base (candado 2). */
export const CODIGO_CANDADO_BD = "PROPUESTA_CON_EMISION";

export const MENSAJE_NO_PUDIMOS_REVISAR =
  "No pudimos revisar si hay boletas emitidas. No se borró nada; inténtalo de nuevo.";

export const MENSAJE_CANDADO_BD =
  "Este documento tiene boletas emitidas o una emisión a medias en el SII, así que no se puede borrar. No se borró nada. Para corregir o anular, escríbenos a soporte.";

/** Trozos chicos: un .in() con cientos de uuids se pasa del largo de URL y vuelve error. */
export const TROZO_BORRADO = 100;

// Cliente mínimo (service role): solo lo que usamos, para no acoplar tipos.
type Consulta = {
  select: (cols: string, opts?: { count?: "exact"; head?: boolean }) => Consulta;
  eq: (col: string, v: unknown) => Consulta;
  neq: (col: string, v: unknown) => Consulta;
  in: (col: string, v: readonly unknown[]) => Consulta;
} & PromiseLike<{ data: unknown[] | null; error: { message: string } | null; count?: number | null }>;
export type SbBorrado = { from: (t: string) => unknown };

function trozos<T>(arr: T[], n = TROZO_BORRADO): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** ids de propuestas de estos movimientos, en trozos. `error` = no seguir. */
export async function propuestasDeMovimientos(
  sb: SbBorrado,
  movIds: string[],
): Promise<{ ids: string[] } | { error: string }> {
  const ids: string[] = [];
  for (const trozo of trozos(movIds)) {
    const r = await (sb.from("propuestas_ia") as Consulta).select("id").in("movimiento_id", trozo);
    if (r.error) return { error: r.error.message };
    for (const p of (r.data ?? []) as Array<{ id: string }>) ids.push(p.id);
  }
  return { ids };
}

export type BloqueoBorrado = { emitidas: number; emisionesAbiertas: number };

/**
 * Cuenta boletas no anuladas y jobs abiertos de las propuestas (2 consultas por
 * trozo de 100). Devuelve `error` si alguna consulta falla: el llamador NO borra.
 * Sin filtro de empresa a propósito (igual que el trigger): una boleta de la
 * propuesta bloquea venga de donde venga.
 */
export async function revisarBloqueoBorrado(
  sb: SbBorrado,
  propIds: string[],
): Promise<BloqueoBorrado | { error: string }> {
  let emitidas = 0;
  let emisionesAbiertas = 0;
  for (const trozo of trozos(propIds)) {
    const [bols, jobs] = await Promise.all([
      (sb.from("boletas_emitidas") as Consulta)
        .select("id", { count: "exact", head: true })
        .neq("estado", "anulada")
        .in("propuesta_id", trozo),
      (sb.from("emision_jobs") as Consulta)
        .select("job_id", { count: "exact", head: true })
        .in("propuesta_id", trozo)
        .in("estado", [...ESTADOS_JOB_BLOQUEAN_BORRADO]),
    ]);
    if (bols.error) return { error: `boletas_emitidas: ${bols.error.message}` };
    if (jobs.error) return { error: `emision_jobs: ${jobs.error.message}` };
    // count null sin error = respuesta rara: fail-closed también.
    if (typeof bols.count !== "number" || typeof jobs.count !== "number") {
      return { error: "conteo vacío" };
    }
    emitidas += bols.count;
    emisionesAbiertas += jobs.count;
  }
  return { emitidas, emisionesAbiertas };
}

/**
 * Revisa todo lo de un documento a partir de sus movimientos. Devuelve el
 * bloqueo, o `error` (fail-closed).
 */
export async function revisarBloqueoDocumento(
  sb: SbBorrado,
  movIds: string[],
): Promise<(BloqueoBorrado & { propIds: string[] }) | { error: string }> {
  if (movIds.length === 0) return { emitidas: 0, emisionesAbiertas: 0, propIds: [] };
  const props = await propuestasDeMovimientos(sb, movIds);
  if ("error" in props) return props;
  if (props.ids.length === 0) return { emitidas: 0, emisionesAbiertas: 0, propIds: [] };
  const b = await revisarBloqueoBorrado(sb, props.ids);
  if ("error" in b) return b;
  return { ...b, propIds: props.ids };
}

/** ¿Este error viene del trigger de la base (candado 2)? */
export function esErrorCandadoBD(err: { message?: string | null; code?: string | null } | null | undefined): boolean {
  if (!err) return false;
  return (err.message ?? "").includes(CODIGO_CANDADO_BD) || err.code === "MDE01";
}
