// El servidor manda en los datos (seguridad de emisión 2026-09-30, adversarial H3 y
// mesa §2.1).
//
// El lote arma lo que se teclea en el SII (monto, tipo, receptor, glosa) desde el
// estado de la mesa en el NAVEGADOR (EmitirLoteModal → useEmisionLote). Una pestaña
// vieja, un evento Realtime perdido o un lote largo (la foto es del inicio) podían
// emitir un documento DISTINTO al aprobado: no doble, pero plata mal declarada. El POST
// de /api/emision/jobs ahora recibe esos datos y los compara contra la propuesta
// guardada; si no calzan → 409 DATOS_CAMBIARON y el lote se frena (lo que falta queda
// para reanudar con datos frescos).
//
// Se recalcula EXACTAMENTE lo que arma pendientes-emision.ts (fuente de la mesa):
//   monto   = total ?? movimiento.monto
//   receptor= receptor_rut ?? cliente.rut
//   glosa   = boleta: resolverGlosa(notas › glosa común activa › genérico)
//             factura: detalle || "Servicios profesionales"
//   tipo    = el persistido manda (Paso P); sin persistido es veredicto del motor
//             (patrones del día, UF…): no se puede recalcular acá y se acepta el del
//             cliente, pero nunca un tipo de la otra mesa.

import { GLOSA_FALLBACK, GLOSA_FALLBACK_EXENTA, resolverGlosa } from "@/lib/intermediario/armar-boleta";

export const SELECT_PROPUESTA_DATOS =
  "id, empresa_id, estado, mesa, tipo_dte, total, notas, detalle, receptor_rut, clientes(rut), movimientos_raw(monto, documentos_subidos(glosa_comun, glosa_activa))";

type Uno<T> = T | T[] | null | undefined;
const uno = <T>(v: Uno<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export type PropuestaDatos = {
  mesa: string | null;
  tipo_dte: number | null;
  total: number | string | null;
  notas: string | null;
  detalle: string | null;
  receptor_rut: string | null;
  clientes: Uno<{ rut: string | null }>;
  movimientos_raw: Uno<{ monto: number | string | null; documentos_subidos?: Uno<{ glosa_comun: string | null; glosa_activa: boolean | null }> }>;
};

export type DatosJobEnviados = { monto: number; receptor_rut: string | null; glosa: string };

export type CampoDatos = "monto" | "tipo_dte" | "receptor_rut" | "glosa";

/** Lo que el lote manda en `datos`: los MISMOS campos que van al payload de la extensión. */
export function datosParaJob(item: { monto: number; receptorRut?: string | null; detalle: string }): DatosJobEnviados {
  return { monto: item.monto, receptor_rut: item.receptorRut ?? null, glosa: item.detalle };
}

/** Lee `payload.datos`. null = el navegador no los mandó (JS viejo) o vienen mal. */
export function leerDatosEnviados(raw: unknown): DatosJobEnviados | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const monto = Number(r.monto);
  if (typeof r.monto !== "number" || !Number.isFinite(monto)) return null;
  if (typeof r.glosa !== "string") return null;
  const rut = r.receptor_rut;
  if (rut != null && typeof rut !== "string") return null;
  return { monto, receptor_rut: (rut as string | null | undefined) ?? null, glosa: r.glosa };
}

const normRut = (v: string | null | undefined) => (v ?? "").replace(/[^0-9kK]/g, "").toUpperCase();
const normTexto = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

const FAMILIA: Record<string, number[]> = { boleta: [39, 41], factura: [33, 34] };

export function compararDatosJob(
  prop: PropuestaDatos,
  tipoDtePedido: number,
  enviado: DatosJobEnviados,
): { ok: true } | { ok: false; campos: CampoDatos[] } {
  const campos: CampoDatos[] = [];
  const mov = uno(prop.movimientos_raw);
  const doc = uno(mov?.documentos_subidos);
  const cliente = uno(prop.clientes);

  const monto = Number(prop.total ?? mov?.monto ?? 0);
  if (Math.round(monto) !== Math.round(enviado.monto)) campos.push("monto");

  const familia = prop.mesa ? FAMILIA[prop.mesa] : undefined;
  const tipoPersistido = prop.tipo_dte != null && familia?.includes(prop.tipo_dte) ? prop.tipo_dte : null;
  if ((familia && !familia.includes(tipoDtePedido)) || (tipoPersistido != null && tipoPersistido !== tipoDtePedido)) {
    campos.push("tipo_dte");
  }

  if (normRut(prop.receptor_rut ?? cliente?.rut ?? null) !== normRut(enviado.receptor_rut)) campos.push("receptor_rut");

  const glosaEnviada = normTexto(enviado.glosa);
  let glosaOk: boolean;
  if (prop.mesa === "factura") {
    glosaOk = glosaEnviada === normTexto(normTexto(prop.detalle) || "Servicios profesionales");
  } else {
    const tipo = tipoDtePedido === 41 ? 41 : 39;
    const esperada = normTexto(resolverGlosa({ notas: prop.notas, glosaComun: doc?.glosa_comun, glosaComunActiva: doc?.glosa_activa }, tipo));
    const sinGlosaPropia = !normTexto(prop.notas) && !(doc?.glosa_activa && normTexto(doc?.glosa_comun));
    // Sin glosa propia el genérico depende del tipo que el motor sugirió en el
    // cliente: cualquiera de los dos genéricos es lo mismo que aprobó la persona.
    glosaOk = glosaEnviada === esperada || (sinGlosaPropia && (glosaEnviada === GLOSA_FALLBACK || glosaEnviada === GLOSA_FALLBACK_EXENTA));
  }
  if (!glosaOk) campos.push("glosa");

  return campos.length === 0 ? { ok: true } : { ok: false, campos };
}

export const DETALLE_DATOS_CAMBIARON =
  "Esta boleta cambió en otra pestaña o por otra persona (monto, tipo, receptor o glosa). No se emitió nada: vuelve a abrir Emitir para ver los datos al día.";
export const DETALLE_DATOS_FALTAN =
  "Esta pestaña tiene una versión vieja de massDTE. No se emitió nada: recarga la página y vuelve a emitir.";
