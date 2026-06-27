"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { recordCuentaAudit } from "@/lib/audit/account";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";

const BATCH_SIZE = 50;

/**
 * Fetches the current user's empresa_id (with auth) and returns a service-role
 * Supabase client. Service role bypasses RLS — every UPDATE must be scoped
 * with .eq("empresa_id", empresaId) for security.
 *
 * Why service role: RLS policies on propuestas_ia were silently dropping
 * UPDATE operations (returning success but 0 rows changed) in some cases,
 * causing the optimistic UI to "approve" things that never persisted.
 */
async function getEmpresaAndService() {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return supportBlock;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" } as const;

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" } as const;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { error: "Backend mal configurado" } as const;

  const sb = createServiceClient(url, key);
  return { empresaId: usuario.empresa_id, userId: user.id, sb } as const;
}

export async function aprobarPropuesta(
  propuestaId: string,
  clienteId?: string | null
) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };

  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "aprobado", cliente_id: clienteId ?? null }, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId);

  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo actualizar — propuesta no encontrada o sin permisos" };
  await recordCuentaAudit({
    sb: ctx.sb,
    empresaId: ctx.empresaId,
    usuarioId: ctx.userId,
    accion: "propuesta_aprobada",
    recursoTipo: "propuesta_ia",
    recursoId: propuestaId,
    resumen: "Propuesta aprobada",
  });
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}

export async function crearClienteDesdeRevisar(formData: {
  /** Ignorado: la empresa se deriva de la sesión (nunca confiar en el payload). */
  empresa_id?: string;
  nombre: string;
  rut?: string;
}) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      empresa_id: ctx.empresaId,
      nombre: formData.nombre.trim(),
      rut: formData.rut?.trim() || null,
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { ok: true, cliente: data };
}

export async function descartarPropuesta(propuestaId: string) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "descartado" }, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId);
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo descartar" };
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}

/**
 * Ocultar una propuesta de la vista principal de /revisar sin destruirla.
 * Se puede restaurar después con restaurarPropuesta(). Reemplaza al
 * descartar como acción "negativa" no destructiva.
 */
export async function ocultarPropuesta(propuestaId: string) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "oculto" }, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId);
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo ocultar" };
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}

export async function restaurarPropuesta(propuestaId: string) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "pendiente" }, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId);
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo restaurar" };
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}

export async function rechazarPropuesta(propuestaId: string) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "rechazado" }, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId);
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo rechazar" };
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}

export async function editarPropuesta(
  propuestaId: string,
  campos: {
    tipo_propuesto?: string;
    tipo_dte?: number | null;
    receptor_nombre?: string | null;
    receptor_rut?: string | null;
    monto_neto?: number;
    iva?: number;
    total?: number;
    notas?: string | null;
    moneda_origen?: string | null;
    monto_moneda_origen?: number | null;
  }
) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };

  // Allowlist explícita: las server actions son endpoints públicos y el tipo
  // TS no limita el payload en runtime. Con service role, un spread directo
  // permitiría setear cualquier columna (empresa_id, estado, confianza...).
  const update: Record<string, string | number | null> = { estado: "editado" };
  const strField = (v: unknown): string | null => (v === null ? null : String(v));
  const numField = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  if (campos.tipo_propuesto !== undefined) update.tipo_propuesto = String(campos.tipo_propuesto);
  if (campos.tipo_dte !== undefined) update.tipo_dte = campos.tipo_dte === null ? null : numField(campos.tipo_dte);
  if (campos.receptor_nombre !== undefined) update.receptor_nombre = strField(campos.receptor_nombre);
  if (campos.receptor_rut !== undefined) update.receptor_rut = strField(campos.receptor_rut);
  if (campos.notas !== undefined) update.notas = strField(campos.notas);
  if (campos.moneda_origen !== undefined) update.moneda_origen = strField(campos.moneda_origen);
  if (campos.monto_neto !== undefined) {
    const n = numField(campos.monto_neto);
    if (n === null) return { error: "Monto neto inválido" };
    update.monto_neto = n;
  }
  if (campos.iva !== undefined) {
    const n = numField(campos.iva);
    if (n === null) return { error: "IVA inválido" };
    update.iva = n;
  }
  if (campos.total !== undefined) {
    const n = numField(campos.total);
    if (n === null) return { error: "Total inválido" };
    update.total = n;
  }
  if (campos.monto_moneda_origen !== undefined) {
    update.monto_moneda_origen = campos.monto_moneda_origen === null ? null : numField(campos.monto_moneda_origen);
  }

  const doUpdate = () => ctx.sb
    .from("propuestas_ia")
    .update(update, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId);
  let { error, count } = await doUpdate();
  if (error && "tipo_dte" in update) {
    // La columna tipo_dte puede no estar migrada aún (Paso P) — reintentar sin ella.
    delete update.tipo_dte;
    ({ error, count } = await doUpdate());
  }
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo editar" };
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}

export async function aprobarTodas(
  propuestaIds: string[]
): Promise<{ ok?: boolean; error?: string; count: number }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };

  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };

  let aprobadas = 0;

  // Batch in chunks of BATCH_SIZE to avoid PostgREST URL length limit
  // (.in() puts all IDs in the query string — 659 UUIDs = 24KB, exceeds limit)
  for (let i = 0; i < propuestaIds.length; i += BATCH_SIZE) {
    const batch = propuestaIds.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "aprobado" }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch);

    if (error) {
      return {
        error: `Error en batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`,
        count: aprobadas,
      };
    }
    aprobadas += count ?? 0;
  }

  // If we tried to approve N but updated 0, surface as error so the optimistic
  // UI can roll back instead of silently lying to the user.
  if (aprobadas === 0 && propuestaIds.length > 0) {
    return {
      error: "No se actualizó ninguna propuesta — verificá permisos o que las propuestas existan",
      count: 0,
    };
  }

  await recordCuentaAudit({
    sb: ctx.sb,
    empresaId: ctx.empresaId,
    usuarioId: ctx.userId,
    accion: "propuestas_aprobadas",
    recursoTipo: "propuesta_ia",
    recursoId: null,
    resumen: `${aprobadas} propuestas aprobadas`,
    metadata: { cantidad: aprobadas },
  });

  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: aprobadas };
}

export async function editarMovimientoPropuesta(
  propuestaId: string,
  movimientoId: string,
  campos: {
    descripcion?: string;
    monto?: number;
    tipo_propuesto?: string;
    receptor_nombre?: string | null;
    receptor_rut?: string | null;
    notas?: string | null;
  }
) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };

  const sb = ctx.sb;

  if (campos.descripcion !== undefined || campos.monto !== undefined) {
    const movUpdate: Record<string, string | number> = {};
    if (campos.descripcion !== undefined) movUpdate.descripcion = campos.descripcion.trim();
    if (campos.monto !== undefined) movUpdate.monto = campos.monto;
    const { error: movErr } = await sb
      .from("movimientos_raw")
      .update(movUpdate)
      .eq("empresa_id", ctx.empresaId)
      .eq("id", movimientoId);
    if (movErr) return { error: movErr.message };
  }

  const propUpdate: Record<string, string | number | null> = {};
  if (campos.tipo_propuesto !== undefined) propUpdate.tipo_propuesto = campos.tipo_propuesto;
  if (campos.receptor_nombre !== undefined) propUpdate.receptor_nombre = campos.receptor_nombre;
  if (campos.receptor_rut !== undefined) propUpdate.receptor_rut = campos.receptor_rut;
  if (campos.notas !== undefined) propUpdate.notas = campos.notas;

  if (Object.keys(propUpdate).length > 0) {
    const { error: propErr, count } = await sb
      .from("propuestas_ia")
      .update(propUpdate, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .eq("id", propuestaId);

    if (propErr) return { error: propErr.message };
    if (!count) return { error: "No se pudo editar la propuesta" };
  }

  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  return { ok: true };
}

export async function devolverAOmitidos(propuestaId: string) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };

  // Get the propuesta + movimiento to delete (scoped to empresa)
  const { data: prop } = await ctx.sb
    .from("propuestas_ia")
    .select("id, movimiento_id")
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId)
    .single();

  if (!prop) return { error: "Propuesta no encontrada" };

  const { error: propErr } = await ctx.sb
    .from("propuestas_ia")
    .delete()
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId);

  if (propErr) return { error: propErr.message };

  await ctx.sb
    .from("movimientos_raw")
    .delete()
    .eq("empresa_id", ctx.empresaId)
    .eq("id", prop.movimiento_id);

  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  revalidatePath("/subir");
  return { ok: true };
}
