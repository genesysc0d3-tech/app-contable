import type { createClient } from "@/lib/supabase/server";
import { getUmbralIdentificacionClp } from "@/lib/sii/uf";
import type { DocumentoHint } from "@/lib/sii/clasificador-tipo";
import { evaluarEmision } from "@/lib/intermediario/emision-decision";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type EmpresaCtx = { giro: string | null; razon_social: string; tipo_contribuyente: string | null };

/**
 * Tipos de propuesta IA que representan INGRESOS boletificables. Facturas,
 * gastos, no comerciales y honorarios quedan fuera.
 */
export const TIPOS_EMITIBLES = ["boleta", "exenta", "transferencia_p2p", "compraventa_crypto", "operacion_forex"];

/**
 * Lista propuestas tipo boleta aprobadas/editadas que aún NO están emitidas,
 * con clasificación SII + flag listo_emitir + totales. Lógica compartida entre
 * el endpoint /api/intermediaria/pendientes-emision y la carga server de la
 * mesa (page.tsx), para que la pestaña Emitir venga con datos del server como
 * el resto de las pestañas (sin fetch al cliente que recargue cada vez).
 */
export async function getPendientesEmision(supabase: Supa, empresaId: string, empresaCtx: EmpresaCtx) {
  const { data: propuestas, error: pErr } = await supabase
    .from("propuestas_ia")
    .select(`
      id, tipo_propuesto, receptor_nombre, receptor_rut, monto_neto, iva, total, estado, created_at, cliente_id,
      clientes(id, nombre, rut),
      movimientos_raw(fecha, descripcion, monto, documentos_subidos(id, nombre_archivo, tipo_operacion_hint, created_at))
    `)
    .eq("empresa_id", empresaId)
    .in("estado", ["aprobado", "editado"])
    .in("tipo_propuesto", TIPOS_EMITIBLES)
    .order("created_at", { ascending: false });

  if (pErr) throw new Error(pErr.message);

  let yaEmitidas = new Set<string>();
  try {
    const { data: emitidas } = await supabase
      .from("boletas_emitidas")
      .select("propuesta_id")
      .eq("empresa_id", empresaId)
      .neq("estado", "anulada")
      .not("propuesta_id", "is", null);
    yaEmitidas = new Set((emitidas ?? []).map((e) => e.propuesta_id).filter((id): id is string => typeof id === "string"));
  } catch {
    /* tabla aún no existe — todas son pendientes */
  }

  type PropuestaRaw = NonNullable<typeof propuestas>[number];
  const visibles = (propuestas ?? []).filter((p: PropuestaRaw) => !yaEmitidas.has(p.id));

  // Umbral 135 UF con la UF del día (fallback a referencial si la API cae).
  const umbralIdentificacionClp = await getUmbralIdentificacionClp();

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
    const mov = (Array.isArray(p.movimientos_raw) ? p.movimientos_raw[0] : p.movimientos_raw) as {
      fecha: string; descripcion: string; monto: number;
      documentos_subidos?: { id: string; nombre_archivo: string; tipo_operacion_hint: string | null; created_at: string | null } | { id: string; nombre_archivo: string; tipo_operacion_hint: string | null; created_at: string | null }[] | null;
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
        docHint,
        patron: {
          cantidad_mismo_dia_mismo_receptor: (patronDia.get(`${recId}|${fecha}`) ?? 1) - 1,
          cantidad_mes_mismo_receptor: (patronMes.get(`${recId}|${fecha.slice(0, 7)}`) ?? 1),
        },
      },
      { empresa: empresaCtx, umbralIdentificacionClp },
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
