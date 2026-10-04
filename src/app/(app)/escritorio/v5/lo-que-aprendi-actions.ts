"use server";

/**
 * "Lo que aprendí" (popup de Empresa) — Fase 3 del clasificador. Lista las reglas que
 * la clienta le enseñó a massDTE corrigiendo tipos en Check, cuán seguras están y deja
 * deshacerlas. La contraparte se muestra desde la EVIDENCIA VIVA (glosas de las
 * cartolas que sostienen la regla), nunca desde el nombre de la regla (que ya no lleva
 * al tercero).
 */
import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { getDevSupportMode, getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { recordCuentaAudit } from "@/lib/audit/account";
import { deshacerRegla, leerEvidencia, recalcularEstadoReglas } from "@/lib/ai/reglas-historial";
import { contraparteVisible, mensajeDeshacer, ordenarAprendidas, type ReglaAprendida } from "./lo-que-aprendi-util";
import type { EstadoRegla } from "@/lib/ai/regla-evidencia";

async function contexto(opts: { escribe: boolean }) {
  if (opts.escribe) {
    const bloqueo = await getDevSupportWriteBlock();
    if (bloqueo) return bloqueo;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" } as const;
  const { data: usuario } = await supabase.from("usuarios").select("empresa_id, rol").eq("id", user.id).single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" } as const;
  if (opts.escribe && !ROLES_EMISION.has(String(usuario.rol))) return { error: "Tu rol no permite esta acción" } as const;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" } as const;
  return { empresaId: usuario.empresa_id as string, userId: user.id, sb: createServiceClient<Database>(url, key) } as const;
}

export async function listarLoQueAprendi(): Promise<{ reglas: ReglaAprendida[] } | { error: string }> {
  const ctx = await contexto({ escribe: false });
  if ("error" in ctx) return { error: ctx.error ?? "Error" };
  // Estado derivado al día (también lo hace el cron nocturno). Best-effort.
  try { await recalcularEstadoReglas(ctx.sb, ctx.empresaId, { soloEstado: true }); } catch { /* se muestra lo guardado */ }

  const filas: Array<{ id: string; estado: string; tipo_dte: number | null; created_at: string }> = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await ctx.sb
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
  const ev = (await leerEvidencia(ctx.sb, ctx.empresaId)) ?? new Map();
  const reglas: ReglaAprendida[] = filas.map((r) => {
    const e = ev.get(r.id);
    return {
      id: r.id,
      contraparte: contraparteVisible(e?.glosa ?? null),
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
  const ctx = await contexto({ escribe: true });
  if ("error" in ctx) return { error: ctx.error ?? "Error" };
  let soporte: boolean | null = null;
  try { soporte = (await getDevSupportMode())?.ok === true; } catch { soporte = null; }

  const res = await deshacerRegla(ctx.sb, { empresaId: ctx.empresaId, usuarioId: ctx.userId, reglaId, soporte });
  if (res.error && !res.ok) return { error: res.error };

  // Auditoría SIN el tercero: solo el tipo y los conteos.
  await recordCuentaAudit({
    sb: ctx.sb,
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
