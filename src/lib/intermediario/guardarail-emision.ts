import type { createClient } from "@/lib/supabase/server";
import { getPendientesEmision, type EmpresaCtx } from "./pendientes-emision";
import { clasificarBucketsVenta, type ResumenCierre } from "@/lib/sii/estado-cierre";

type Supa = Awaited<ReturnType<typeof createClient>>;

export interface GuardarailEmision {
  /** Buckets por mes de venta con estado/urgencia (ver estado-cierre.ts). */
  resumen: ResumenCierre;
  /** Boletas pendientes que NO están listas (necesitan revisión) — se avisan aparte, no en el héroe. */
  porRevisar: number;
  /** El universo tocó el techo de PostgREST (1000) → mostrar "parcial" en vez de mentir por omisión. */
  truncado: boolean;
}

/**
 * Datos del guardarraíl de emisión: agrupa las boletas emitibles por el MES DE LA
 * VENTA (no de subida) y las clasifica con el motor puro. Reusa getPendientesEmision
 * SIN rango (toda la historia) + soloAprobado, para no duplicar la lógica de
 * yaEmitidas/evaluarEmision/tipo y no divergir del resto de la app.
 *
 * `hoy` = "YYYY-MM-DD" en zona Chile (chileDateString), inyectado por el caller.
 */
export async function computeGuardarailEmision(
  supabase: Supa,
  empresaId: string,
  empresaCtx: EmpresaCtx,
  hoy: string,
): Promise<GuardarailEmision> {
  const { items } = await getPendientesEmision(supabase, empresaId, empresaCtx, undefined, { soloAprobado: true });

  // Solo "listas": las que el motor de reglas ya dio por emitibles. Las bloqueadas /
  // por revisar (falta receptor sobre umbral, monto 0, etc.) NO inflan el "por emitir".
  const listas = items.filter((i) => i.balde === "listas");

  const pendientes = listas.map((i) => ({
    id: i.id,
    fechaVenta: i.fecha, // "YYYY-MM-DD" — fecha REAL de la venta (mov.fecha con fallback a created_at)
    // El bucket de urgencia mira la naturaleza fiscal, no el documento: una
    // factura afecta (33) urge como la boleta afecta (39) — es IVA del mismo
    // período — y la exenta (34) como la 41.
    tipoDte: (i.tipo_sugerido === 33 ? 39 : i.tipo_sugerido === 34 ? 41 : i.tipo_sugerido) as 39 | 41 | null,
    monto: i.monto_total,
  }));

  // Belt-and-suspenders con el motor: si el contribuyente es exento, toda venta se
  // trata como 41 aunque el tipo venga 39 (evita falso positivo de urgencia de IVA).
  const empresaExenta = (empresaCtx.tipo_contribuyente ?? "").toLowerCase() === "exento";

  const resumen = clasificarBucketsVenta(pendientes, { hoy, empresaExenta });

  return {
    resumen,
    porRevisar: items.length - listas.length,
    truncado: items.length >= 1000,
  };
}
