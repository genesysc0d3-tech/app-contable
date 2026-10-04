"use server";

/**
 * "Lo que aprendí" (popup de Empresa) — Fase 3 del clasificador. Lista las reglas que
 * la clienta le enseñó a massDTE corrigiendo tipos en Check, cuán seguras están y deja
 * deshacerlas. La contraparte se muestra desde la EVIDENCIA VIVA (glosas de las
 * cartolas que sostienen la regla), nunca desde el nombre de la regla (que ya no lleva
 * al tercero).
 */
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getEmpresaAndService } from "@/lib/auth/contexto-empresa";
import { recordCuentaAudit } from "@/lib/audit/account";
import { deshacerRegla, leerEvidencia, recalcularEstadoReglas } from "@/lib/ai/reglas-historial";
import { contraparteVisible, mensajeDeshacer, ordenarAprendidas, SIN_NOMBRE, type ReglaAprendida } from "./lo-que-aprendi-util";
import type { EstadoRegla } from "@/lib/ai/regla-evidencia";

// Mismo guard que Check (rol, vetado, empresa activa, bloqueo de escritura del modo
// soporte): src/lib/auth/contexto-empresa.ts.

export async function listarLoQueAprendi(): Promise<{ reglas: ReglaAprendida[] } | { error: string }> {
  // Lectura: si el modo soporte bloquea escrituras, se lista igual pero SIN escribir
  // (ni recalcular estados ni crear soportes).
  const ctx = await getEmpresaAndService({ soloLectura: true });
  if ("error" in ctx) return { error: ctx.error };
  const sb = ctx.sb as unknown as SupabaseClient<Database>;
  // UNA ejecución de la evidencia por apertura: la usan el recálculo y la lista.
  const ev = (await leerEvidencia(sb, ctx.empresaId)) ?? new Map();
  if (ctx.puedeEscribir) {
    // Estado derivado al día (también lo hace el cron nocturno). Best-effort.
    try { await recalcularEstadoReglas(sb, ctx.empresaId, { soloEstado: true, evidencia: ev }); } catch { /* se muestra lo guardado */ }
  }

  const filas: Array<{ id: string; estado: string; tipo_dte: number | null; created_at: string }> = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb
      .from("clasificacion_reglas")
      .select("id, estado, tipo_dte, created_at")
      .eq("empresa_id", ctx.empresaId)
      .eq("activa", true)
      .in("estado", ["a_prueba", "firme", "en_disputa"])
      .order("created_at", { ascending: false })
      .range(desde, desde + 999);
    if (error) return { error: "No pudimos leer lo aprendido. Intenta de nuevo." };
    filas.push(...((data ?? []) as typeof filas));
    if (!data || data.length < 1000) break;
  }
  const reglas: ReglaAprendida[] = filas.map((r) => {
    const e = ev.get(r.id);
    return {
      id: r.id,
      // Sin glosa viva → null ("de una cartola borrada"); con glosa sin nombre legible,
      // un rótulo (nunca la glosa cruda).
      contraparte: e?.glosa ? (contraparteVisible(e.glosa) ?? SIN_NOMBRE) : null,
      tipo: r.tipo_dte === 41 ? "Exenta" : r.tipo_dte === 39 ? "Afecta" : null,
      aciertos: e?.aciertos ?? 0,
      estado: r.estado as EstadoRegla,
    };
  });
  return { reglas: ordenarAprendidas(reglas) };
}

export async function deshacerReglaAprendida(reglaId: string): Promise<{ ok: true; mensaje: string } | { error: string }> {
  if (typeof reglaId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reglaId)) {
    return { error: "Regla inválida" };
  }
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };
  const sb = ctx.sb as unknown as SupabaseClient<Database>;

  const res = await deshacerRegla(sb, { empresaId: ctx.empresaId, usuarioId: ctx.userId, reglaId, soporte: ctx.soporte });
  if (res.error && !res.ok) return { error: res.error };

  // Auditoría SIN el tercero: solo el tipo y los conteos.
  await recordCuentaAudit({
    sb,
    empresaId: ctx.empresaId,
    usuarioId: ctx.userId,
    accion: "regla_deshecha",
    recursoTipo: "clasificacion_regla",
    recursoId: reglaId,
    resumen: `Deshizo una regla aprendida (${res.tipoDte === 39 ? "Afecta" : res.tipoDte === 41 ? "Exenta" : "sin tipo"}): ${res.reevaluadas} movimiento(s) re-evaluados, ${res.enEmitir} ya en Emitir sin tocar.`,
    metadata: { reevaluadas: res.reevaluadas, sin_regla: res.sinRegla, en_emitir: res.enEmitir, intocables: res.intocables, tipo_dte: res.tipoDte },
  });

  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, mensaje: mensajeDeshacer(res) };
}
