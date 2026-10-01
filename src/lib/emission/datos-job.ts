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
//   tipo    = el persistido manda (Paso P); sin persistido (43 % de las boletas
//             aprobadas en prod, rev. adversarial M4) se RECALCULA con el mismo motor
//             de la mesa (evaluarEmision: tipo_propuesto exento, hint de la cartola,
//             heurística de la glosa, régimen de la empresa). El ángulo "patrón" es
//             neutral (clasificador-tipo.ts), así que el tipo no depende de las
//             hermanas de la lista. Sin contexto de empresa → se rechaza.
//             Nunca un tipo de la otra mesa.

import { GLOSA_FALLBACK, GLOSA_FALLBACK_EXENTA, resolverGlosa } from "@/lib/intermediario/armar-boleta";
import { evaluarEmision } from "@/lib/intermediario/emision-decision";
import type { DocumentoHint, EmpresaContext } from "@/lib/sii/clasificador-tipo";

export const SELECT_PROPUESTA_DATOS =
  "id, empresa_id, estado, mesa, tipo_dte, tipo_propuesto, total, notas, detalle, receptor_rut, receptor_nombre, created_at, clientes(rut, nombre), movimientos_raw(monto, fecha, descripcion, documentos_subidos(glosa_comun, glosa_activa, tipo_operacion_hint))";

type Uno<T> = T | T[] | null | undefined;
const uno = <T>(v: Uno<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export type PropuestaDatos = {
  mesa: string | null;
  tipo_dte: number | null;
  estado?: string | null;
  tipo_propuesto?: string | null;
  total: number | string | null;
  notas: string | null;
  detalle: string | null;
  receptor_rut: string | null;
  receptor_nombre?: string | null;
  created_at?: string | null;
  clientes: Uno<{ rut: string | null; nombre?: string | null }>;
  movimientos_raw: Uno<{
    monto: number | string | null;
    fecha?: string | null;
    descripcion?: string | null;
    documentos_subidos?: Uno<{ glosa_comun: string | null; glosa_activa: boolean | null; tipo_operacion_hint?: string | null }>;
  }>;
};

const HINTS = new Set(["p2p_cripto", "forex_divisas", "servicios", "ventas", "mixto"]);

/** Tipo de boleta que la mesa le asigna a una propuesta SIN tipo persistido (mismo motor). */
export function tipoBoletaDeMesa(prop: PropuestaDatos, empresa: EmpresaContext): 39 | 41 | null {
  const mov = uno(prop.movimientos_raw);
  const doc = uno(mov?.documentos_subidos);
  const cliente = uno(prop.clientes);
  const total = Number(prop.total ?? mov?.monto ?? 0);
  const hint = doc?.tipo_operacion_hint && HINTS.has(doc.tipo_operacion_hint) ? (doc.tipo_operacion_hint as DocumentoHint) : null;
  const v = evaluarEmision(
    {
      estado: prop.estado ?? "",
      yaEmitida: false,
      total,
      descripcion: mov?.descripcion ?? "",
      fecha: (mov?.fecha ?? prop.created_at ?? "").slice(0, 10),
      receptorRut: prop.receptor_rut ?? cliente?.rut ?? null,
      receptorNombre: prop.receptor_nombre ?? cliente?.nombre ?? null,
      tipoDtePersistido: null,
      tipoPropuesto: prop.tipo_propuesto ?? null,
      docHint: hint,
    },
    { empresa },
  );
  return v.tipoDte;
}

import type { DatosJobEnviados } from "./datos-job-cliente";
export { datosParaJob, type DatosJobEnviados } from "./datos-job-cliente";

export type CampoDatos = "monto" | "tipo_dte" | "receptor_rut" | "glosa";

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
  /** Contexto de la empresa (con operacion_default) para recalcular un tipo sin persistir. */
  empresa?: EmpresaContext | null,
): { ok: true } | { ok: false; campos: CampoDatos[] } {
  const campos: CampoDatos[] = [];
  const mov = uno(prop.movimientos_raw);
  const doc = uno(mov?.documentos_subidos);
  const cliente = uno(prop.clientes);

  const monto = Number(prop.total ?? mov?.monto ?? 0);
  if (Math.round(monto) !== Math.round(enviado.monto)) campos.push("monto");

  const familia = prop.mesa ? FAMILIA[prop.mesa] : undefined;
  const tipoPersistido = prop.tipo_dte != null && familia?.includes(prop.tipo_dte) ? prop.tipo_dte : null;
  let tipoMal = Boolean(familia && !familia.includes(tipoDtePedido)) || (tipoPersistido != null && tipoPersistido !== tipoDtePedido);
  if (!tipoMal && tipoPersistido == null && prop.mesa === "boleta") {
    // Sin tipo persistido: el server lo recalcula; sin contexto no se acepta a ciegas.
    tipoMal = !empresa || tipoBoletaDeMesa(prop, empresa) !== tipoDtePedido;
  }
  if (tipoMal) campos.push("tipo_dte");

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

/** Texto para la clienta (rev. adversarial 2 M1): honesto a mitad de lote, sin jerga. */
export function textoDatosCambiaron(mesa: string | null | undefined): string {
  const doc = mesa === "factura" ? "factura" : "boleta";
  const pl = mesa === "factura" ? "facturas" : "boletas";
  return `Esta ${doc} cambió en otra pestaña o la cambió otra persona (monto, tipo, receptor o detalle), así que no la emití. Las que ya salieron quedaron guardadas. Vuelve a abrir Emitir para ver los datos al día y sigue con las ${pl} que faltan.`;
}
export const DETALLE_DATOS_FALTAN =
  "Esta pestaña tiene una versión vieja de massDTE. Recarga la página y vuelve a emitir: lo que falta quedó guardado.";
