import type { CensoCartola } from "@/lib/parsers/types";

/**
 * CUADRE DE CARTOLA — invariante final del procesamiento.
 *
 * Toda fila de la hoja con plata termina en exactamente uno de estos lados:
 *   - guardada (movimiento en la mesa),
 *   - duplicado declarado (el visor de duplicados ya se lo muestra al cliente),
 *   - descarte legítimo (fila de totales/saldos),
 *   - PERDIDA.
 * Las pérdidas eran silenciosas (LC 2026-09-27: 2 abonos por $250.000 que nadie
 * vio). Este módulo no arregla nada: hace que ninguna pérdida pase sin que se vea.
 * Puro, sin DB: el procesador le pasa lo que leyó, lo que guardó y lo que la DB
 * confirma.
 */

export interface FilaLeida {
  excel_row?: number | null;
  fecha: string;
  monto: number;
  tipo_flujo: string;
  descripcion?: string | null;
}

export interface Perdida {
  excel_row: number | null;
  fecha: string | null;
  monto: number;
  tipo_flujo: string | null;
  motivo: string;
  descripcion: string;
  /** El cliente la agregó a la mesa desde el visor (botón "Agregarlos"). */
  agregada?: { movimiento_id: string; en: string };
}

/**
 * Reserva de la recuperación en curso: ids decididos ANTES de insertar, para que
 * apretar dos veces (o reintentar tras un corte) reuse los mismos ids y jamás
 * duplique un movimiento. Ver lib/cartola/cuadre-mesa.ts.
 */
export interface RecuperacionEnCurso {
  desde: string;
  filas: { idx: number; movimiento_id: string; propuesta_id: string }[];
}

export interface CuadreCartola {
  ok: boolean;
  hoja: string;
  filas_con_monto: number;
  guardadas: number;
  duplicadas: number;
  descartes_legitimos: number;
  perdidas: Perdida[];
  monto_perdido: number;
  abonos: number;
  cargos: number;
  otras_hojas_con_datos: string[];
  /** La DB confirma lo guardado: movimientos y 1 propuesta por movimiento. */
  db: { movimientos: number; propuestas: number; ok: boolean };
  calculado_en: string;
  recuperacion?: RecuperacionEnCurso;
}

export function calcularCuadre(args: {
  censo: CensoCartola;
  leidas: FilaLeida[];
  /** excel_row de las filas efectivamente insertadas. */
  filasGuardadas: (number | null | undefined)[];
  /** excel_row de los duplicados que el cliente ya ve en el visor. */
  filasDuplicadas: (number | null | undefined)[];
  db: { movimientos: number; propuestas: number };
  ahora?: Date;
}): CuadreCartola {
  const { censo, leidas } = args;
  const guardadas = new Set(args.filasGuardadas.filter((x): x is number => typeof x === "number"));
  const duplicadas = new Set(args.filasDuplicadas.filter((x): x is number => typeof x === "number"));

  const perdidas: Perdida[] = [];

  // 1) Lo que el lector no convirtió en movimiento (y no es una fila de totales).
  for (const d of censo.descartes) {
    if (d.legitimo) continue;
    perdidas.push({
      excel_row: d.excel_row, fecha: d.fecha, monto: d.monto, tipo_flujo: d.tipo_flujo,
      motivo: d.motivo, descripcion: d.descripcion,
    });
  }

  // 2) Lo que el lector leyó y el procesador no guardó ni declaró duplicado.
  for (const l of leidas) {
    const row = typeof l.excel_row === "number" ? l.excel_row : null;
    if (row != null && (guardadas.has(row) || duplicadas.has(row))) continue;
    perdidas.push({
      excel_row: row, fecha: l.fecha, monto: Number(l.monto) || 0, tipo_flujo: l.tipo_flujo,
      motivo: "no_guardada", descripcion: String(l.descripcion ?? ""),
    });
  }

  // 3) La DB tiene que confirmar lo guardado (un insert parcial, un delete previo
  //    que falló o una propuesta que no nació también son pérdidas o sobrantes).
  const dbOk = args.db.movimientos === guardadas.size && args.db.propuestas === args.db.movimientos;

  const abonos = leidas.filter((l) => l.tipo_flujo === "entrada").reduce((s, l) => s + (Number(l.monto) || 0), 0);
  const cargos = leidas.filter((l) => l.tipo_flujo === "salida").reduce((s, l) => s + (Number(l.monto) || 0), 0);

  return {
    // Otra hoja con datos es un AVISO (puede ser una hoja de trabajo del
    // cliente), no un descuadre de la hoja leída.
    ok: perdidas.length === 0 && dbOk,
    hoja: censo.hoja,
    filas_con_monto: censo.filas_con_monto,
    guardadas: guardadas.size,
    duplicadas: duplicadas.size,
    descartes_legitimos: censo.descartes.filter((d) => d.legitimo).length,
    perdidas,
    monto_perdido: perdidas.reduce((s, p) => s + p.monto, 0),
    abonos,
    cargos,
    otras_hojas_con_datos: censo.otras_hojas_con_datos,
    db: { ...args.db, ok: dbOk },
    calculado_en: (args.ahora ?? new Date()).toISOString(),
  };
}

/** Versión sin glosa (PII de terceros) para ops_events — Ley 21.719. */
export function cuadreParaOps(c: CuadreCartola) {
  return {
    hoja: c.hoja,
    filas_con_monto: c.filas_con_monto,
    guardadas: c.guardadas,
    duplicadas: c.duplicadas,
    monto_perdido: c.monto_perdido,
    perdidas: c.perdidas.map(({ excel_row, fecha, monto, tipo_flujo, motivo }) => ({ excel_row, fecha, monto, tipo_flujo, motivo })),
    otras_hojas_con_datos: c.otras_hojas_con_datos.length,
    db: c.db,
  };
}
