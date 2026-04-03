"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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

export async function aprobarTodas(propuestaIds: string[]) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("propuestas_ia")
    .update({ estado: "aprobado" })
    .in("id", propuestaIds);

  if (error) return { error: error.message };
  revalidatePath("/revisar");
  return { ok: true, count: propuestaIds.length };
}
