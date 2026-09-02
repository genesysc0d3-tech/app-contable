"use server";

import { createClient } from "@/lib/supabase/server";
import { ROLES_EMISION } from "@/lib/auth/roles";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { recordCuentaAudit } from "@/lib/audit/account";
import { getDevSupportWriteBlock } from "@/lib/dev/support-mode";
import { aprenderReglaDesdeResolucion, type AprenderResultado } from "@/lib/ai/aprender-regla";

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
    .select("empresa_id, rol")
    .eq("id", user.id)
    .single();
  if (!usuario?.empresa_id) return { error: "Usuario sin empresa" } as const;

  // TODAS las acciones de este archivo MUTAN (aprobar/editar/rechazar/poner listo/
  // crear cliente). Aprobar/editar propuestas es un acto tributario: 'viewer' queda
  // fuera, igual que en las rutas de emisión (ROLES_EMISION). Gate único acá.
  if (!ROLES_EMISION.has(String(usuario.rol))) {
    return { error: "Tu rol no permite esta acción" } as const;
  }

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

/**
 * Juicio "sin boleta" en LOTE (espejo de ponerListo): típicamente las salidas de
 * una cartola — objetivamente egresos, no llevan boleta. Guard: solo desde
 * pendiente/editado (jamás degrada una 'listo' staged ni toca 'aprobado').
 */
export async function rechazarPropuestas(
  propuestaIds: string[]
): Promise<{ ok?: boolean; error?: string; count: number }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  let marcadas = 0;
  for (let i = 0; i < propuestaIds.length; i += BATCH_SIZE) {
    const batch = propuestaIds.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "rechazado" }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      .in("estado", ["pendiente", "editado"]);
    if (error) return { error: `Error en batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`, count: marcadas };
    marcadas += count ?? 0;
  }
  if (marcadas === 0 && propuestaIds.length > 0) return { error: "No se marcó ninguna (¿ya estaban juzgadas?)", count: 0 };
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: marcadas };
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
    receptor_direccion?: string | null;
    receptor_comuna?: string | null;
    receptor_email?: string | null;
    receptor_telefono?: string | null;
    receptor_giro?: string | null;
    medio_pago?: string | null;
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
  if (campos.receptor_direccion !== undefined) update.receptor_direccion = strField(campos.receptor_direccion);
  if (campos.receptor_comuna !== undefined) update.receptor_comuna = strField(campos.receptor_comuna);
  if (campos.receptor_email !== undefined) update.receptor_email = strField(campos.receptor_email);
  if (campos.receptor_telefono !== undefined) update.receptor_telefono = strField(campos.receptor_telefono);
  if (campos.receptor_giro !== undefined) update.receptor_giro = strField(campos.receptor_giro);
  if (campos.medio_pago !== undefined) update.medio_pago = strField(campos.medio_pago);
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

  // Snapshot previo para aprender-al-clasificar: si esta edición fija tipo_dte
  // (39/41) sobre una propuesta que aún NO tenía decisión humana, guardamos la
  // glosa/flujo/cartola para enseñar la regla después del update. Se lee ANTES
  // porque el update sobreescribe el tipo_dte previo.
  let previo:
    | { descripcion: string; tipo_flujo: "entrada" | "salida"; documento_id: string | null }
    | null = null;
  if (campos.tipo_dte === 39 || campos.tipo_dte === 41) {
    const { data: p } = await ctx.sb
      .from("propuestas_ia")
      .select("tipo_dte, movimiento_id")
      .eq("empresa_id", ctx.empresaId)
      .eq("id", propuestaId)
      .maybeSingle();
    if (p && p.tipo_dte == null && p.movimiento_id) {
      const { data: m } = await ctx.sb
        .from("movimientos_raw")
        .select("descripcion, tipo_flujo, documento_id")
        .eq("id", p.movimiento_id)
        .maybeSingle();
      if (m && (m.tipo_flujo === "entrada" || m.tipo_flujo === "salida")) {
        previo = {
          descripcion: m.descripcion ?? "",
          tipo_flujo: m.tipo_flujo,
          documento_id: m.documento_id,
        };
      }
    }
  }

  const doUpdate = () => ctx.sb
    .from("propuestas_ia")
    .update(update, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId)
    // Guard de estado (auditoría #21): NO editar una 'aprobado' (ya comprometida a
    // Emitir) — editarla la degradaría a 'editado' y burlaría el guard de ponerListo.
    // Ni resucitar 'rechazado'/emitidas. Coherente con el allowlist de ponerListo.
    .in("estado", ["pendiente", "editado", "listo"]);
  let { error, count } = await doUpdate();
  if (error && "tipo_dte" in update) {
    // La columna tipo_dte puede no estar migrada aún (Paso P) — reintentar sin ella.
    delete update.tipo_dte;
    ({ error, count } = await doUpdate());
  }
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo editar — el estado de la propuesta no lo permite" };

  // Aprender-al-clasificar: solo si tipo_dte REALMENTE se persistió (no lo botó
  // el fallback de arriba) y era la primera decisión humana (previo != null).
  // Best-effort: aprenderReglaDesdeResolucion nunca lanza; un fallo acá no rompe
  // la edición ya guardada.
  const tipoDtePersistida = "tipo_dte" in update && (update.tipo_dte === 39 || update.tipo_dte === 41);
  let aprendizaje: AprenderResultado | null = null;
  if (previo && tipoDtePersistida) {
    aprendizaje = await aprenderReglaDesdeResolucion(ctx.sb, {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      documentoId: previo.documento_id,
      descripcion: previo.descripcion,
      tipoFlujo: previo.tipo_flujo,
      tipoDte: update.tipo_dte as 39 | 41,
    });
  }

  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, aprendizaje };
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
      error: "No se actualizó ninguna propuesta — verifica permisos o que las propuestas existan",
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

// "Poner listo" (staged): marca propuestas como preparadas SIN mandarlas a Emitir.
// El pipeline de Emitir filtra por estado in (aprobado, editado), así que 'listo'
// queda fuera hasta que `aprobarCartola` las promueve. Es el lote atómico.
export async function ponerListo(
  propuestaIds: string[],
  clienteId?: string | null
): Promise<{ ok?: boolean; error?: string; count: number }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  // clienteId indefinido => no se toca (caso bulk desde bloque/todas). Definido
  // (incluso null) => se asigna, para el detalle expandido que elige cliente.
  const patch: { estado: string; cliente_id?: string | null } =
    clienteId === undefined ? { estado: "listo" } : { estado: "listo", cliente_id: clienteId };
  let listas = 0;
  for (let i = 0; i < propuestaIds.length; i += BATCH_SIZE) {
    const batch = propuestaIds.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update(patch, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      // Guard de estado (auditoría #25/#29): solo se stagea desde estados PRE-emisión.
      // Nunca degradar una 'aprobado' (ya en la cola de Emitir) ni resucitar una
      // 'rechazado'/emitida a 'listo'.
      .in("estado", ["pendiente", "editado", "listo"]);
    if (error) return { error: `Error en batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`, count: listas };
    listas += count ?? 0;
  }
  if (listas === 0 && propuestaIds.length > 0) return { error: "No se marcó ninguna propuesta como lista", count: 0 };
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: listas };
}

// Edita SOLO la glosa (notas) de una boleta ya EN EMISIÓN ('aprobado') o 'listo', SIN
// cambiar su estado. Nace del feedback del 1er contador de beta: una boleta aprobada
// quedaba bloqueada para corregir el "Detalle" (editarPropuesta excluye 'aprobado' para
// no burlar el candado de ponerListo). Esto es glosa-only: no degrada la boleta, no toca
// la máquina de estados ni el candado de emisión. Fail-CLOSED si YA se emitió (folio
// real): la glosa ya está en el SII, cambiar el `notas` en la app la desincronizaría.
export async function editarGlosaEmitible(
  propuestaId: string,
  notas: string | null,
): Promise<{ ok?: boolean; error?: string }> {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };
  const glosa = (notas ?? "").trim().slice(0, 80) || null;
  const { data: yaEmitida } = await ctx.sb
    .from("boletas_emitidas")
    .select("id")
    .eq("propuesta_id", propuestaId)
    .neq("estado", "anulada")
    .limit(1)
    .maybeSingle();
  if (yaEmitida) return { error: "Esta boleta ya se emitió: su detalle ya está en el SII y no se puede cambiar." };
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ notas: glosa }, { count: "exact" })
    .eq("id", propuestaId)
    .eq("empresa_id", ctx.empresaId)
    .in("estado", ["aprobado", "listo"]); // solo emitibles; NO cambia estado
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo guardar el detalle (la boleta ya no está en emisión)." };
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true };
}

// Aprobar cartola (atómico): promueve a Emitir TODAS las propuestas del documento
// que quedaron en "listo" (estado 'listo' → 'aprobado'). Es el único gatillo hacia
// Emitir para una cartola: nada cae en la cola hasta apretar esto.
// Devolver cartola (espejo de aprobarCartola, pedido fundador 2026-09-01): desde
// la pestaña Emitir, la cartola COMPLETA retrocede un paso — 'aprobado' → 'listo'.
// Devolver es "me arrepentí de enviar", no "me arrepentí del juicio": las juzgadas
// (rechazadas) no se tocan, y las listas quedan de nuevo esperando el Aprobar.
export async function devolverCartola(
  documentoId: string
): Promise<{ ok?: boolean; error?: string; count: number }> {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  const { data: props, error: qErr } = await ctx.sb
    .from("propuestas_ia")
    .select("id, movimientos_raw!inner(documento_id)")
    .eq("empresa_id", ctx.empresaId)
    .eq("estado", "aprobado")
    .eq("movimientos_raw.documento_id", documentoId);
  if (qErr) return { error: qErr.message, count: 0 };
  const ids = (props ?? []).map((p) => p.id);
  if (ids.length === 0) return { ok: true, count: 0 };
  let devueltas = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "listo" }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      // Guard: solo degrada 'aprobado'. Jamás toca emitidas/rechazadas.
      .eq("estado", "aprobado");
    if (error) return { error: error.message, count: devueltas };
    devueltas += count ?? 0;
  }
  await recordCuentaAudit({
    sb: ctx.sb, empresaId: ctx.empresaId, usuarioId: ctx.userId,
    accion: "cartola_devuelta_a_check", recursoTipo: "documento_subido", recursoId: documentoId,
    resumen: `${devueltas} propuestas devueltas de Emitir a Check (quedan listas)`, metadata: { cantidad: devueltas, documentoId },
  });
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: devueltas };
}

// La "última mirada" del conglomerado en Emitir (solo lectura, on-demand al
// expandir): las juzgadas (sin boleta, tachadas) y las YA EMITIDAS de esta
// cartola ("✓ en el SII" — irreversibles: ni se re-emiten ni se devuelven).
export async function ultimaMiradaCartola(
  documentoId: string
): Promise<{
  ok?: boolean; error?: string;
  juzgadas: Array<{ id: string; descripcion: string; monto: number; fecha: string | null }>;
  emitidas: Array<{ id: string; descripcion: string; monto: number; folio: number | null }>;
}> {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, juzgadas: [], emitidas: [] };
  type Mov = { documento_id: string; descripcion: string | null; monto: number | null; fecha: string | null };
  const movDe = (raw: unknown) => (Array.isArray(raw) ? raw[0] : raw) as Mov | undefined;

  // Juzgadas: propuestas rechazadas/descartadas del documento.
  const { data, error } = await ctx.sb
    .from("propuestas_ia")
    .select("id, total, movimientos_raw!inner(documento_id, descripcion, monto, fecha)")
    .eq("empresa_id", ctx.empresaId)
    .in("estado", ["rechazado", "descartado"])
    .eq("movimientos_raw.documento_id", documentoId)
    .limit(600);
  if (error) return { error: error.message, juzgadas: [], emitidas: [] };
  const juzgadas = (data ?? []).map((p) => {
    const m = movDe(p.movimientos_raw);
    return { id: p.id as string, descripcion: m?.descripcion ?? "(sin glosa)", monto: (p.total as number | null) ?? m?.monto ?? 0, fecha: m?.fecha ?? null };
  });

  // Emitidas: en propuestas no hay estado 'emitida' — la verdad vive en
  // boletas_emitidas.propuesta_id (mismo criterio con que pendientes-emision
  // las excluye de la cola). Join profundo hasta el documento.
  const { data: bols, error: bErr } = await ctx.sb
    .from("boletas_emitidas")
    .select("id, folio, monto_total, propuesta_id, propuestas_ia!inner(movimientos_raw!inner(documento_id, descripcion))")
    .eq("empresa_id", ctx.empresaId)
    .neq("estado", "anulada")
    .eq("propuestas_ia.movimientos_raw.documento_id", documentoId)
    .limit(600);
  if (bErr) return { error: bErr.message, juzgadas, emitidas: [] };
  const emitidas = (bols ?? []).map((b) => {
    const prop = (Array.isArray(b.propuestas_ia) ? b.propuestas_ia[0] : b.propuestas_ia) as { movimientos_raw: unknown } | undefined;
    const m = movDe(prop?.movimientos_raw);
    return { id: b.id as string, descripcion: m?.descripcion ?? "(sin glosa)", monto: (b.monto_total as number | null) ?? 0, folio: (b.folio as number | null) ?? null };
  });
  return { ok: true, juzgadas, emitidas };
}

export async function aprobarCartola(
  documentoId: string
): Promise<{ ok?: boolean; error?: string; count: number }> {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  const { data: props, error: qErr } = await ctx.sb
    .from("propuestas_ia")
    .select("id, movimientos_raw!inner(documento_id)")
    .eq("empresa_id", ctx.empresaId)
    .eq("estado", "listo")
    .eq("movimientos_raw.documento_id", documentoId);
  if (qErr) return { error: qErr.message, count: 0 };
  const ids = (props ?? []).map((p) => p.id);
  if (ids.length === 0) return { ok: true, count: 0 };
  let aprobadas = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "aprobado" }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch);
    if (error) return { error: error.message, count: aprobadas };
    aprobadas += count ?? 0;
  }
  await recordCuentaAudit({
    sb: ctx.sb, empresaId: ctx.empresaId, usuarioId: ctx.userId,
    accion: "propuestas_aprobadas", recursoTipo: "documento_subido", recursoId: documentoId,
    resumen: `${aprobadas} propuestas de cartola enviadas a emitir`, metadata: { cantidad: aprobadas, documentoId },
  });
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

  // Guard de estado (igual que editarPropuesta, auditoría #21): NO mutar una propuesta
  // 'aprobado' ya comprometida a Emitir, ni resucitar rechazadas/emitidas. Sin esto se
  // podía cambiar monto/receptor de una propuesta en cola justo antes de emitir-lote,
  // que usa mov.monto y receptor_rut como fallback → burla la re-aprobación.
  const { data: prop } = await sb
    .from("propuestas_ia")
    .select("estado")
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId)
    .maybeSingle();
  if (!prop) return { error: "Propuesta no encontrada" };
  if (!["pendiente", "editado", "listo"].includes(prop.estado)) {
    return { error: "No se puede editar — el estado de la propuesta no lo permite" };
  }

  // Validación de monto en runtime (la server action es un endpoint público; el tipo
  // TS no limita el payload).
  if (campos.monto !== undefined && !Number.isFinite(Number(campos.monto))) {
    return { error: "Monto inválido" };
  }

  if (campos.descripcion !== undefined || campos.monto !== undefined) {
    const movUpdate: Record<string, string | number> = {};
    if (campos.descripcion !== undefined) movUpdate.descripcion = campos.descripcion.trim();
    if (campos.monto !== undefined) movUpdate.monto = Number(campos.monto);
    const { error: movErr } = await sb
      .from("movimientos_raw")
      .update(movUpdate)
      .eq("empresa_id", ctx.empresaId)
      .eq("id", movimientoId);
    if (movErr) return { error: movErr.message };
  }

  // Cualquier edición de campos emitibles degrada la propuesta a 'editado' → exige
  // re-aprobación antes de emitir (coherente con editarPropuesta).
  const propUpdate: Record<string, string | number | null> = { estado: "editado" };
  if (campos.tipo_propuesto !== undefined) propUpdate.tipo_propuesto = campos.tipo_propuesto;
  if (campos.receptor_nombre !== undefined) propUpdate.receptor_nombre = campos.receptor_nombre;
  if (campos.receptor_rut !== undefined) propUpdate.receptor_rut = campos.receptor_rut;
  if (campos.notas !== undefined) propUpdate.notas = campos.notas;

  const { error: propErr, count } = await sb
    .from("propuestas_ia")
    .update(propUpdate, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId)
    .in("estado", ["pendiente", "editado", "listo"]);

  if (propErr) return { error: propErr.message };
  if (!count) return { error: "No se pudo editar — el estado de la propuesta no lo permite" };

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
