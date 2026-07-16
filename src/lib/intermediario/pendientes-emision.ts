import type { createClient } from "@/lib/supabase/server";
import { getUmbralIdentificacionClp } from "@/lib/sii/uf";
import type { DocumentoHint } from "@/lib/sii/clasificador-tipo";
import { evaluarEmision } from "@/lib/intermediario/emision-decision";
import { resolverGlosa } from "@/lib/intermediario/armar-boleta";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type EmpresaCtx = { giro: string | null; razon_social: string; tipo_contribuyente: string | null; operacion_default?: DocumentoHint };

const HINTS_OPERACION = new Set(["p2p_cripto", "forex_divisas", "servicios", "ventas", "mixto"]);

// Fuente única en @/lib/sii/tipos-propuesta (compartida con emitir-lote). Se
// re-exporta por compatibilidad con importadores existentes.
export { TIPOS_EMITIBLES } from "@/lib/sii/tipos-propuesta";
import { TIPOS_EMITIBLES } from "@/lib/sii/tipos-propuesta";

/**
 * Lista propuestas tipo boleta aprobadas/editadas que aún NO están emitidas,
 * con clasificación SII + flag listo_emitir + totales. Lógica compartida entre
 * el endpoint /api/intermediaria/pendientes-emision y la carga server de la
 * mesa (page.tsx), para que la pestaña Emitir venga con datos del server como
 * el resto de las pestañas (sin fetch al cliente que recargue cada vez).
 */
export async function getPendientesEmision(
  supabase: Supa,
  empresaId: string,
  empresaCtx: EmpresaCtx,
  range?: { start: string; end: string },
  opts?: { soloAprobado?: boolean },
) {
  // 'editado' es borrador (perdió el Aprobar) y NUNCA es emitible; la cola de Emitir
  // igual lo muestra en "por revisar". El guardarraíl, en cambio, cuenta SOLO lo
  // realmente emitible → soloAprobado excluye 'editado' de raíz.
  const estados = opts?.soloAprobado ? ["aprobado"] : ["aprobado", "editado"];
  let propsQuery = supabase
    .from("propuestas_ia")
    .select(`
      id, tipo_propuesto, receptor_nombre, receptor_rut, receptor_direccion, receptor_comuna, receptor_email, receptor_telefono, medio_pago, notas, monto_neto, iva, total, estado, created_at, cliente_id,
      clientes(id, nombre, rut),
      movimientos_raw(fecha, descripcion, monto, documentos_subidos(id, nombre_archivo, tipo_operacion_hint, created_at, glosa_comun, glosa_activa))
    `)
    .eq("empresa_id", empresaId)
    .in("estado", estados)
    .in("tipo_propuesto", TIPOS_EMITIBLES);
  // Respeta el calendario maestro: solo el periodo visible (created_at de la propuesta), igual que Check.
  if (range) propsQuery = propsQuery.gte("created_at", range.start).lt("created_at", range.end);
  const { data: propuestas, error: pErr } = await propsQuery.order("created_at", { ascending: false });

  if (pErr) throw new Error(pErr.message);

  // IDs de las propuestas candidatas (ya acotadas al rango visible). Las consultas
  // auxiliares se acotan a este conjunto en vez de barrer TODA la historia de la
  // empresa: sin esto crecían sin techo y, al pasar el max-rows de PostgREST (1000),
  // el Set yaEmitidas se truncaba en silencio y boletas YA emitidas reaparecían como
  // "listas para emitir" (el server las bloquea, pero el usuario ve pendientes fantasma).
  const propIds = (propuestas ?? []).map((p) => p.id);

  let yaEmitidas = new Set<string>();
  if (propIds.length > 0) {
    try {
      const { data: emitidas } = await supabase
        .from("boletas_emitidas")
        .select("propuesta_id")
        .eq("empresa_id", empresaId)
        .neq("estado", "anulada")
        .in("propuesta_id", propIds);
      yaEmitidas = new Set((emitidas ?? []).map((e) => e.propuesta_id).filter((id): id is string => typeof id === "string"));
    } catch {
      /* tabla aún no existe — todas son pendientes */
    }
  }

  // Lápidas: propuestas cuya emisión quedó "a medias" (posible folio real sin
  // registrar). NO tienen fila en boletas_emitidas todavía, así que sin este Set
  // reaparecerían como "listas" y el usuario las re-emitiría → doble folio. Se
  // excluyen hasta recuperar el folio (que sube el job a 'completed' y crea la boleta).
  let enRevision = new Set<string>();
  if (propIds.length > 0) {
    try {
      const { data: revJobs } = await supabase
        .from("emision_jobs")
        .select("propuesta_id")
        .eq("empresa_id", empresaId)
        .eq("estado", "revision_pendiente")
        .in("propuesta_id", propIds);
      enRevision = new Set((revJobs ?? []).map((j) => j.propuesta_id).filter((id): id is string => typeof id === "string"));
    } catch {
      /* columna/estado aún no migrado — degrada sin romper */
    }
  }

  // Paso P: decisión humana del tipo (degradado si la columna tipo_dte no está migrada).
  const tipoDteById = new Map<string, 39 | 41>();
  if (propIds.length > 0) {
    try {
      const { data: tdRows, error: tdErr } = await supabase
        .from("propuestas_ia")
        .select("id, tipo_dte")
        .in("id", propIds)
        .not("tipo_dte", "is", null);
      // tipo_dte ya está en los tipos generados; el runtime degrada si la consulta
      // falla (tdErr).
      if (!tdErr && tdRows) {
        for (const r of tdRows) {
          if (r.tipo_dte === 39 || r.tipo_dte === 41) tipoDteById.set(r.id, r.tipo_dte);
        }
      }
    } catch { /* columna tipo_dte aún no migrada */ }
  }

  type PropuestaRaw = NonNullable<typeof propuestas>[number];
  const visibles = (propuestas ?? []).filter((p: PropuestaRaw) => !yaEmitidas.has(p.id) && !enRevision.has(p.id));

  // Umbral 135 UF con la UF del día (fallback a referencial si la API cae).
  const umbralIdentificacionClp = await getUmbralIdentificacionClp();

  // Default de operación de la cuenta: MISMO bias que aplicó el clasificador al
  // procesar, para que sugerencia/balde mostrados coincidan con lo persistido (si no,
  // un item auto-clasificado 41 por el default se mostraría con sugerencia "afecta").
  // Se busca acá una vez (por PK) salvo que el caller ya lo haya provisto.
  let empresaCtxFull: EmpresaCtx = empresaCtx;
  if (empresaCtx.operacion_default === undefined) {
    const { data: empRow } = await supabase.from("empresas").select("operacion_hint_default").eq("id", empresaId).maybeSingle();
    const h = (empRow as { operacion_hint_default?: string | null } | null)?.operacion_hint_default ?? null;
    empresaCtxFull = { ...empresaCtx, operacion_default: h && HINTS_OPERACION.has(h) ? (h as DocumentoHint) : null };
  }

  const patronDia = new Map<string, number>();
  const patronMes = new Map<string, number>();
  for (const p of visibles) {
    const cli = (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) as { id: string } | null;
    const mov = (Array.isArray(p.movimientos_raw) ? p.movimientos_raw[0] : p.movimientos_raw) as { fecha: string } | null;
    const recId = cli?.id ?? p.receptor_nombre ?? "sin-receptor";
    const fechaStr = (mov?.fecha ?? p.created_at).slice(0, 10);
    const yyyymm = fechaStr.slice(0, 7);
    patronDia.set(`${recId}|${fechaStr}`, (patronDia.get(`${recId}|${fechaStr}`) ?? 0) + 1);
    patronMes.set(`${recId}|${yyyymm}`, (patronMes.get(`${recId}|${yyyymm}`) ?? 0) + 1);
  }

  const items = visibles.map((p: PropuestaRaw) => {
    const cliente = (Array.isArray(p.clientes) ? p.clientes[0] : p.clientes) as { id: string; nombre: string; rut: string | null } | null;
    type DocNode = { id: string; nombre_archivo: string; tipo_operacion_hint: string | null; created_at: string | null; glosa_comun: string | null; glosa_activa: boolean | null };
    const mov = (Array.isArray(p.movimientos_raw) ? p.movimientos_raw[0] : p.movimientos_raw) as {
      fecha: string; descripcion: string; monto: number;
      documentos_subidos?: DocNode | DocNode[] | null;
    } | null;
    const docNested = mov?.documentos_subidos;
    const docArr = Array.isArray(docNested) ? docNested[0] : docNested;
    const docHint = (docArr?.tipo_operacion_hint ?? null) as DocumentoHint;
    const total = Number(p.total ?? mov?.monto ?? 0);
    const fecha = (mov?.fecha ?? p.created_at).slice(0, 10);
    const receptor_rut = p.receptor_rut ?? cliente?.rut ?? null;
    const receptor_nombre = p.receptor_nombre ?? cliente?.nombre ?? null;
    const recId = cliente?.id ?? p.receptor_nombre ?? "sin-receptor";

    // Motor de reglas: única fuente de verdad (misma función para cola, backend y carril real).
    const verdict = evaluarEmision(
      {
        estado: p.estado,
        yaEmitida: false, // `visibles` ya excluyó las emitidas
        total,
        descripcion: mov?.descripcion ?? "",
        fecha,
        receptorRut: receptor_rut,
        receptorNombre: receptor_nombre,
        medioPago: p.medio_pago ?? null,
        tipoDtePersistido: tipoDteById.get(p.id) ?? null,
        docHint,
        patron: {
          cantidad_mismo_dia_mismo_receptor: (patronDia.get(`${recId}|${fecha}`) ?? 1) - 1,
          cantidad_mes_mismo_receptor: (patronMes.get(`${recId}|${fecha.slice(0, 7)}`) ?? 1),
        },
      },
      { empresa: empresaCtxFull, umbralIdentificacionClp },
    );

    const primer = verdict.bloqueos[0] ?? verdict.advertencias[0] ?? null;
    const code0 = verdict.bloqueos[0]?.code;
    const motivo_code: "no_boletar" | "monto_invalido" | "falta_receptor" | null =
      code0 === "NO_BOLETAR" ? "no_boletar"
        : code0 === "MONTO_TOTAL_INVALIDO" || code0 === "AFECTA_IVA_CERO" ? "monto_invalido"
          : (code0 === "RECEPTOR_RUT_OBLIGATORIO" || code0 === "RECEPTOR_RAZON_SOCIAL_OBLIGATORIA" || code0 === "MEDIO_PAGO_OBLIGATORIO") ? "falta_receptor"
            : null;

    return {
      id: p.id,
      descripcion: mov?.descripcion ?? "Sin descripción",
      fecha,
      receptor_rut,
      receptor_nombre,
      // Campos del receptor + medio de pago para que el motor masivo arme el MISMO
      // payload que boleta única (buildBoletaJob) desde la propuesta ya aprobada.
      // MINIMIZACIÓN por monto (Ley 19.628 / Res. 44/2025): bajo el umbral de
      // identificación (135 UF) la identidad/contacto del receptor NO se conserva.
      // RED en el punto de emisión: cubre propuestas VIEJAS que guardaron los 4
      // campos crudos antes de que el insert los minimizara.
      receptor_direccion: total >= umbralIdentificacionClp ? (p.receptor_direccion ?? null) : null,
      receptor_comuna: total >= umbralIdentificacionClp ? (p.receptor_comuna ?? null) : null,
      receptor_email: total >= umbralIdentificacionClp ? (p.receptor_email ?? null) : null,
      receptor_telefono: total >= umbralIdentificacionClp ? (p.receptor_telefono ?? null) : null,
      medio_pago: p.medio_pago ?? null,
      // Glosa YA SEGURA (misma política que el lote mock, resolverGlosa: editado ›
      // común › genérico, NUNCA la glosa cruda del banco). Solo viaja el string
      // final — las fuentes crudas (notas/glosa_comun) no salen del server.
      detalle: resolverGlosa(
        { notas: p.notas, glosaComun: docArr?.glosa_comun, glosaComunActiva: docArr?.glosa_activa },
        verdict.tipoDte ?? undefined,
      ),
      monto_total: total,
      balde: verdict.balde,
      listo_emitir: verdict.puedeEmitir,
      bloqueos: verdict.bloqueos,
      advertencias: verdict.advertencias,
      motivo_no_listo: verdict.balde !== "listas" ? (primer?.msg ?? null) : null,
      motivo_code,
      tipo_sugerido: verdict.tipoDte,
      sugerencia: verdict.sugerencia,
      confianza_clasif: Math.round(verdict.confianzaTipo * 100) / 100,
      razones: verdict.razones,
      documento_id: docArr?.id ?? null,
      documento_nombre: docArr?.nombre_archivo ?? null,
      documento_created_at: docArr?.created_at ?? null,
    };
  });

  const totales = {
    total_pendientes: items.length,
    listas_emitir: items.filter((i) => i.balde === "listas").length,
    por_revisar: items.filter((i) => i.balde === "por_revisar").length,
    bloqueadas: items.filter((i) => i.balde === "bloqueadas").length,
    monto_total: items.reduce((s, i) => s + i.monto_total, 0),
    monto_listo: items.filter((i) => i.balde === "listas").reduce((s, i) => s + i.monto_total, 0),
  };

  let aprobadas_otros_tipos: Record<string, number> = {};
  if (items.length === 0) {
    const { data: otras } = await supabase
      .from("propuestas_ia")
      .select("tipo_propuesto")
      .eq("empresa_id", empresaId)
      .in("estado", ["aprobado", "editado"])
      .not("tipo_propuesto", "in", `(${TIPOS_EMITIBLES.map((t) => `"${t}"`).join(",")})`);
    if (otras) {
      aprobadas_otros_tipos = otras.reduce((acc: Record<string, number>, r) => {
        const t = r.tipo_propuesto || "desconocido";
        acc[t] = (acc[t] ?? 0) + 1;
        return acc;
      }, {});
    }
  }

  return { items, totales, aprobadas_otros_tipos };
}
