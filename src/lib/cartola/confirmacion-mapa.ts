import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/database.types";
import { adapterDelDocumento, confirmarAdapter } from "@/lib/parsers/adapter-store";
import { leerCuadre } from "./cuadre-mesa";
import { checkConfirmaMapa } from "./verificacion";

/**
 * JUEZ IMPLÍCITO DEL CHECK (punto 7c, 2026-09-30). La cadena
 * parser_logs(documento → adapter) → movimientos_raw → propuestas_ia ya existe:
 * si el cliente decidió en Check TODO lo de una cartola y lo guardado sigue
 * exacto a como el lector lo dejó (nadie editó un monto ni una dirección), el
 * mapa provisorio con que se leyó pasa a confirmado ("check"). Solo el mapa
 * PROPIO de la empresa (adapterDelDocumento): un global no se toca.
 *
 * Best-effort: nunca rompe la aprobación (el caller ignora los errores).
 */
export async function confirmarMapaPorCheck(
  // Cliente service-role del caller (sin tipos de DB en revisar/actions.ts).
  sb: SupabaseClient,
  empresaId: string,
  documentoId: string,
): Promise<boolean> {
  const { data: doc } = await sb
    .from("documentos_subidos")
    .select("progreso_ia")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const progreso = ((doc as { progreso_ia?: unknown } | null)?.progreso_ia ?? {}) as Record<string, unknown>;
  const cuadre = leerCuadre(progreso);
  if (!cuadre?.guardado || cuadre.mapa?.estado === "confirmado") return false;

  const { data: movs } = await sb
    .from("movimientos_raw")
    .select("monto, tipo_flujo")
    .eq("empresa_id", empresaId)
    .eq("documento_id", documentoId);
  const { data: props } = await sb
    .from("propuestas_ia")
    .select("estado, movimientos_raw!inner(documento_id)")
    .eq("empresa_id", empresaId)
    .eq("movimientos_raw.documento_id", documentoId);
  const ok = checkConfirmaMapa({
    guardado: cuadre.guardado,
    movimientos: (movs ?? []) as { monto: number; tipo_flujo: string }[],
    estados: ((props ?? []) as { estado: string }[]).map((p) => p.estado),
  });
  if (!ok) return false;

  const adapter = await adapterDelDocumento(sb as never, documentoId, empresaId);
  if (!adapter || adapter.estado === "confirmado") return false;
  const confirmado = await confirmarAdapter(adapter.id, "check");
  if (!confirmado) return false; // columna sin migrar: queda provisorio (fail-safe)

  // Releer justo antes de escribir para no pisar otros campos de progreso_ia.
  const { data: fresco } = await sb
    .from("documentos_subidos")
    .select("progreso_ia")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const p = ((fresco as { progreso_ia?: unknown } | null)?.progreso_ia ?? progreso) as Record<string, unknown>;
  const c = leerCuadre(p) ?? cuadre;
  await sb
    .from("documentos_subidos")
    .update({ progreso_ia: { ...p, cuadre: { ...c, mapa: { ...(c.mapa ?? { adapter_id: adapter.id, nuevo: false }), estado: "confirmado", confirmado_por: "check" } } } as unknown as Json })
    .eq("id", documentoId)
    .eq("empresa_id", empresaId);
  return true;
}
