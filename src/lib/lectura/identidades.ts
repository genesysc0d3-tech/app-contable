import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Nombres, RUT y alias con que aparece el contribuyente en sus comprobantes.
 * Es lo que decide la DIRECCIÓN del movimiento en la lectura determinística
 * (./comprobante.ts): si la empresa está en el bloque destino, la plata le llegó.
 */
export async function cargarIdentidadesEmpresa(
  svc: SupabaseClient<Database>,
  empresaId: string,
): Promise<string[]> {
  const { data: emp } = await svc
    .from("empresas")
    .select("razon_social, rut")
    .eq("id", empresaId)
    .maybeSingle();
  const { data: identidades } = await svc
    .from("empresa_identidades")
    .select("valor")
    .eq("empresa_id", empresaId);
  return [emp?.razon_social, emp?.rut, ...(identidades ?? []).map((i) => i.valor)]
    .filter((v): v is string => Boolean(v));
}

