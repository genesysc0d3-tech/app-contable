"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

const BATCH_SIZE = 50;

export async function aprobarPropuesta(
  propuestaId: string,
  clienteId?: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("propuestas_ia")
    .update({ estado: "aprobado", cliente_id: clienteId ?? null })
    .eq("id", propuestaId);

  if (error) return { error: error.message };
  revalidatePath("/revisar");
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("propuestas_ia")
    .update({ estado: "descartado" })
    .eq("id", propuestaId);

  if (error) return { error: error.message };
  revalidatePath("/revisar");
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
  const supabase = await createClient();
  const { error } = await supabase
    .from("propuestas_ia")
    .update({ ...campos, estado: "editado" })
    .eq("id", propuestaId);

  if (error) return { error: error.message };
  revalidatePath("/revisar");
  return { ok: true };
}

export async function aprobarTodas(
  propuestaIds: string[]
): Promise<{ ok?: boolean; error?: string; count: number }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };

  const supabase = await createClient();
  let aprobadas = 0;

  // Batch in chunks of BATCH_SIZE to avoid PostgREST URL length limit
  // (.in() puts all IDs in the query string — 659 UUIDs = 24KB, exceeds limit)
  for (let i = 0; i < propuestaIds.length; i += BATCH_SIZE) {
    const batch = propuestaIds.slice(i, i + BATCH_SIZE);
    const { error, data } = await supabase
      .from("propuestas_ia")
      .update({ estado: "aprobado" })
      .in("id", batch)
      .select("id");

    if (error) {
      return {
        error: `Error en batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`,
        count: aprobadas,
      };
    }
    aprobadas += data?.length ?? 0;
  }

  revalidatePath("/revisar");
  return { ok: true, count: aprobadas };
}
