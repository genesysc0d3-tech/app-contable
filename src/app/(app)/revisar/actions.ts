"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

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
  return { empresaId: usuario.empresa_id, sb } as const;
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
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  return { ok: true };
}

export async function crearClienteDesdeRevisar(formData: {
  empresa_id: string;
  nombre: string;
  rut?: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      empresa_id: formData.empresa_id,
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
  return { ok: true };
}

export async function editarPropuesta(
  propuestaId: string,
  campos: {
    tipo_propuesto?: string;
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
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ ...campos, estado: "editado" }, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId);
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo editar" };
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
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

  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  return { ok: true, count: aprobadas };
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
  revalidatePath("/subir");
  return { ok: true };
}
