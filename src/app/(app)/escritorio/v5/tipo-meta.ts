import { destinoPropuesta, esAfectoPorTipo, type Destino, type PropuestaParaDestino, type TipoPropuesto } from "@/lib/sii/destino";

export interface TipoMeta { sigla: string; label: string; bg: string; color: string; destino: Destino }

const GRIS = { bg: "color-mix(in srgb, var(--text) 7%, transparent)", color: "var(--text2)" };
const GASTO = { sigla: "GASTO", label: "Gasto · no se boletea", bg: "rgba(245,158,11,.12)", color: "var(--amber)" };

/** Etiqueta propia de algunas no-ventas; el resto cae a "N/V · No es venta". */
const ETIQUETA_NO_VENTA: Partial<Record<TipoPropuesto, Omit<TipoMeta, "destino">>> = {
  gasto: GASTO,
  gasto_egreso: GASTO,
  no_comercial: { sigla: "N/C", label: "No comercial · no se boletea", ...GRIS },
  boleta_honorarios: { sigla: "BHE", label: "Honorarios · se emiten en sii.cl, no acá", ...GRIS },
};

/**
 * Tipo de la propuesta para decisión rápida: visible tanto en la fila colapsada
 * (sigla) como en el detalle expandido (label completo). Pinta el DESTINO ÚNICO
 * (@/lib/sii/destino): una no-venta nunca se ve EXE/AFE, y lo "por decidir"
 * (arriendo/comisión) se ve "¿?" hasta que el cliente decida.
 */
export function tipoMeta(entrada: string | null | PropuestaParaDestino): TipoMeta {
  // Con la fila completa se respeta el conflicto regla↔marca ("¿?"); con solo el tipo, el destino del tipo.
  const fila: PropuestaParaDestino = typeof entrada === "object" && entrada !== null ? entrada : { tipo_propuesto: entrada };
  const tipoPropuesto = fila.tipo_propuesto;
  const d = destinoPropuesta(fila);
  if (d === "preguntar") {
    return { sigla: "¿?", label: "¿Es venta? · decide tú", bg: "color-mix(in srgb, var(--accent) 10%, transparent)", color: "var(--accent)", destino: d };
  }
  if (d === "no_es_venta") {
    const e = ETIQUETA_NO_VENTA[tipoPropuesto as TipoPropuesto];
    return { ...(e ?? { sigla: "N/V", label: "No es venta · no se boletea", ...GRIS }), destino: d };
  }
  const doc = d === "factura" ? "Factura" : "Boleta";
  return esAfectoPorTipo(tipoPropuesto)
    ? { sigla: "AFE", label: `${doc} · afecta`, bg: "rgba(180,240,39,.1)", color: "var(--lime)", destino: d }
    : { sigla: "EXE", label: `${doc} · exenta`, bg: "rgba(91,156,246,.1)", color: "var(--blue)", destino: d };
}
