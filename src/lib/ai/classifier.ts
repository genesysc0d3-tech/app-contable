import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { MovimientoExtraido, PropuestaExtraida } from "./types";

/**
 * Deterministic rules-based classifier.
 *
 * Runs BEFORE Mistral in the bypass path. For each movimiento, tries to
 * match a user rule (empresa_id set) first, then a global rule
 * (empresa_id NULL), in order of `prioridad` ascending. First match wins.
 *
 * Movimientos that don't match any rule are returned in `noClasificados`
 * for Mistral to handle as a fallback. Mistral-classified propuestas are
 * then capped at confianza ≤ 0.75 by the processor so they always land
 * in the "requires review" bucket — protecting the user from silent
 * Mistral mistakes that could matter for SII compliance.
 */

export interface ClasificacionRegla {
  id: string;
  empresa_id: string | null;
  nombre: string;
  patron: string;
  patron_tipo: "contains" | "regex" | "starts_with" | "exact";
  tipo_flujo_match: "entrada" | "salida" | null;
  tipo_propuesto: string;
  receptor_nombre_default: string | null;
  receptor_rut_default: string | null;
  confianza: number;
  prioridad: number;
  /**
   * DTE recordado de una decisión humana (39 afecta / 41 exenta / null = no
   * forzar). Solo las reglas de USUARIO lo aprovechan: cuando matchean, la
   * propuesta nace con tipo_dte persistido y el gate la manda directo a
   * "listas" en vez de rebotar a Check (ver aprender-regla.ts).
   */
  tipo_dte: number | null;
}

export interface ClassifierResult {
  clasificados: Array<{
    movimiento_index: number;
    propuesta: PropuestaExtraida;
    regla_id: string;
    fuente: "regla_usuario" | "regla_global";
    /**
     * tipo_dte a persistir en la propuesta. Solo != null para reglas de
     * usuario que lo recordaron; las globales (seed) lo dejan null para no
     * cambiar su comportamiento (el gate sigue decidiendo por ellas).
     */
    tipo_dte: number | null;
  }>;
  noClasificados: Array<{
    movimiento_index: number;
    movimiento: MovimientoExtraido;
  }>;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key);
}

/**
 * Load active rules for an empresa (user rules + global rules). Returns them
 * sorted by prioridad ascending — lower number = higher priority, user rules
 * by convention use prioridad 50, globals use 80-110.
 */
export async function loadReglas(empresaId: string): Promise<ClasificacionRegla[]> {
  try {
    const sb = getServiceClient();
    if (!sb) return [];
    const { data, error } = await sb
      .from("clasificacion_reglas")
      .select("*")
      .or(`empresa_id.eq.${empresaId},empresa_id.is.null`)
      .eq("activa", true)
      .order("prioridad", { ascending: true });
    if (error || !data) return [];
    return data as ClasificacionRegla[];
  } catch {
    return [];
  }
}

/**
 * Test whether a movimiento matches a rule. Case-insensitive for contains/
 * starts_with/exact. Regex uses the `i` flag.
 */
export function ruleMatches(
  mov: MovimientoExtraido,
  rule: ClasificacionRegla
): boolean {
  // Flow must match if the rule specifies one
  if (rule.tipo_flujo_match && rule.tipo_flujo_match !== mov.tipo_flujo) {
    return false;
  }
  const desc = (mov.descripcion ?? "").trim();
  if (!desc) return false;

  switch (rule.patron_tipo) {
    case "contains":
      return desc.toLowerCase().includes(rule.patron.toLowerCase());
    case "starts_with":
      return desc.toLowerCase().startsWith(rule.patron.toLowerCase());
    case "exact":
      return desc.toLowerCase() === rule.patron.toLowerCase();
    case "regex":
      try {
        return new RegExp(rule.patron, "i").test(desc);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Derive a receptor name from a movimiento description when the rule doesn't
 * specify a default. For P2P transfers we take whatever follows "TRANSFER DE"
 * or "TRANSFER A" as the counterparty name. Simple heuristic, not exhaustive.
 */
function inferReceptorNombre(mov: MovimientoExtraido): string | null {
  const desc = (mov.descripcion ?? "").trim();
  const m = desc.match(/(?:TRANSFER|TRANSF\.?)\s+(?:DE|A|DESDE|PARA)\s+([A-ZÁÉÍÓÚÑ].+)/i);
  if (m && m[1]) return m[1].trim();
  return null;
}

/**
 * Build a propuesta from a matched rule + movimiento. Sets confianza, total,
 * and receptor fields. Always forces total = monto so numeric integrity is
 * preserved.
 */
function buildPropuestaFromRule(
  mov: MovimientoExtraido,
  movIndex: number,
  rule: ClasificacionRegla
): PropuestaExtraida {
  const receptor_nombre =
    rule.receptor_nombre_default ?? inferReceptorNombre(mov);
  const total = mov.monto;
  // Check if rule tipo_propuesto has IVA (factura_afecta, boleta_honorarios)
  const hasIva =
    rule.tipo_propuesto === "factura_afecta" ||
    rule.tipo_propuesto === "boleta_honorarios";
  const monto_neto = hasIva ? Math.round(total / 1.19) : total;
  const iva = hasIva ? total - monto_neto : 0;

  return {
    movimiento_index: movIndex,
    tipo_propuesto: rule.tipo_propuesto as PropuestaExtraida["tipo_propuesto"],
    receptor_nombre,
    receptor_rut: rule.receptor_rut_default,
    monto_neto,
    iva,
    total,
    confianza: rule.confianza,
    // notas = detalle IMPRIMIBLE en la boleta (máxima precedencia en resolverGlosa).
    // NO metemos el nombre de la regla acá: sobre el umbral de identificación se
    // imprimiría en el DTE y la regla aprendida lleva el nombre de la contraparte
    // (tercero) → fuga de datos (misma clase que cerró PR #56). Sin nota, la glosa
    // cae a la glosa común de la cartola o al genérico. El humano puede escribir
    // su propio detalle después.
    notas: null,
    spread_compra: null,
    spread_venta: null,
    spread_ganancia: null,
  };
}

/**
 * Classify a batch of movimientos using the loaded rules.
 *
 * For each movimiento, the first matching rule (by prioridad ascending)
 * wins. Movimientos without any matching rule go to `noClasificados`.
 */
export function classifyWithRules(
  movimientos: MovimientoExtraido[],
  reglas: ClasificacionRegla[]
): ClassifierResult {
  const clasificados: ClassifierResult["clasificados"] = [];
  const noClasificados: ClassifierResult["noClasificados"] = [];

  for (let i = 0; i < movimientos.length; i++) {
    const mov = movimientos[i];
    const matchingRule = reglas.find((r) => ruleMatches(mov, r));
    if (matchingRule) {
      clasificados.push({
        movimiento_index: i,
        propuesta: buildPropuestaFromRule(mov, i, matchingRule),
        regla_id: matchingRule.id,
        fuente: matchingRule.empresa_id ? "regla_usuario" : "regla_global",
        // Solo las reglas de usuario (empresa_id set) auto-pasan a listas con el
        // tipo recordado. Las globales dejan tipo_dte null → el gate decide.
        tipo_dte: matchingRule.empresa_id ? (matchingRule.tipo_dte ?? null) : null,
      });
    } else {
      noClasificados.push({ movimiento_index: i, movimiento: mov });
    }
  }

  return { clasificados, noClasificados };
}

/**
 * Increment the veces_aplicada counter for a set of rules. Best-effort —
 * a DB failure here is non-fatal and doesn't affect classification.
 */
export async function incrementRuleUsage(reglaIds: string[]): Promise<void> {
  if (reglaIds.length === 0) return;
  try {
    const sb = getServiceClient();
    if (!sb) return;
    // Count usages per rule
    const counts = new Map<string, number>();
    for (const id of reglaIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    // Fire a single update per rule (cheap, no contention)
    const now = new Date().toISOString();
    for (const [id, count] of counts) {
      const { data } = await sb
        .from("clasificacion_reglas")
        .select("veces_aplicada")
        .eq("id", id)
        .maybeSingle();
      if (!data) continue;
      await sb
        .from("clasificacion_reglas")
        .update({
          veces_aplicada: (data.veces_aplicada ?? 0) + count,
          last_used_at: now,
        })
        .eq("id", id);
    }
  } catch {
    /* non-blocking */
  }
}
