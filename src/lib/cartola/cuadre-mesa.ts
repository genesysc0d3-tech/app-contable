import type { CuadreCartola, Perdida } from "./cuadre";

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
 * Idempotencia: los ids son DETERMINISTAS (lib/cartola/cuadre-ids.ts: uuid v5
 * de documento + fila). Dos clicks, dos pestañas o un reintento tras un corte
 * calculan los mismos ids y el upsert ignora el repetido: nunca duplica.
 */

export type MotivoPerdida = Perdida["motivo"];

const MOTIVOS: Record<string, string> = {
  no_guardada: "No llegó a la mesa",
  sin_fecha: "Sin fecha",
  fecha_ilegible: "Fecha ilegible",
  tipo_desconocido: "No se sabe si es abono o cargo",
  cargo_y_abono: "Trae cargo y abono a la vez",
  fecha_imposible: "Fecha imposible",
  fecha_fuera_de_rango: "Fecha fuera de rango",
  monto_ambiguo: "Monto en un formato dudoso",
  sin_leer: "Tiene plata en una columna que no leímos",
};

/** Motivos que SÍ se pueden agregar solos: la fila se leyó bien y solo no llegó a
 *  la mesa. Lista blanca: un motivo nuevo (p.ej. una fecha dudosa) nunca se cuela. */
const MOTIVOS_AGREGABLES = new Set(["no_guardada"]);

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
    // Campos del sello (2026-09-30). Cuadres viejos no los traen: quedan fuera.
    ...(q.verificacion && typeof q.verificacion === "object" && typeof q.verificacion.tipo === "string"
      ? { verificacion: { tipo: q.verificacion.tipo, detalle: String(q.verificacion.detalle ?? ""), ...(q.verificacion.alerta ? { alerta: true } : {}) } }
      : {}),
    ...(typeof q.saldo_inicial === "number" ? { saldo_inicial: q.saldo_inicial } : {}),
    ...(typeof q.saldo_final === "number" ? { saldo_final: q.saldo_final } : {}),
    ...(q.cuenta && typeof q.cuenta === "object" ? { cuenta: { huella: String(q.cuenta.huella ?? ""), sufijo: String(q.cuenta.sufijo ?? "") } } : {}),
    ...(Array.isArray(q.muestra) ? { muestra: q.muestra.slice(0, 3) } : {}),
    ...(q.mapa && typeof q.mapa === "object" ? { mapa: q.mapa } : {}),
    ...(q.guardado && typeof q.guardado === "object" ? { guardado: { n: Number(q.guardado.n) || 0, entradas: Number(q.guardado.entradas) || 0, salidas: Number(q.guardado.salidas) || 0 } } : {}),
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
  // Revisión final 2026-09-28: una fila "fecha_fuera_de_rango" trae una ISO válida
  // (1999, 2091) y se agregaba con esa fecha falsa. Solo motivos de la lista blanca.
  return MOTIVOS_AGREGABLES.has(p.motivo)
    && fechaIsoValida(p.fecha)
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

export interface FilaPlan { idx: number; movimiento_id: string; propuesta_id: string }

/** Clave estable de una fila perdida dentro de su documento (base de los ids). */
export function claveFila(p: Perdida, idx: number): string {
  return typeof p.excel_row === "number" ? `fila:${p.excel_row}` : `idx:${idx}`;
}

/**
 * Qué insertar: las pendientes que se pueden agregar solas, con los ids que da
 * `idsDe` (deterministas en producción, así el upsert es idempotente).
 */
export function planAgregar(
  c: CuadreCartola,
  idsDe: (clave: string) => { movimiento_id: string; propuesta_id: string },
): FilaPlan[] {
  return pendientesDe(c)
    .filter(({ p }) => esAgregable(p))
    .map(({ p, idx }) => ({ idx, ...idsDe(claveFila(p, idx)) }));
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
 * Propuesta de una fila recuperada: la MISMA propuesta neutra que el processor
 * sintetiza cuando nadie clasificó el movimiento (fallback de OpenCode en
 * processor.ts): abono -> no_comercial, cargo -> gasto_egreso, IVA 0,
 * confianza 0.4. Nada de "boleta afecta" por defecto (incidente P2P->afecta
 * 2026-09-24): una fila recuperada puede ser un traspaso propio o P2P, así que
 * decide el cliente en Editar. Pendiente, bajo "Poner listas" (0.8), sin
 * tipo_dte, sin notas (se imprimen en la boleta) y sin identidad de terceros.
 */
export const CONFIANZA_RECUPERADA = 0.4;

export function propuestaRecuperada(
  p: Perdida,
  a: { id: string; movimientoId: string; empresaId: string; mesa: "boleta" | "factura" },
) {
  const total = Number(p.monto);
  return {
    id: a.id,
    empresa_id: a.empresaId,
    movimiento_id: a.movimientoId,
    mesa: a.mesa,
    estado: "pendiente" as const,
    tipo_propuesto: p.tipo_flujo === "salida" ? "gasto_egreso" : "no_comercial",
    tipo_dte: null,
    total,
    monto_neto: total,
    iva: 0,
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
 * guardado sube y el veredicto se recalcula. Lo ya marcado no vuelve a sumar
 * (dos pestañas que terminan a la vez escriben el mismo resultado).
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
  return {
    ...c,
    perdidas,
    guardadas,
    db: { movimientos, propuestas, ok: dbOk },
    monto_perdido: pendientes.reduce((s, p) => s + (Number(p.monto) || 0), 0),
    ok: pendientes.length === 0 && dbOk,
  };
}
