"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { validarAccesoCuenta } from "@/lib/entitlements";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { recordCuentaAudit } from "@/lib/audit/account";
import { leerCuadre } from "@/lib/cartola/cuadre-mesa";
import { filtradaPermitida, mensajeSaldoNoCuadra, saldoInicialParaConfirmar, seVeBienPermitido, sellarPorCliente, verificarSaldoCliente } from "@/lib/cartola/verificacion";
import { adapterDelDocumento, confirmarAdapter } from "@/lib/parsers/adapter-store";

export type ConfirmarLecturaInput =
  | { accion: "se_ve_bien" }
  | { accion: "filtrada" }
  | { accion: "saldo"; saldoFinal: number; saldoInicial?: number | null };

export type ConfirmarLecturaResult =
  | { ok: true; mensaje: string }
  | { ok: false; error: string; necesitaSaldoInicial?: boolean };

const pesos = (n: number) => `$${Math.round(n).toLocaleString("es-CL")}`;

/**
 * "Así la leímos" (lector con juez, punto 8, 2026-09-30). El cliente confirma la
 * lectura de una cartola que quedó sin_comprobar: mirando la muestra ("Se ve
 * bien") o tecleando el saldo final que ve en su portal del banco. Con eso la
 * cartola queda sellada `cliente` y el mapa de columnas PROPIO de la empresa
 * pasa a confirmado. El saldo inicial sale de la cartola, de la cartola
 * anterior de la MISMA cuenta (encadenadas) o, si no hay, lo pone el cliente.
 */
export async function confirmarLecturaCartola(documentoId: string, input: ConfirmarLecturaInput): Promise<ConfirmarLecturaResult> {
  const supportBlock = await getDevSupportWriteBlock("confirmar_lectura_cartola");
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
    .select("id, estado, created_at, progreso_ia")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Documento no encontrado" };
  if (doc.estado !== "procesado") return { ok: false, error: "La cartola todavía se está procesando" };
  const cuadre = leerCuadre(doc.progreso_ia);
  if (!cuadre) return { ok: false, error: "Esta cartola no tiene cuadre" };

  let detalle: string;
  let mensaje: string;
  if (input.accion === "se_ve_bien") {
    // Con alerta, filas perdidas u otra hoja sin leer, 3 filas de muestra no
    // prueban nada (adversarial-2 A2): el server lo rechaza aunque la UI falle.
    const permitido = seVeBienPermitido(cuadre);
    if (!permitido.ok) return { ok: false, error: permitido.motivo ?? "Esta lectura no se puede confirmar solo mirando la muestra" };
    detalle = "Revisaste la muestra y dijiste que se ve bien";
    mensaje = "Listo, quedó confirmada";
  } else if (input.accion === "filtrada") {
    // Salida EXPLÍCITA para el export filtrado (vuelta 2, N4): el saldo no puede
    // cuadrar porque faltan los movimientos del otro signo; lo dice el cliente.
    if (!filtradaPermitida(cuadre)) return { ok: false, error: "Esta cartola no parece filtrada: corrige las columnas o comprueba con el saldo final" };
    const que = cuadre.verificacion?.filtrada === "cargos" ? "solo cargos" : "solo abonos";
    detalle = `Confirmaste que tu cartola viene filtrada (${que}): el saldo no puede cuadrar porque faltan los otros movimientos`;
    mensaje = "Listo, quedó confirmada como cartola filtrada";
  } else {
    const saldoFinal = Number(input.saldoFinal);
    if (!Number.isFinite(saldoFinal)) return { ok: false, error: "Escribe el saldo final como número" };
    // Cartolas anteriores de la empresa (para encadenar por cuenta).
    const { data: previas } = await sb
      .from("documentos_subidos")
      .select("progreso_ia, created_at")
      .eq("empresa_id", empresaId)
      .eq("estado", "procesado")
      .neq("id", documentoId)
      .lt("created_at", doc.created_at)
      .order("created_at", { ascending: false })
      .limit(30);
    const anteriores = (previas ?? []).map((p) => leerCuadre(p.progreso_ia)).filter((c): c is NonNullable<typeof c> => !!c);
    const inicial = saldoInicialParaConfirmar(cuadre, anteriores);
    const saldoInicial = inicial.valor ?? (input.saldoInicial != null && Number.isFinite(Number(input.saldoInicial)) ? Number(input.saldoInicial) : null);
    if (saldoInicial == null) {
      return { ok: false, necesitaSaldoInicial: true, error: "Para comprobarlo necesitamos también el saldo con que partió el período" };
    }
    const r = verificarSaldoCliente({ saldoFinalCliente: saldoFinal, saldoInicial, abonos: cuadre.abonos, cargos: cuadre.cargos });
    // Sin revelar el esperado (adversarial-2 A3): el cliente lo copiaría.
    if (!r.ok) return { ok: false, error: mensajeSaldoNoCuadra() };
    const empalme = inicial.empalma === true ? " y empalma con tu cartola anterior" : "";
    detalle = `Tu saldo final del banco (${pesos(saldoFinal)}) cuadra con lo leído${empalme}`;
    mensaje = "¡Cuadra! Quedó confirmada";
  }

  // Releer justo antes de escribir: no pisar otros campos de progreso_ia.
  const { data: fresco } = await sb
    .from("documentos_subidos")
    .select("progreso_ia")
    .eq("id", documentoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const progreso = ((fresco?.progreso_ia ?? doc.progreso_ia) ?? {}) as Record<string, unknown>;
  const final = sellarPorCliente(leerCuadre(progreso) ?? cuadre, detalle);
  const { error } = await sb
    .from("documentos_subidos")
    .update({ progreso_ia: { ...progreso, cuadre: final } as unknown as Json })
    .eq("id", documentoId)
    .eq("empresa_id", empresaId);
  if (error) return { ok: false, error: "No se pudo guardar — intenta de nuevo" };

  // El mapa PROPIO de la empresa con que se leyó pasa a confirmado (un global o
  // ajeno no lo confirma un cliente). Best-effort.
  try {
    const adapter = await adapterDelDocumento(sb, documentoId, empresaId);
    // Confirma SOLO el mapa propio: "cliente" nunca cuenta para volverlo global (vuelta 2, N1).
    if (adapter && adapter.estado === "provisorio") await confirmarAdapter(adapter.id, "cliente");
  } catch { /* el aprendizaje nunca rompe la confirmación */ }

  await recordCuentaAudit({
    sb,
    empresaId,
    usuarioId: user.id,
    accion: "cartola_lectura_confirmada",
    recursoTipo: "documento_subido",
    recursoId: documentoId,
    // Sin glosas ni montos de terceros: solo cómo se confirmó.
    resumen: input.accion === "se_ve_bien" ? "Lectura de cartola confirmada mirando la muestra"
      : input.accion === "filtrada" ? "Lectura de cartola confirmada como cartola filtrada (una sola dirección)"
      : "Lectura de cartola confirmada con el saldo final del banco",
    metadata: { accion: input.accion },
  });

  revalidatePath("/massdte");
  revalidatePath("/escritorio");
  return { ok: true, mensaje };
}
