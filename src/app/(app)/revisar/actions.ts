"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function aprobarPropuesta(propuestaId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("propuestas_ia")
    .update({ estado: "aprobado" })
    .eq("id", propuestaId);

  if (error) return { error: error.message };
  revalidatePath("/revisar");
  return { ok: true };
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
