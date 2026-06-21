"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { validarRut } from "@/lib/rut";

export async function crearCliente(formData: {
  empresa_id: string;
  nombre: string;
  rut?: string;
  email?: string;
  telefono?: string;
  notas?: string;
  tipo_contribuyente?: string;
}) {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return supportBlock;

  if (!formData.nombre.trim()) {
    return { error: "El nombre es obligatorio" };
  }

  if (formData.rut && formData.rut.trim() && !validarRut(formData.rut)) {
    return { error: "RUT inválido" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      empresa_id: formData.empresa_id,
      nombre: formData.nombre.trim(),
      rut: formData.rut?.trim() || null,
      email: formData.email?.trim() || null,
      telefono: formData.telefono?.trim() || null,
      notas: formData.notas?.trim() || null,
      tipo_contribuyente: formData.tipo_contribuyente ?? "afecto",
    })
    .select()
    .single();

  if (error) return { error: error.message };
  revalidatePath("/clientes");
  return { ok: true, cliente: data };
}

export async function editarCliente(
  clienteId: string,
  campos: {
    nombre?: string;
    rut?: string | null;
    email?: string | null;
    telefono?: string | null;
    notas?: string | null;
    tipo_contribuyente?: string;
  }
) {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return supportBlock;

  if (campos.rut && campos.rut.trim() && !validarRut(campos.rut)) {
    return { error: "RUT inválido" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("clientes")
    .update({
      ...campos,
      nombre: campos.nombre?.trim(),
      rut: campos.rut?.trim() || null,
      email: campos.email?.trim() || null,
      telefono: campos.telefono?.trim() || null,
      notas: campos.notas?.trim() || null,
    })
    .eq("id", clienteId);

  if (error) return { error: error.message };
  revalidatePath("/clientes");
  return { ok: true };
}

export async function eliminarCliente(clienteId: string) {
  const supportBlock = await getDevSupportWriteBlock();
  if (supportBlock) return supportBlock;

  const supabase = await createClient();
  const { error } = await supabase
    .from("clientes")
    .delete()
    .eq("id", clienteId);

  if (error) return { error: error.message };
  revalidatePath("/clientes");
  return { ok: true };
}
