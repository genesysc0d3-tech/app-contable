"use server";

import { createClient } from "@/lib/supabase/server";
import { type SupabaseClient } from "@supabase/supabase-js";
import { getEmpresaAndService } from "@/lib/auth/contexto-empresa";
import { revalidatePath } from "next/cache";
import { recordCuentaAudit } from "@/lib/audit/account";
import { aprenderReglaDesdeResolucion, extraerPatronContraparte, type AprenderResultado } from "@/lib/ai/aprender-regla";
import { buscarReglaPorContraparte, buscarReglasPorContrapartes, claveContraparte, registrarCorrecciones } from "@/lib/ai/reglas-historial";
import { esDecisionMirada } from "@/lib/ai/regla-evidencia";

import { carrilEsExento } from "@/lib/sii/tipo-por-carril";
import { avisoPorDecidir, MSG_TIPO_POR_DECIDIR, PG_TIPOS_POR_DECIDIR, PG_OR_SIN_CONFLICTO_MARCA, PG_OR_ES_POR_DECIDIR, FUENTE_CONFLICTO_MARCA } from "@/lib/sii/destino";
import { derivarMontosDte } from "@/lib/sii/montos-dte";
import { confirmarMapaPorCheck } from "@/lib/cartola/confirmacion-mapa";
import { esErrorCandadoBD } from "@/lib/emission/bloqueo-borrado";
import { avisoSeQuedan, clasificarIntocables, contarIntocables, resumenRetroceso, type MotivoIntocable } from "@/lib/emission/propuestas-intocables";
import { canalDeOrigen, nuevoLote, sello, type CanalDecision } from "@/lib/propuestas/sello";
import { resumenPropuestasABorrar } from "@/lib/propuestas/resumen-borrado";

const BATCH_SIZE = 50;

/** La fila mostraba un tipo que NO decidió la regla: conflicto con la marca P2P (sin
 *  tipo) o emisor exento que forzó 41 sobre una regla 39. Cambiarlo no corrige la regla. */
function tipoNoEsDeLaRegla(f: { fuente_clasificacion?: string | null; orig_tipo_dte_fuente?: string | null }): boolean {
  return f.fuente_clasificacion === FUENTE_CONFLICTO_MARCA || f.orig_tipo_dte_fuente === "regla_forzada_exenta";
}

/** Desde dónde se puede aprobar (mismo allowlist que editarPropuesta y ponerListo). */
const ESTADOS_APROBABLES = ["pendiente", "listo", "editado"];
const MENSAJE_NO_APROBABLE =
  "Este movimiento cambió mientras lo mirabas (otra persona lo aprobó, rechazó o emitió). Recarga para ver cómo quedó.";

/** Cuántas de estas filas son «¿?» (destino "preguntar"). Best-effort: 0 si falla. */
async function contarPorDecidir(sb: SupabaseClient, empresaId: string, ids: string[]): Promise<number> {
  let n = 0;
  try {
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const { count } = await sb
        .from("propuestas_ia")
        .select("id", { count: "exact", head: true })
        .eq("empresa_id", empresaId)
        .in("id", ids.slice(i, i + BATCH_SIZE))
        .or(PG_OR_ES_POR_DECIDIR);
      n += count ?? 0;
    }
  } catch { /* el aviso es informativo */ }
  return n;
}
async function hayPorDecidir(sb: SupabaseClient, empresaId: string, ids: string[]): Promise<boolean> {
  return (await contarPorDecidir(sb, empresaId, ids)) > 0;
}

// Guard de acceso: src/lib/auth/contexto-empresa.ts (compartido con "Lo que aprendí").
// Service role porque las policies de propuestas_ia botaban UPDATEs en silencio (0
// filas) y la UI optimista "aprobaba" lo que nunca persistía: cada UPDATE de este
// archivo va scopeado con .eq("empresa_id", empresaId).

type Ctx = { userId: string; soporte: boolean | null };
/** Un lote que llega como argumento (server action = endpoint público): solo un uuid. */
function loteValido(l: unknown): string | undefined {
  return typeof l === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(l) ? l : undefined;
}
/** Sello de esta acción (Fase 1 medición). `lote` compartido entre trozos del mismo gesto. */
function selloDe(ctx: Ctx, canal: CanalDecision, loteN: number, lote?: string) {
  return sello(canal, { usuarioId: ctx.userId, loteN, lote, soporte: ctx.soporte });
}

/**
 * Guard de retroceso (incidente MH 2026-09-29): ninguna acción que mueva una
 * propuesta hacia atrás (Check, pendiente, juzgada, oculta, borrada) puede tocar
 * una ya EMITIDA, A MEDIAS / SIN RESPUESTA o EN VUELO. Devuelve el mensaje de
 * error para UNA propuesta, o null si se puede tocar. Fail-closed.
 */
const MENSAJE_INTOCABLE: Record<MotivoIntocable, string> = {
  emitida: "Esta boleta ya se emitió en el SII: no puede volver atrás.",
  a_medias: "Esta boleta quedó a medias en el SII: verifícala en A medias antes de moverla.",
  sin_respuesta: "Esta boleta quedó sin respuesta del SII: verifícala en A medias antes de moverla.",
  en_vuelo: "Esta boleta se está emitiendo en este momento: espera a que termine.",
};
const MENSAJE_CANDADO_BD_PROPUESTA = "Esta boleta tiene una emisión registrada o a medias en el SII: no se puede borrar. No se borró nada.";
async function bloqueoRetroceso(sb: Parameters<typeof clasificarIntocables>[0], empresaId: string, propuestaId: string): Promise<string | null> {
  const sep = await clasificarIntocables(sb, empresaId, [propuestaId]);
  if ("error" in sep) return sep.error;
  const motivo = sep.intocables.get(propuestaId);
  return motivo ? MENSAJE_INTOCABLE[motivo] : null;
}

export async function aprobarPropuesta(
  propuestaId: string,
  clienteId?: string | null
) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };

  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "aprobado", cliente_id: clienteId ?? null, ...selloDe(ctx, "check_detalle", 1) }, { count: "exact" })
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId)
    // Guard de estado (seguridad 2026-09-30, punto 4): con una vista vieja se
    // resucitaba a `aprobado` lo que otra persona había rechazado/descartado (volvía a
    // Emitir) o se le cambiaba el cliente a una ya aprobada/emitida. Filtro EN la
    // misma consulta (atómico), mismo allowlist que editarPropuesta.
    .in("estado", ESTADOS_APROBABLES)
    // Destino único: un «¿?» (arriendo/comisión, conflicto regla↔marca) no se aprueba
    // sin decidir si es venta exenta, afecta o no es venta.
    .not("tipo_propuesto", "in", PG_TIPOS_POR_DECIDIR)
    .or(PG_OR_SIN_CONFLICTO_MARCA);

  if (error) return { error: error.message };
  if (!count) {
    if (await hayPorDecidir(ctx.sb, ctx.empresaId, [propuestaId])) return { error: MSG_TIPO_POR_DECIDIR };
    return { error: MENSAJE_NO_APROBABLE };
  }
  await recordCuentaAudit({
    sb: ctx.sb,
    empresaId: ctx.empresaId,
    usuarioId: ctx.userId,
    accion: "propuesta_aprobada",
    recursoTipo: "propuesta_ia",
    recursoId: propuestaId,
    resumen: "Propuesta aprobada",
  });
  // Juez implícito (lector con juez, 2026-09-30): aprobando FILA A FILA, si la
  // cartola quedó toda decidida sin editar lo leído y sin alertas, el mapa de
  // columnas provisorio de la empresa se confirma. Best-effort.
  try {
    const { data: prop } = await ctx.sb
      .from("propuestas_ia")
      .select("movimientos_raw!inner(documento_id)")
      .eq("empresa_id", ctx.empresaId)
      .eq("id", propuestaId)
      .maybeSingle();
    const mr = (prop as { movimientos_raw?: { documento_id?: string | null } | { documento_id?: string | null }[] } | null)?.movimientos_raw;
    const documentoId = Array.isArray(mr) ? mr[0]?.documento_id : mr?.documento_id;
    if (documentoId) await confirmarMapaPorCheck(ctx.sb, ctx.empresaId, documentoId);
  } catch { /* el aprendizaje del mapa nunca rompe Aprobar */ }
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
  const bloqueo = await bloqueoRetroceso(ctx.sb, ctx.empresaId, propuestaId);
  if (bloqueo) return { error: bloqueo };
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "descartado", ...selloDe(ctx, "check_fila", 1) }, { count: "exact" })
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
  const bloqueo = await bloqueoRetroceso(ctx.sb, ctx.empresaId, propuestaId);
  if (bloqueo) return { error: bloqueo };
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "oculto", ...selloDe(ctx, "check_fila", 1) }, { count: "exact" })
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
  const bloqueo = await bloqueoRetroceso(ctx.sb, ctx.empresaId, propuestaId);
  if (bloqueo) return { error: bloqueo };
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "pendiente", ...selloDe(ctx, "check_fila", 1) }, { count: "exact" })
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
  propuestaIds: string[],
  /** Desde dónde (check_fila | check_detalle | check_lote). Validado: fuera de lista se deduce. */
  origen?: string,
  /** Lote del gesto que la llama (decidirVenta). Validado como uuid; si no, uno nuevo. */
  loteGesto?: string,
): Promise<{ ok?: boolean; error?: string; count: number; aviso?: string }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  const gestoN = propuestaIds.length; // tamaño del gesto (sello), antes del guard
  // Guard de retroceso (incidente MH 2026-09-29): lo emitido / a medias / en vuelo no se mueve.
  const sepR = await clasificarIntocables(ctx.sb, ctx.empresaId, propuestaIds);
  if ("error" in sepR) return { error: sepR.error, count: 0 };
  const tocables = sepR.tocables;
  if (tocables.length === 0) return { error: resumenRetroceso(0, "movidas", sepR.intocables), count: 0 };
  let marcadas = 0;
  const lote = loteValido(loteGesto) ?? nuevoLote();
  const canal = canalDeOrigen(origen, gestoN);
  for (let i = 0; i < tocables.length; i += BATCH_SIZE) {
    const batch = tocables.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "rechazado", ...selloDe(ctx, canal, gestoN, lote) }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      // 'listo' incluido (2026-09-02): una lista también puede juzgarse sin
      // boleta en grupo. 'aprobado' sigue fuera (comprometida a Emitir).
      .in("estado", ["pendiente", "editado", "listo"]);
    if (error) return { error: `Error en batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`, count: marcadas };
    marcadas += count ?? 0;
  }
  if (marcadas === 0 && tocables.length > 0) return { error: "No se marcó ninguna (¿ya estaban juzgadas?)", count: 0 };
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: marcadas, aviso: avisoSeQuedan(sepR.intocables) || undefined };
}

/**
 * CAMBIO DE TIPO EN BLOQUE — afecta ⇄ exenta sobre las seleccionadas.
 *
 * "El cliente siempre tiene la razón" (fundador 2026-09-04): la clasificación
 * propone, pero el humano puede tomar veinte movimientos y decir que son
 * afectos. Antes eso era de a uno, abriendo cada tarjeta.
 *
 * Lo que SÍ se respeta por encima del cliente: un emisor EXENTO en ese carril
 * no puede emitir afecta — fabricaría IVA que no existe, y el guard
 * fail-closed de la emisión lo rechazaría igual, pero recién al emitir. Mejor
 * decirlo acá, cuando todavía se puede arreglar, y decir DÓNDE se arregla.
 *
 * Estados: solo pendiente/editado/listo (mismo criterio que el juicio "sin
 * boleta" en lote). Una 'aprobado' está comprometida a Emitir y no se toca.
 *
 * El total NO se toca nunca: es lo que entró al banco. Lo que se recalcula es
 * cómo se reparte entre neto e IVA (`derivarMontosDte`, punto único).
 */
export async function cambiarTipoPropuestas(
  propuestaIds: string[],
  destino: "afecta" | "exenta",
  mesa: "boleta" | "factura" = "boleta",
  /** Desde dónde (check_fila | check_detalle | check_lote). Sin origen: check_lote. */
  origen?: string,
  /** Lote del gesto que la llama (decidirVenta). Validado como uuid; si no, uno nuevo. */
  loteGesto?: string,
): Promise<{ ok?: boolean; error?: string; count: number; aviso?: string }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  const gestoN = propuestaIds.length; // tamaño del gesto (sello), antes del guard
  // Guard de retroceso (incidente MH 2026-09-29): lo emitido / a medias / en vuelo no se mueve.
  const sepR = await clasificarIntocables(ctx.sb, ctx.empresaId, propuestaIds);
  if ("error" in sepR) return { error: sepR.error, count: 0 };
  const tocables = sepR.tocables;
  if (tocables.length === 0) return { error: resumenRetroceso(0, "movidas", sepR.intocables), count: 0 };

  const { data: empresa } = await ctx.sb
    .from("empresas")
    .select("tipo_contribuyente, boletas_tipo_default, facturas_tipo_default")
    .eq("id", ctx.empresaId)
    .maybeSingle();
  if (destino === "afecta" && carrilEsExento(empresa, mesa)) {
    return {
      error: mesa === "factura"
        ? "Tus facturas emiten exento: una afecta llevaría IVA que no puedes recargar. Si tienes operaciones afectas, necesitas esa actividad declarada en el SII y después activarla en Empresa → Emisor."
        : "Tus boletas emiten exento: una afecta llevaría IVA que no puedes recargar. Si tienes operaciones afectas, necesitas esa actividad declarada en el SII y después activarla en Empresa → Emisor.",
      count: 0,
    };
  }

  const afecta = destino === "afecta";
  const tipoPropuesto = mesa === "factura"
    ? (afecta ? "factura_afecta" : "factura_exenta")
    : (afecta ? "boleta" : "exenta");
  const tipoDte = mesa === "factura" ? (afecta ? 33 : 34) : (afecta ? 39 : 41);

  let cambiadas = 0;
  const movIdsCambiados: string[] = [];
  // Filas cambiadas que venían de una regla: la corrección se registra UNA vez por regla.
  // Filas cambiadas que pueden corregir una regla (regla_id, o se busca por contraparte).
  const reglaPorMov = new Map<string, { reglaId: string | null; tipoFila: number | null; propuestaId: string }>();
  let avisosRegla: string[] = [];
  const lote = loteValido(loteGesto) ?? nuevoLote();
  const canal = origen === undefined ? "check_lote" : canalDeOrigen(origen, gestoN);
  for (let i = 0; i < tocables.length; i += BATCH_SIZE) {
    const batch = tocables.slice(i, i + BATCH_SIZE);
    // Se lee el total de CADA una: el reparto neto/IVA depende de su monto, así
    // que no hay un UPDATE único que sirva para todo el lote. Traemos también el
    // movimiento_id para poder aprender la regla de contraparte (abajo).
    const { data: filas, error: leerError } = await ctx.sb
      .from("propuestas_ia")
      .select("id, total, movimiento_id, regla_id, tipo_dte, fuente_clasificacion, orig_tipo_dte_fuente")
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      .in("estado", ["pendiente", "editado", "listo"]);
    if (leerError) return { error: leerError.message, count: cambiadas };

    for (const fila of (filas ?? []) as Array<{ id: string; total: number | null; movimiento_id: string | null; regla_id: string | null; tipo_dte?: number | null; fuente_clasificacion?: string | null; orig_tipo_dte_fuente?: string | null }>) {
      const { neto, iva } = derivarMontosDte(Number(fila.total ?? 0), afecta);
      const { error, count } = await ctx.sb
        .from("propuestas_ia")
        .update({ tipo_propuesto: tipoPropuesto, tipo_dte: tipoDte, monto_neto: neto, iva, estado: "editado", ...selloDe(ctx, canal, gestoN, lote) }, { count: "exact" })
        .eq("empresa_id", ctx.empresaId)
        .eq("id", fila.id)
        .in("estado", ["pendiente", "editado", "listo"]);
      if (error) return { error: error.message, count: cambiadas };
      if ((count ?? 0) > 0 && fila.movimiento_id) {
        movIdsCambiados.push(fila.movimiento_id);
        // Corrección de la regla = cambiar el tipo que la regla le MOSTRÓ en esta fila
        // (M2). Una «¿?» por conflicto con la marca P2P o un 41 forzado por emisor exento
        // no hablan de la regla. El tipo previo se compara contra la regla en
        // registrarCorrecciones (esCorreccionDeRegla).
        // Sin regla_id (hermana propagada antes de ligarse, o fila IA anterior a la regla):
        // se busca la regla viva por la contraparte más abajo.
        if (!tipoNoEsDeLaRegla(fila)) reglaPorMov.set(fila.movimiento_id, { reglaId: fila.regla_id ?? null, tipoFila: fila.tipo_dte ?? null, propuestaId: fila.id });
      }
      cambiadas += count ?? 0;
    }
  }

  if (cambiadas === 0) return { error: "No se cambió ninguna (¿ya estaban emitidas o comprometidas a Emitir?)", count: 0 };

  // Aprender-al-clasificar por el camino BULK (la "cartola de corrido" = el uso
  // real del producto). Antes solo aprendía editarPropuesta (edición individual);
  // por eso el aprendizaje llevaba 3 meses muerto (memoria project_aprender_al_
  // clasificar §2026-09-11). Solo mesa boleta (39/41): la acuñación y el matcher
  // hablan ese vocabulario, no factura 33/34. Se DEDUP por contraparte DENTRO de
  // la acción: 50 P2P de "JUAN PEREZ" = 1 upsert + 1 propagación, no 50.
  // Best-effort: un fallo acá NO revierte el cambio de tipo ya guardado.
  if (mesa === "boleta" && movIdsCambiados.length > 0) {
    try {
      // Trocear el read en BATCH_SIZE como el resto del archivo: un .in() con
      // cientos de ids se pasa del límite de URL de PostgREST y volvería `null`
      // en SILENCIO → el aprendizaje se autodesactivaría justo en la cartola de
      // corrido grande (el caso que este fix busca resolver). + filtro empresa_id
      // (defensa en profundidad: el service role bypassa RLS).
      const movs: Array<{ id: string; descripcion: string | null; tipo_flujo: string | null; documento_id: string | null }> = [];
      for (let i = 0; i < movIdsCambiados.length; i += BATCH_SIZE) {
        const { data } = await ctx.sb
          .from("movimientos_raw")
          .select("id, descripcion, tipo_flujo, documento_id")
          .eq("empresa_id", ctx.empresaId)
          .in("id", movIdsCambiados.slice(i, i + BATCH_SIZE));
        if (data) movs.push(...(data as typeof movs));
      }
      // Fase 3: la persona cambió el tipo de filas que una regla clasificó → UNA
      // corrección por regla (no por fila). Baja de nivel, no pisa (reglas-historial.ts).
      // ANTES de acuñar: si la regla a prueba se da vuelta, el acuñar de abajo la refuerza.
      // Las filas sin regla_id buscan su regla viva por contraparte en UNA consulta.
      const sinRegla = movs.filter((m) => reglaPorMov.has(m.id) && !reglaPorMov.get(m.id)!.reglaId);
      const porContraparte = sinRegla.length > 0
        ? await buscarReglasPorContrapartes(ctx.sb, ctx.empresaId, sinRegla.map((m) => ({ descripcion: m.descripcion, tipoFlujo: m.tipo_flujo })))
        : new Map<string, string>();
      const filasCorregidas: Array<{ reglaId: string; tipoFila: number | null; documentoId: string | null; glosa: string | null; propuestaId: string }> = [];
      for (const m of movs) {
        const r = reglaPorMov.get(m.id);
        if (!r) continue;
        const reglaId = r.reglaId ?? porContraparte.get(claveContraparte(m.descripcion, m.tipo_flujo) ?? "") ?? null;
        if (reglaId) filasCorregidas.push({ reglaId, tipoFila: r.tipoFila, documentoId: m.documento_id, glosa: m.descripcion, propuestaId: r.propuestaId });
      }
      if (filasCorregidas.length > 0) {
        const { avisos } = await registrarCorrecciones(ctx.sb, {
          empresaId: ctx.empresaId,
          tipoNuevo: tipoDte,
          // Mirada = una fila / el detalle, o un lote chico (≤ 25): lo mismo que la evidencia.
          mirada: esDecisionMirada({ canal, lote_n: gestoN }),
          filas: filasCorregidas,
        });
        avisosRegla = avisos;
      }
      const vistos = new Set<string>();
      for (const m of movs) {
        if (m.tipo_flujo !== "entrada" && m.tipo_flujo !== "salida") continue;
        const extra = extraerPatronContraparte(m.descripcion);
        if (!extra) continue; // ruido/genérica/evento bancario → no aprende
        const clave = `${extra.patron}|${m.tipo_flujo}`;
        if (vistos.has(clave)) continue; // ya acuñé esta contraparte en este lote
        vistos.add(clave);
        await aprenderReglaDesdeResolucion(ctx.sb, {
          empresaId: ctx.empresaId,
          userId: ctx.userId,
          documentoId: m.documento_id,
          descripcion: m.descripcion ?? "",
          tipoFlujo: m.tipo_flujo,
          tipoDte: tipoDte as 39 | 41,
          // Tamaño del gesto: un "Afecta" en lote grande no confirma la regla contra la marca P2P.
          tamanoLote: cambiadas,
          canal,
          movimientoId: m.id,
        });
      }
    } catch {
      // el cambio de tipo ya quedó guardado; aprender es best-effort
    }
  }

  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  // Avisos de la regla (se dio vuelta / ya no estoy seguro) junto al de intocables.
  const avisoFinal = [...avisosRegla, avisoSeQuedan(sepR.intocables)].filter(Boolean).join(" ");
  return { ok: true, count: cambiadas, aviso: avisoFinal || undefined };
}

/**
 * Decisión de un «¿?» (destino "preguntar"): ¿es venta exenta, afecta o no es venta?
 * Reutiliza cambiarTipoPropuestas / rechazarPropuestas. Un «¿?» que quedó APROBADO
 * (de antes del destino único, o por otro canal) nunca se pudo emitir — el lote y los
 * jobs lo rechazan — así que primero vuelve a 'pendiente' para poder decidirlo. Lo
 * emitido / a medias / en vuelo no se toca (clasificarIntocables).
 */
export async function decidirVenta(
  propuestaIds: string[],
  decision: "exenta" | "afecta" | "no_es_venta",
  mesa: "boleta" | "factura" = "boleta",
  /** Desde dónde (check_fila | check_detalle | check_lote). Validado: fuera de lista se deduce. */
  origen?: string,
): Promise<{ ok?: boolean; error?: string; count: number; aviso?: string }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  // El reset a pendiente y la decisión (rechazar / cambiar tipo) van con lotes
  // DISTINTOS: el trigger toma "mismo lote que la escritura anterior" como escritura
  // sin sellar, así que compartirlo dejaba la decisión real como sin_sello
  // (revisión adversarial de la integración, 2026-10-04). Mismo canal.
  const canal = canalDeOrigen(origen, propuestaIds.length);
  const loteReset = nuevoLote();
  const lote = nuevoLote();
  const sepR = await clasificarIntocables(ctx.sb, ctx.empresaId, propuestaIds);
  if ("error" in sepR) return { error: sepR.error, count: 0 };
  for (let i = 0; i < sepR.tocables.length; i += BATCH_SIZE) {
    const { error } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "pendiente", ...selloDe(ctx, canal, propuestaIds.length, loteReset) })
      .eq("empresa_id", ctx.empresaId)
      .in("id", sepR.tocables.slice(i, i + BATCH_SIZE))
      .eq("estado", "aprobado")
      .or(PG_OR_ES_POR_DECIDIR);
    if (error) return { error: error.message, count: 0 };
  }
  return decision === "no_es_venta"
    ? rechazarPropuestas(propuestaIds, canal, lote)
    : cambiarTipoPropuestas(propuestaIds, decision, mesa, canal, lote);
}

export async function rechazarPropuesta(propuestaId: string, origen?: string) {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error };
  const bloqueo = await bloqueoRetroceso(ctx.sb, ctx.empresaId, propuestaId);
  if (bloqueo) return { error: bloqueo };
  const { error, count } = await ctx.sb
    .from("propuestas_ia")
    .update({ estado: "rechazado", ...selloDe(ctx, canalDeOrigen(origen, 1), 1) }, { count: "exact" })
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

  /**
   * EMISOR EXENTO ⇒ NO PUEDE PASAR A AFECTA (regla del fundador 2026-09-05:
   * "si eres exento no puedes hacer afecto; solo si eres afecto puedes hacer
   * mixto"). El selector de la UI ya viene apagado, pero una server action es
   * un endpoint público: la regla tiene que vivir también acá.
   *
   * El fundamento no es que "sea exento" como categoría — en el IVA la calidad
   * afecta/exenta es de la OPERACIÓN. Lo que se lo impide es no tener actividad
   * afecta declarada en su inicio de actividades: no está autorizado a recargar
   * IVA, y si lo recarga igual tiene que enterarlo en arcas fiscales de todas
   * formas, además de generarle al receptor un crédito fiscal improcedente. Por
   * eso el mensaje manda al SII primero y a nuestro selector después.
   *
   * Solo muerde cuando se INTENTA setear un tipo afecto — editar la glosa de
   * una propuesta que ya trae 39 no pasa por este guard.
   *
   * Fail-closed a propósito: sin este corte, la propuesta quedaba "Afecta" en
   * pantalla y la emisión la forzaba a exenta igual. La pantalla mentía.
   */
  if (campos.tipo_dte === 39 || campos.tipo_dte === 33) {
    const { data: empresa } = await ctx.sb
      .from("empresas")
      .select("tipo_contribuyente, boletas_tipo_default, facturas_tipo_default")
      .eq("id", ctx.empresaId)
      .maybeSingle();
    const carril = campos.tipo_dte === 33 ? "factura" : "boleta";
    if (carrilEsExento(empresa, carril)) {
      return { error: "Tu empresa emite exento: no puede recargar IVA. Si de verdad tienes una operación afecta, primero necesitas esa actividad declarada en el SII; recién después la activas en Empresa → Emisor." };
    }
  }

  // Allowlist explícita: las server actions son endpoints públicos y el tipo
  // TS no limita el payload en runtime. Con service role, un spread directo
  // permitiría setear cualquier columna (empresa_id, estado, confianza...).
  const update: Record<string, string | number | boolean | null> = { estado: "editado" };
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

  // Snapshot previo para aprender-al-clasificar. Aprendemos solo cuando la
  // decisión humana aporta SEÑAL (evitar el "eco" de amplificar una adivinanza
  // que el humano solo dejó pasar):
  //   (a) el LLM NO supo (tipo_dte previo null) → el humano lo resolvió, o
  //   (b) el humano CAMBIÓ el tipo respecto del pre-estampado (corrigió al LLM).
  // Si el humano solo confirma pasivamente lo que el clasificador ya estampó
  // (mismo tipo), NO se acuña: sería convertir una adivinanza no-juzgada en una
  // regla 0.95 que auto-clasifica el futuro. (El camino BULK cambiarTipoPropuestas
  // sí es elección deliberada y acuña aparte.) Se lee ANTES porque el update
  // sobreescribe el tipo_dte previo.
  let previo:
    | { descripcion: string; tipo_flujo: "entrada" | "salida"; documento_id: string | null; movimiento_id: string }
    | null = null;
  // Regla que clasificó la fila (Fase 3): si la persona le cambia el tipo, es una corrección.
  let reglaPrevia: { reglaId: string; documentoId: string | null; tipoFila: number | null; glosa: string | null; propuestaId: string; explicita: boolean } | null = null;
  if (campos.tipo_dte === 39 || campos.tipo_dte === 41) {
    const { data: p } = await ctx.sb
      .from("propuestas_ia")
      .select("tipo_dte, movimiento_id, regla_id, fuente_clasificacion, orig_tipo_dte_fuente")
      .eq("empresa_id", ctx.empresaId)
      .eq("id", propuestaId)
      .maybeSingle();
    const aportaSenal = p != null && (p.tipo_dte == null || p.tipo_dte !== campos.tipo_dte);
    // El movimiento se lee siempre: aprender lo necesita si hay señal, y la corrección de
    // la regla también sin señal (en disputa, repetir el tipo mirado arma la racha).
    const { data: m } = p?.movimiento_id
      ? await ctx.sb
          .from("movimientos_raw")
          .select("descripcion, tipo_flujo, documento_id")
          .eq("id", p.movimiento_id)
          .maybeSingle()
      : { data: null };
    if (p && p.movimiento_id && aportaSenal && m && (m.tipo_flujo === "entrada" || m.tipo_flujo === "salida")) {
      previo = {
        descripcion: m.descripcion ?? "",
        tipo_flujo: m.tipo_flujo,
        documento_id: m.documento_id,
        movimiento_id: p.movimiento_id,
      };
    }
    const pr = p as { regla_id?: string | null; tipo_dte?: number | null; fuente_clasificacion?: string | null; orig_tipo_dte_fuente?: string | null } | null;
    if (pr && !tipoNoEsDeLaRegla(pr)) {
      // Sin regla_id (hermana propagada antes de ligarse, fila IA anterior a la regla):
      // la regla viva de esa contraparte, con la misma clave que acuñar.
      const reglaId = pr.regla_id
        ?? (m ? await buscarReglaPorContraparte(ctx.sb, { empresaId: ctx.empresaId, descripcion: m.descripcion, tipoFlujo: m.tipo_flujo }) : null);
      if (reglaId) {
        reglaPrevia = {
          reglaId, documentoId: m?.documento_id ?? null, tipoFila: pr.tipo_dte ?? null, glosa: m?.descripcion ?? null,
          propuestaId,
          // "Lista" sin tocar el selector sobre una fila que ya traía tipo NO es elegir.
          explicita: pr.tipo_dte == null || pr.tipo_dte !== campos.tipo_dte,
        };
      }
    }
  }

  const selloEdicion = selloDe(ctx, "check_detalle", 1);
  const doUpdate = () => ctx.sb
    .from("propuestas_ia")
    .update({ ...update, ...selloEdicion }, { count: "exact" })
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
  // el fallback de arriba) y se pudo capturar la glosa/flujo del movimiento
  // (previo != null). Best-effort: aprenderReglaDesdeResolucion nunca lanza; un
  // fallo acá no rompe la edición ya guardada.
  const tipoDtePersistida = "tipo_dte" in update && (update.tipo_dte === 39 || update.tipo_dte === 41);
  let aprendizaje: AprenderResultado | null = null;
  let aviso: string | undefined;
  if (reglaPrevia && tipoDtePersistida) {
    // Una corrección por regla y acción (mirada: es el detalle de UNA fila); no-op si la
    // fila no mostraba el tipo de la regla o si es el mismo.
    try {
      const { avisos } = await registrarCorrecciones(ctx.sb, { empresaId: ctx.empresaId, tipoNuevo: update.tipo_dte as number, mirada: true, filas: [reglaPrevia] });
      aviso = avisos.join(" ") || undefined;
    } catch { /* best-effort: la edición ya quedó */ }
  }
  if (previo && tipoDtePersistida) {
    aprendizaje = await aprenderReglaDesdeResolucion(ctx.sb, {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      documentoId: previo.documento_id,
      descripcion: previo.descripcion,
      tipoFlujo: previo.tipo_flujo,
      tipoDte: update.tipo_dte as 39 | 41,
      canal: "check_detalle",
      movimientoId: previo.movimiento_id,
    });
  }

  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, aprendizaje, aviso };
}

export async function aprobarTodas(
  propuestaIds: string[]
): Promise<{ ok?: boolean; error?: string; count: number; porDecidir?: number; aviso?: string }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };

  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };

  let aprobadas = 0;
  const lote = nuevoLote();

  // Batch in chunks of BATCH_SIZE to avoid PostgREST URL length limit
  // (.in() puts all IDs in the query string — 659 UUIDs = 24KB, exceeds limit)
  for (let i = 0; i < propuestaIds.length; i += BATCH_SIZE) {
    const batch = propuestaIds.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "aprobado", ...selloDe(ctx, "check_lote", propuestaIds.length, lote) }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      // Guard de estado en la propia consulta (seguridad 2026-09-30, punto 4): las que
      // otra persona rechazó/descartó o que ya están aprobadas no se tocan.
      .in("estado", ESTADOS_APROBABLES)
      // Los «¿?» se quedan: primero hay que decir si son venta.
      .not("tipo_propuesto", "in", PG_TIPOS_POR_DECIDIR)
      .or(PG_OR_SIN_CONFLICTO_MARCA);

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
    if (await hayPorDecidir(ctx.sb, ctx.empresaId, propuestaIds)) return { error: MSG_TIPO_POR_DECIDIR, count: 0 };
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

  const porDecidir = aprobadas < propuestaIds.length ? await contarPorDecidir(ctx.sb, ctx.empresaId, propuestaIds) : 0;
  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: aprobadas, ...(porDecidir > 0 ? { porDecidir, aviso: avisoPorDecidir(porDecidir) } : {}) };
}

// "Poner listo" (staged): marca propuestas como preparadas SIN mandarlas a Emitir.
// El pipeline de Emitir filtra por estado in (aprobado, editado), así que 'listo'
// queda fuera hasta que `aprobarCartola` las promueve. Es el lote atómico.
export async function ponerListo(
  propuestaIds: string[],
  clienteId?: string | null,
  /** Desde dónde (check_fila | check_detalle | check_lote). Validado: fuera de lista se deduce. */
  origen?: string,
): Promise<{ ok?: boolean; error?: string; count: number; porDecidir?: number; aviso?: string }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  // clienteId indefinido => no se toca (caso bulk desde bloque/todas). Definido
  // (incluso null) => se asigna, para el detalle expandido que elige cliente.
  const patch: { estado: string; cliente_id?: string | null } =
    clienteId === undefined ? { estado: "listo" } : { estado: "listo", cliente_id: clienteId };
  let listas = 0;
  const lote = nuevoLote();
  const canal = canalDeOrigen(origen, propuestaIds.length);
  for (let i = 0; i < propuestaIds.length; i += BATCH_SIZE) {
    const batch = propuestaIds.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ ...patch, ...selloDe(ctx, canal, propuestaIds.length, lote) }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      // Guard de estado (auditoría #25/#29): solo se stagea desde estados PRE-emisión.
      // Nunca degradar una 'aprobado' (ya en la cola de Emitir) ni resucitar una
      // 'rechazado'/emitida a 'listo'.
      .in("estado", ["pendiente", "editado", "listo"])
      // Destino único: lo "por decidir" (arriendo/comisión) no se stagea a ciegas.
      .not("tipo_propuesto", "in", PG_TIPOS_POR_DECIDIR)
      .or(PG_OR_SIN_CONFLICTO_MARCA);
    if (error) return { error: `Error en batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`, count: listas };
    listas += count ?? 0;
  }
  if (listas === 0 && propuestaIds.length > 0) return { error: `No se marcó ninguna propuesta como lista. Si es un «¿?»: ${MSG_TIPO_POR_DECIDIR}`, count: 0 };
  // B1: si algunas no se movieron por ser «¿?», se dice cuántas (no desaparecen en silencio).
  const porDecidir = listas < propuestaIds.length ? await contarPorDecidir(ctx.sb, ctx.empresaId, propuestaIds) : 0;
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: listas, ...(porDecidir > 0 ? { porDecidir, aviso: avisoPorDecidir(porDecidir) } : {}) };
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
    .update({ notas: glosa, ...selloDe(ctx, "check_detalle", 1) }, { count: "exact" })
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
// Volver a PENDIENTE en grupo (pedido fundador 2026-09-02: toda sección puede
// cambiar de estado). Des-stagea listas — el juicio se re-abre sin perder nada.
// Guard: solo desde 'listo' (jamás degrada aprobadas ni resucita juzgadas acá).
export async function volverAPendientes(
  propuestaIds: string[],
  /** Desde dónde (check_fila | check_detalle | check_lote). Validado: fuera de lista se deduce. */
  origen?: string,
): Promise<{ ok?: boolean; error?: string; count: number; aviso?: string }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  const gestoN = propuestaIds.length; // tamaño del gesto (sello), antes del guard
  // Guard de retroceso (incidente MH 2026-09-29): lo emitido / a medias / en vuelo no se mueve.
  const sepR = await clasificarIntocables(ctx.sb, ctx.empresaId, propuestaIds);
  if ("error" in sepR) return { error: sepR.error, count: 0 };
  const tocables = sepR.tocables;
  if (tocables.length === 0) return { error: resumenRetroceso(0, "movidas", sepR.intocables), count: 0 };
  let devueltas = 0;
  const lote = nuevoLote();
  const canal = canalDeOrigen(origen, gestoN);
  for (let i = 0; i < tocables.length; i += BATCH_SIZE) {
    const batch = tocables.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "pendiente", ...selloDe(ctx, canal, gestoN, lote) }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      .eq("estado", "listo");
    if (error) return { error: error.message, count: devueltas };
    devueltas += count ?? 0;
  }
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: devueltas, aviso: avisoSeQuedan(sepR.intocables) || undefined };
}

// Restaurar EN GRUPO (pedido fundador 2026-09-02): en Juzgadas se pueden
// seleccionar algunas o todas y cambiarles el juicio de una — vuelven a
// 'pendiente'. Guard: solo desde rechazado/descartado (jamás resucita emitidas
// ni degrada aprobadas).
export async function restaurarPropuestas(
  propuestaIds: string[]
): Promise<{ ok?: boolean; error?: string; count: number; aviso?: string }> {
  if (propuestaIds.length === 0) return { ok: true, count: 0 };
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  const gestoN = propuestaIds.length; // tamaño del gesto (sello), antes del guard
  // Guard de retroceso (incidente MH 2026-09-29): lo emitido / a medias / en vuelo no se mueve.
  const sepR = await clasificarIntocables(ctx.sb, ctx.empresaId, propuestaIds);
  if ("error" in sepR) return { error: sepR.error, count: 0 };
  const tocables = sepR.tocables;
  if (tocables.length === 0) return { error: resumenRetroceso(0, "movidas", sepR.intocables), count: 0 };
  let restauradas = 0;
  const lote = nuevoLote();
  const canal = canalDeOrigen(undefined, gestoN);
  for (let i = 0; i < tocables.length; i += BATCH_SIZE) {
    const batch = tocables.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "pendiente", ...selloDe(ctx, canal, gestoN, lote) }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      .in("estado", ["rechazado", "descartado"]);
    if (error) return { error: error.message, count: restauradas };
    restauradas += count ?? 0;
  }
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: restauradas, aviso: avisoSeQuedan(sepR.intocables) || undefined };
}

// Devolver cartola (espejo de aprobarCartola, pedido fundador 2026-09-01): desde
// la pestaña Emitir, la cartola COMPLETA retrocede un paso — 'aprobado' → 'listo'.
// Devolver es "me arrepentí de enviar", no "me arrepentí del juicio": las juzgadas
// (rechazadas) no se tocan, y las listas quedan de nuevo esperando el Aprobar.
//
// LO YA EMITIDO NO VUELVE (incidente MH 2026-09-29): una emitida sigue en
// 'aprobado' (la verdad es boletas_emitidas.propuesta_id), así que devolver "todas
// las aprobado" bajaba también las 103 con folio real → Check mostraba 684
// pendientes y la clienta casi las cargó a mano (eso sí duplica). Ahora se quedan
// donde están las emitidas, las a medias / sin respuesta (lápidas) y las que se
// están emitiendo en este momento. Fail-closed si no se puede verificar.
export async function devolverCartola(
  documentoId: string
): Promise<{ ok?: boolean; error?: string; count: number; seQuedan?: { emitidas: number; aMedias: number; enVuelo: number }; resumen?: string }> {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  // Paginado: PostgREST corta en max-rows (1000) sin avisar; una cartola grande
  // dejaba aprobadas sin devolver y el resumen mentía.
  const ids: string[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data: props, error: qErr } = await ctx.sb
      .from("propuestas_ia")
      .select("id, movimientos_raw!inner(documento_id)")
      .eq("empresa_id", ctx.empresaId)
      .eq("estado", "aprobado")
      .eq("movimientos_raw.documento_id", documentoId)
      .order("id")
      .range(desde, desde + 999);
    if (qErr) return { error: qErr.message, count: 0 };
    ids.push(...(props ?? []).map((p) => p.id as string));
    if ((props ?? []).length < 1000) break;
  }
  if (ids.length === 0) return { ok: true, count: 0 };
  const sep = await clasificarIntocables(ctx.sb, ctx.empresaId, ids);
  if ("error" in sep) return { error: sep.error, count: 0 };
  const seQuedan = contarIntocables(sep.intocables);
  let devueltas = 0;
  const lote = nuevoLote();
  for (let i = 0; i < sep.tocables.length; i += BATCH_SIZE) {
    const batch = sep.tocables.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "listo", ...selloDe(ctx, "devolver_cartola", ids.length, lote) }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      // Guard: solo degrada 'aprobado'. Jamás toca emitidas/rechazadas.
      .eq("estado", "aprobado");
    if (error) return { error: error.message, count: devueltas };
    devueltas += count ?? 0;
  }
  const resumen = resumenRetroceso(devueltas, "devueltas a Check", sep.intocables);
  await recordCuentaAudit({
    sb: ctx.sb, empresaId: ctx.empresaId, usuarioId: ctx.userId,
    accion: "cartola_devuelta_a_check", recursoTipo: "documento_subido", recursoId: documentoId,
    resumen: `${resumen} (las devueltas quedan listas)`,
    metadata: { cantidad: devueltas, documentoId, se_quedan_emitidas: seQuedan.emitidas, se_quedan_a_medias: seQuedan.aMedias, se_quedan_en_vuelo: seQuedan.enVuelo },
  });
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  return { ok: true, count: devueltas, seQuedan, resumen };
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
): Promise<{ ok?: boolean; error?: string; count: number; aviso?: string }> {
  const ctx = await getEmpresaAndService();
  if ("error" in ctx) return { error: ctx.error, count: 0 };
  const { data: props, error: qErr } = await ctx.sb
    .from("propuestas_ia")
    .select("id, movimientos_raw!inner(documento_id)")
    .eq("empresa_id", ctx.empresaId)
    .eq("estado", "listo")
    .eq("movimientos_raw.documento_id", documentoId);
  if (qErr) return { error: qErr.message, count: 0 };
  const todas = (props ?? []).map((p) => p.id);
  if (todas.length === 0) return { ok: true, count: 0 };
  // Las terminadas (emitida / a medias) que quedaron en 'listo' por un retroceso
  // viejo no se tocan (fundador 2026-09-29: "las emitidas nunca vuelven"): Check ya
  // no las cuenta como listas, así que el conteo del toast calza con el botón.
  const sep = await clasificarIntocables(ctx.sb, ctx.empresaId, todas);
  if ("error" in sep) return { error: sep.error, count: 0 };
  const ids = sep.tocables;
  let aprobadas = 0;
  const lote = nuevoLote();
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const { error, count } = await ctx.sb
      .from("propuestas_ia")
      .update({ estado: "aprobado", ...selloDe(ctx, "aprobar_cartola", todas.length, lote) }, { count: "exact" })
      .eq("empresa_id", ctx.empresaId)
      .in("id", batch)
      .eq("estado", "listo")
      // Un «¿?» que quedó 'listo' (de antes del destino único) no viaja a Emitir.
      .not("tipo_propuesto", "in", PG_TIPOS_POR_DECIDIR)
      .or(PG_OR_SIN_CONFLICTO_MARCA);
    if (error) return { error: error.message, count: aprobadas };
    aprobadas += count ?? 0;
  }
  await recordCuentaAudit({
    sb: ctx.sb, empresaId: ctx.empresaId, usuarioId: ctx.userId,
    accion: "propuestas_aprobadas", recursoTipo: "documento_subido", recursoId: documentoId,
    resumen: `${aprobadas} propuestas de cartola enviadas a emitir`, metadata: { cantidad: aprobadas, documentoId },
  });
  // "Aprobar cartola" en bloque NO confirma el mapa de columnas (adversarial-2
  // A4): aprobar todo sin mirar no es prueba. Solo la aprobación fila a fila.
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  const porDecidir = aprobadas < ids.length ? await contarPorDecidir(ctx.sb, ctx.empresaId, ids) : 0;
  const aviso = [avisoSeQuedan(sep.intocables), porDecidir > 0 ? avisoPorDecidir(porDecidir) : ""].filter(Boolean).join(" · ");
  return { ok: true, count: aprobadas, ...(aviso ? { aviso } : {}) };
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
  const propUpdate: Record<string, string | number | boolean | null> = { estado: "editado" };
  if (campos.tipo_propuesto !== undefined) propUpdate.tipo_propuesto = campos.tipo_propuesto;
  if (campos.receptor_nombre !== undefined) propUpdate.receptor_nombre = campos.receptor_nombre;
  if (campos.receptor_rut !== undefined) propUpdate.receptor_rut = campos.receptor_rut;
  if (campos.notas !== undefined) propUpdate.notas = campos.notas;

  const { error: propErr, count } = await sb
    .from("propuestas_ia")
    .update({ ...propUpdate, ...selloDe(ctx, "check_detalle", 1) }, { count: "exact" })
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
  const bloqueo = await bloqueoRetroceso(ctx.sb, ctx.empresaId, propuestaId);
  if (bloqueo) return { error: bloqueo };

  // Get the propuesta + movimiento to delete (scoped to empresa)
  const { data: prop } = await ctx.sb
    .from("propuestas_ia")
    .select("id, movimiento_id")
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId)
    .single();

  if (!prop) return { error: "Propuesta no encontrada" };

  // Rastro del borrado (Fase 1 medición): solo conteos, antes de que se vaya.
  const resumen = await resumenPropuestasABorrar(ctx.sb, { empresaId: ctx.empresaId, propuestaId });

  const { error: propErr } = await ctx.sb
    .from("propuestas_ia")
    .delete()
    .eq("empresa_id", ctx.empresaId)
    .eq("id", propuestaId);

  // Candado 2 (trigger PROPUESTA_CON_EMISION): si una emisión arrancó entre el
  // guard y el borrado, la base lo frena — mensaje humano, no el crudo de Postgres.
  if (propErr) return { error: esErrorCandadoBD(propErr) ? MENSAJE_CANDADO_BD_PROPUESTA : propErr.message };

  await ctx.sb
    .from("movimientos_raw")
    .delete()
    .eq("empresa_id", ctx.empresaId)
    .eq("id", prop.movimiento_id);

  await recordCuentaAudit({
    sb: ctx.sb, empresaId: ctx.empresaId, usuarioId: ctx.userId,
    accion: "propuesta_devuelta_a_omitidos", recursoTipo: "propuesta_ia", recursoId: propuestaId,
    resumen: "Propuesta devuelta a omitidos (borrada con su movimiento)",
    metadata: resumen ? { propuestas_resumen: resumen } : {},
  });

  revalidatePath("/revisar");
  revalidatePath("/escritorio");
  revalidatePath("/massdte");
  revalidatePath("/subir");
  return { ok: true };
}
