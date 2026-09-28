import type { CuadreCartola, Perdida, RecuperacionEnCurso } from "./cuadre";

/**
 * CUADRE EN LA MESA (pasos 2 y 3 del cuadre de cartola).
 *
 * El paso 1 (processor) deja `progreso_ia.cuadre` en el documento. Acá vive,
 * puro y testeable, todo lo que la mesa hace con eso:
 *   - `resumenCuadre`: lo que el visor muestra ("500 de 500 filas" o
 *     "Faltan 2 por $250.000" con la lista).
 *   - `planAgregar` / `movimientoRecuperado` / `propuestaRecuperada` /
 *     `marcarAgregadas`: el botón "Agregarlos" que devuelve a la mesa las
 *     filas con plata que se habían perdido, como pendientes de revisar.
 *
 * Idempotencia: los ids de lo que se va a insertar se deciden ANTES y quedan
 * reservados en `cuadre.recuperacion`; un segundo click o un reintento reusa
 * esos mismos ids (upsert que ignora el repetido) y nunca duplica.
 */

export type MotivoPerdida = Perdida["motivo"];

const MOTIVOS: Record<string, string> = {
  no_guardada: "No llegó a la mesa",
  sin_fecha: "Sin fecha",
  fecha_ilegible: "Fecha ilegible",
  tipo_desconocido: "No se sabe si es abono o cargo",
  cargo_y_abono: "Trae cargo y abono a la vez",
};

export function motivoTexto(motivo: string): string {
  return MOTIVOS[motivo] ?? "No llegó a la mesa";
}

/** Lee el cuadre de `progreso_ia` sin confiar en la forma (JSON de la DB). */
export function leerCuadre(progresoIa: unknown): CuadreCartola | null {
  if (!progresoIa || typeof progresoIa !== "object") return null;
  const c = (progresoIa as { cuadre?: unknown }).cuadre;
  if (!c || typeof c !== "object") return null;
  const q = c as Partial<CuadreCartola>;
  if (!Array.isArray(q.perdidas) || typeof q.guardadas !== "number") return null;
  return {
    ok: q.ok === true,
    hoja: String(q.hoja ?? ""),
    filas_con_monto: Number(q.filas_con_monto) || 0,
    guardadas: q.guardadas,
    duplicadas: Number(q.duplicadas) || 0,
    descartes_legitimos: Number(q.descartes_legitimos) || 0,
    perdidas: q.perdidas as Perdida[],
    monto_perdido: Number(q.monto_perdido) || 0,
    abonos: Number(q.abonos) || 0,
    cargos: Number(q.cargos) || 0,
    otras_hojas_con_datos: Array.isArray(q.otras_hojas_con_datos) ? q.otras_hojas_con_datos.map(String) : [],
    db: {
      movimientos: Number(q.db?.movimientos) || 0,
      propuestas: Number(q.db?.propuestas) || 0,
      ok: q.db?.ok !== false,
    },
    calculado_en: String(q.calculado_en ?? ""),
    ...(q.recuperacion && Array.isArray(q.recuperacion.filas) ? { recuperacion: q.recuperacion } : {}),
  };
}

/** Fecha ISO real (rechaza "2026-13-32": la fecha de una fila perdida viene cruda). */
export function fechaIsoValida(f: string | null | undefined): f is string {
  if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const d = new Date(`${f}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

/** Una fila se puede agregar sola si trae fecha real, dirección y plata. */
export function esAgregable(p: Perdida): boolean {
  return fechaIsoValida(p.fecha)
    && (p.tipo_flujo === "entrada" || p.tipo_flujo === "salida")
    && Number(p.monto) > 0;
}

export function glosaDe(p: Pick<Perdida, "descripcion" | "tipo_flujo">): string {
  const g = String(p.descripcion ?? "").trim();
  if (g) return g;
  return p.tipo_flujo === "salida" ? "Cargo sin glosa en la cartola" : "Abono sin glosa en la cartola";
}

export interface FilaFaltante {
  idx: number;
  excelRow: number | null;
  fecha: string | null;
  glosa: string;
  monto: number;
  tipoFlujo: "entrada" | "salida" | null;
  motivo: string;
  agregable: boolean;
}

export interface ResumenCuadre {
  /** cuadra = todo en su lugar · faltan = hay filas con plata fuera · no_calza = la DB no confirma lo guardado. */
  estado: "cuadra" | "faltan" | "no_calza";
  /** Filas con plata de la hoja (sin contar las de totales). */
  esperadas: number;
  /** Las que están en su lugar: en la mesa o declaradas repetidas. */
  enSuLugar: number;
  duplicadas: number;
  faltan: number;
  montoFaltan: number;
  agregables: number;
  abonos: number;
  cargos: number;
  filas: FilaFaltante[];
  otrasHojas: string[];
}

export function pendientesDe(c: CuadreCartola): { p: Perdida; idx: number }[] {
  return c.perdidas.map((p, idx) => ({ p, idx })).filter(({ p }) => !p.agregada);
}

export function resumenCuadre(c: CuadreCartola): ResumenCuadre {
  const pend = pendientesDe(c);
  const filas: FilaFaltante[] = pend.map(({ p, idx }) => ({
    idx,
    excelRow: typeof p.excel_row === "number" ? p.excel_row : null,
    fecha: p.fecha ?? null,
    glosa: glosaDe(p),
    monto: Number(p.monto) || 0,
    tipoFlujo: p.tipo_flujo === "entrada" || p.tipo_flujo === "salida" ? p.tipo_flujo : null,
    motivo: motivoTexto(p.motivo),
    agregable: esAgregable(p),
  }));
  const enSuLugar = c.guardadas + c.duplicadas;
  return {
    estado: filas.length > 0 ? "faltan" : c.db.ok ? "cuadra" : "no_calza",
    esperadas: enSuLugar + filas.length,
    enSuLugar,
    duplicadas: c.duplicadas,
    faltan: filas.length,
    montoFaltan: filas.reduce((s, f) => s + f.monto, 0),
    agregables: filas.filter((f) => f.agregable).length,
    abonos: c.abonos,
    cargos: c.cargos,
    filas,
    otrasHojas: c.otras_hojas_con_datos,
  };
}

/**
 * Qué insertar. Si ya hay una reserva (click anterior, reintento tras un corte)
 * se reusa TAL CUAL: mismos ids → el upsert ignora lo que ya entró.
 */
export function planAgregar(c: CuadreCartola, nuevoId: () => string): RecuperacionEnCurso["filas"] {
  if (c.recuperacion && c.recuperacion.filas.length > 0) {
    return c.recuperacion.filas.filter((f) => c.perdidas[f.idx] && !c.perdidas[f.idx].agregada);
  }
  return pendientesDe(c)
    .filter(({ p }) => esAgregable(p))
    .map(({ idx }) => ({ idx, movimiento_id: nuevoId(), propuesta_id: nuevoId() }));
}

/** Fila de movimientos_raw: la misma forma que guarda el processor. */
export function movimientoRecuperado(p: Perdida, a: { id: string; empresaId: string; documentoId: string }) {
  return {
    id: a.id,
    empresa_id: a.empresaId,
    documento_id: a.documentoId,
    fecha: p.fecha as string,
    descripcion: glosaDe(p),
    monto: Number(p.monto),
    tipo_flujo: p.tipo_flujo as "entrada" | "salida",
    origen: "cartola_preparseada",
    n_documento: null,
  };
}

/**
 * Propuesta de una fila recuperada: nace PENDIENTE y bajo el umbral de
 * "Poner listas" (0.8), así el cliente la mira una por una en Editar como
 * cualquier otra que la IA no pudo decidir. Sin tipo_dte (decisión humana), sin
 * notas (se imprimen en la boleta) y sin identidad de terceros.
 */
export const CONFIANZA_RECUPERADA = 0.5;

export function propuestaRecuperada(
  p: Perdida,
  a: { id: string; movimientoId: string; empresaId: string; mesa: "boleta" | "factura"; exento: boolean },
) {
  const total = Number(p.monto);
  const venta = p.tipo_flujo === "entrada";
  const exento = !venta || a.exento;
  const neto = exento ? total : Math.round(total / 1.19);
  return {
    id: a.id,
    empresa_id: a.empresaId,
    movimiento_id: a.movimientoId,
    mesa: a.mesa,
    estado: "pendiente" as const,
    tipo_propuesto: venta ? (a.exento ? "exenta" : "boleta") : "gasto_egreso",
    tipo_dte: null,
    total,
    monto_neto: neto,
    iva: exento ? 0 : total - neto,
    confianza: CONFIANZA_RECUPERADA,
    receptor_nombre: null,
    receptor_rut: null,
    cliente_id: null,
    notas: null,
    regla_id: null,
    fuente_clasificacion: "cuadre_cartola",
  };
}

/**
 * El cuadre después de agregar: cada fila queda marcada con su movimiento, lo
 * guardado sube, la reserva se libera y el veredicto se recalcula.
 */
export function marcarAgregadas(
  c: CuadreCartola,
  hechas: { idx: number; movimiento_id: string }[],
  ahora: Date = new Date(),
): CuadreCartola {
  const en = ahora.toISOString();
  const porIdx = new Map(hechas.map((h) => [h.idx, h.movimiento_id]));
  const perdidas = c.perdidas.map((p, idx) =>
    !p.agregada && porIdx.has(idx) ? { ...p, agregada: { movimiento_id: porIdx.get(idx)!, en } } : p,
  );
  const n = perdidas.filter((p, idx) => p.agregada && !c.perdidas[idx].agregada).length;
  const guardadas = c.guardadas + n;
  const movimientos = c.db.movimientos + n;
  const propuestas = c.db.propuestas + n;
  const dbOk = movimientos === guardadas && propuestas === movimientos;
  const pendientes = perdidas.filter((p) => !p.agregada);
  const { recuperacion: _r, ...resto } = c;
  void _r;
  return {
    ...resto,
    perdidas,
    guardadas,
    db: { movimientos, propuestas, ok: dbOk },
    monto_perdido: pendientes.reduce((s, p) => s + (Number(p.monto) || 0), 0),
    ok: pendientes.length === 0 && dbOk,
  };
}
