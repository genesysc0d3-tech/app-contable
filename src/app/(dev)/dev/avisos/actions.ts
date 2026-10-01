"use server";

/**
 * /dev → Avisos: crear, editar y desactivar los avisos que ven las clientas.
 * Mismo guard que la pausa de emisión (getDevOperatorContext: email operador +
 * dev_mode + aal2) ANTES de tocar nada con service role; allowlist campo a campo
 * (validarAvisoInput, jamás spread del payload) y cada escritura en ops_events.
 */
import { revalidatePath } from "next/cache";
import { getDevOperatorContext } from "@/lib/dev/support-mode";
import { recordOpsEvent } from "@/lib/ops/events";
import { esUuid, validarAvisoInput, type AvisoInput } from "@/lib/avisos/reglas";

const NO_OPERADOR = { error: "Solo operador Genesys" } as const;

const COLUMNAS_AUDITORIA = "tipo, formato, titulo, cuerpo, desde, hasta, empresa_ids, mesa, version_min, activo";

/**
 * id null = crear; id = editar ese aviso. Un popup urgente para TODAS las empresas
 * exige `confirmadoParaTodas` (la pantalla lo pide con un confirm explícito).
 */
export async function guardarAviso(
  id: string | null,
  input: AvisoInput,
  opciones: { confirmadoParaTodas?: boolean } = {},
): Promise<{ ok: true; id: string } | { error: string }> {
  const operador = await getDevOperatorContext();
  if (!operador.ok) return NO_OPERADOR;
  if (id !== null && !esUuid(id)) return { error: "Aviso inválido" };
  const v = validarAvisoInput(input);
  if (!v.ok) return { error: v.error };
  if (v.fila.formato === "popup" && v.fila.empresa_ids === null && opciones.confirmadoParaTodas !== true) {
    return { error: "Un popup urgente para TODAS las empresas necesita tu confirmación explícita" };
  }

  let avisoId: string;
  let antes: unknown = null;
  if (id === null) {
    const { data, error } = await operador.sb
      .from("avisos_app")
      .insert({ ...v.fila, activo: true, creado_por: operador.email })
      .select("id")
      .single();
    if (error || !data) return { error: error?.message ?? "No se pudo crear el aviso" };
    avisoId = data.id;
  } else {
    // Auditoría con antes/después (B8).
    const previo = await operador.sb.from("avisos_app").select(COLUMNAS_AUDITORIA).eq("id", id).maybeSingle();
    antes = previo.data ?? null;
    const { error } = await operador.sb
      .from("avisos_app")
      .update({ ...v.fila, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    avisoId = id;
  }

  await recordOpsEvent({
    sb: operador.sb,
    severity: v.fila.tipo === "urgente" ? "warn" : "info",
    source: "dev-support",
    eventName: id === null ? "aviso_creado" : "aviso_editado",
    summary: `Operador ${id === null ? "creó" : "editó"} un aviso (${v.fila.tipo}/${v.fila.formato}): ${v.fila.titulo}`,
    resourceType: "aviso_app",
    resourceId: avisoId,
    metadata: {
      operador: operador.email,
      tipo: v.fila.tipo,
      formato: v.fila.formato,
      desde: v.fila.desde,
      hasta: v.fila.hasta,
      empresas: v.fila.empresa_ids?.length ?? "todas",
      mesa: v.fila.mesa ?? "todas",
      version_min: v.fila.version_min,
      ...(id === null ? {} : { antes, despues: v.fila }),
    },
  }).catch(() => {});

  revalidatePath("/dev/avisos");
  return { ok: true, id: avisoId };
}

/** Apaga el aviso (deja de mostrarse al tiro, salvo caché de ≤ 1 min). No se borra: queda el historial. */
export async function desactivarAviso(id: string): Promise<{ ok: true } | { error: string }> {
  const operador = await getDevOperatorContext();
  if (!operador.ok) return NO_OPERADOR;
  if (!esUuid(id)) return { error: "Aviso inválido" };

  const { error } = await operador.sb
    .from("avisos_app")
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  await recordOpsEvent({
    sb: operador.sb,
    severity: "info",
    source: "dev-support",
    eventName: "aviso_desactivado",
    summary: "Operador desactivó un aviso",
    resourceType: "aviso_app",
    resourceId: id,
    metadata: { operador: operador.email },
  }).catch(() => {});

  revalidatePath("/dev/avisos");
  return { ok: true };
}
