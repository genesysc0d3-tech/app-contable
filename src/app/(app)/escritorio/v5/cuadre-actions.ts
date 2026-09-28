"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { validarAccesoCuenta } from "@/lib/entitlements";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { recordCuentaAudit } from "@/lib/audit/account";
import { carrilEsExento } from "@/lib/sii/tipo-por-carril";
import {
  leerCuadre, marcarAgregadas, movimientoRecuperado, planAgregar, propuestaRecuperada,
} from "@/lib/cartola/cuadre-mesa";

export type AgregarFaltantesResult =
  | { ok: true; agregadas: number; yaEstaban: boolean }
  | { ok: false; error: string };

/**
 * "Agregarlos" del visor de la cartola (paso 3 del cuadre): devuelve a la mesa
 * las filas con plata que el procesamiento dejó fuera, como PENDIENTES de
 * revisar. Idempotente: los ids se reservan en progreso_ia.cuadre.recuperacion
 * antes de insertar y un segundo click reusa esos mismos ids (upsert que ignora
 * el repetido). Mismo guard que el resto de las acciones de la mesa.
 */
export async function agregarFilasFaltantes(documentoId: string): Promise<AgregarFaltantesResult> {
  const supportBlock = await getDevSupportWriteBlock("cuadre_agregar_filas");
  if (supportBlock) return { ok: false, error: supportBlock.error };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autenticado" };

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("empresa_id, rol, vetado")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { ok: false, error: "Usuario sin empresa" };
  if (usuario.vetado) return { ok: false, error: "Tu usuario está bloqueado" };
  if (!ROLES_EMISION.has(String(usuario.rol))) return { ok: false, error: "Tu rol no permite esta acción" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "Backend mal configurado" };
  const sb = createServiceClient<Database>(url, key);
  const empresaId = usuario.empresa_id;

  const acceso = await validarAccesoCuenta(sb, user.id, empresaId);
  if (!acceso.ok) return { ok: false, error: "Tu cuenta no tiene acceso a esta empresa" };

  const { data: doc } = await sb
    .from("documentos_subidos")
    .select("id, estado, mesa, progreso_ia")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Documento no encontrado" };
  if (doc.estado !== "procesado") return { ok: false, error: "La cartola todavía se está procesando" };

  const progreso = (doc.progreso_ia ?? {}) as Record<string, unknown>;
  const cuadre = leerCuadre(progreso);
  if (!cuadre) return { ok: false, error: "Esta cartola no tiene cuadre" };

  const plan = planAgregar(cuadre, randomUUID);
  if (plan.length === 0) return { ok: true, agregadas: 0, yaEstaban: true };

  // Reserva (compare-and-set): solo un click gana. Si ya había una reserva de
  // un intento anterior, se reusa tal cual (planAgregar devolvió sus ids).
  if (!cuadre.recuperacion) {
    const reservado = { ...cuadre, recuperacion: { desde: new Date().toISOString(), filas: plan } };
    const { data: tomado, error: errReserva } = await sb
      .from("documentos_subidos")
      .update({ progreso_ia: { ...progreso, cuadre: reservado } as unknown as Json })
      .eq("id", documentoId)
      .eq("empresa_id", empresaId)
      .is("progreso_ia->cuadre->recuperacion", null)
      .select("id");
    if (errReserva) return { ok: false, error: "No se pudo reservar la operación — intenta de nuevo" };
    if (!tomado || tomado.length === 0) return { ok: false, error: "Ya se están agregando — actualiza en unos segundos" };
  }

  const { data: emp } = await sb
    .from("empresas")
    .select("tipo_contribuyente, boletas_tipo_default, facturas_tipo_default")
    .eq("id", empresaId)
    .maybeSingle();
  const mesa = doc.mesa === "factura" ? "factura" : "boleta";
  const exento = carrilEsExento(emp ?? null, mesa);

  const movs = plan.map((f) => movimientoRecuperado(cuadre.perdidas[f.idx], { id: f.movimiento_id, empresaId, documentoId }));
  const { error: errMov } = await sb.from("movimientos_raw").upsert(movs, { onConflict: "id", ignoreDuplicates: true });
  if (errMov) return { ok: false, error: "No se pudieron agregar los movimientos — intenta de nuevo" };

  const props = plan.map((f) => propuestaRecuperada(cuadre.perdidas[f.idx], {
    id: f.propuesta_id, movimientoId: f.movimiento_id, empresaId, mesa, exento,
  }));
  const { error: errProp } = await sb.from("propuestas_ia").upsert(props, { onConflict: "id", ignoreDuplicates: true });
  if (errProp) return { ok: false, error: "No se pudieron crear las propuestas — intenta de nuevo" };

  // La DB tiene que confirmar TODO antes de marcar el cuadre como resuelto.
  const { count: nMov } = await sb.from("movimientos_raw").select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId).in("id", plan.map((f) => f.movimiento_id));
  const { count: nProp } = await sb.from("propuestas_ia").select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId).in("id", plan.map((f) => f.propuesta_id));
  if (nMov !== plan.length || nProp !== plan.length) {
    return { ok: false, error: "No se confirmaron todas las filas — intenta de nuevo" };
  }

  const final = marcarAgregadas(cuadre, plan);
  const { error: errFinal } = await sb
    .from("documentos_subidos")
    .update({ progreso_ia: { ...progreso, cuadre: final } as unknown as Json })
    .eq("id", documentoId)
    .eq("empresa_id", empresaId);
  if (errFinal) return { ok: false, error: "Se agregaron, pero no se pudo actualizar el cuadre — intenta de nuevo" };

  await recordCuentaAudit({
    sb,
    empresaId,
    usuarioId: user.id,
    accion: "cuadre_filas_agregadas",
    recursoTipo: "documento",
    recursoId: documentoId,
    // Sin glosa (PII de terceros): solo cuántas y cuánto.
    resumen: `${plan.length} fila(s) de la cartola agregadas a la mesa desde el cuadre`,
    metadata: { filas: plan.length, monto: plan.reduce((s, f) => s + (Number(cuadre.perdidas[f.idx].monto) || 0), 0) },
  });

  revalidatePath("/massdte");
  revalidatePath("/escritorio");
  return { ok: true, agregadas: plan.length, yaEstaban: false };
}
