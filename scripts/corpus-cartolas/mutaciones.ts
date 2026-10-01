/**
 * MUTACIONES de formato (combinables) sobre un spec: cómo un banco chileno podría
 * cambiar su export mañana o cómo una clienta edita la planilla antes de subirla.
 * Juntan el banco de sabotajes (src/lib/parsers/testing/sabotajes.ts), los casos
 * de las revisiones adversariales 1-3 y los problemas vistos en prod.
 *
 * Cada mutación devuelve un spec NUEVO o null si no aplica (p.ej. "sin_saldo" en
 * un formato que no trae saldo). Nunca crea una cartola cuya verdad sea
 * indecidible (p.ej. un monto sin signo ni bandera con cargos y abonos).
 */
import type { ColSpec, FmtFecha, FmtMonto, Rol, Spec } from "./generador";

const clon = (s: Spec): Spec => JSON.parse(JSON.stringify(s)) as Spec;
const tiene = (s: Spec, rol: Rol) => s.columnas.some((c) => c.rol === rol);
const PLATA: Rol[] = ["cargo", "abono", "monto", "monto_signo", "saldo"];
const idx = (s: Spec, rol: Rol) => s.columnas.findIndex((c) => c.rol === rol);
/** ¿La dirección de cada fila se puede saber? (cargo/abono separados, signo o bandera, o todo entrada). */
export function direccionDecidible(s: Spec): boolean {
  if (tiene(s, "cargo") && tiene(s, "abono")) return true;
  if (tiene(s, "monto_signo") || tiene(s, "flag")) return true;
  return (s.direcciones ?? "ambas") === "solo_entradas";
}

const INGLES: Partial<Record<Rol, string>> = { fecha: "Date", fecha2: "Value date", glosa: "Details", cargo: "Debit", abono: "Credit", monto: "Amount", monto_signo: "Amount", flag: "D/C", saldo: "Balance", doc: "Reference", sucursal: "Branch", hora: "Time" };
const ABREV: Partial<Record<Rol, string>> = { fecha: "Fec.", glosa: "Desc.", cargo: "Cargo $", abono: "Abono $", monto: "Monto $", saldo: "Saldo $", doc: "Nro. Doc.", sucursal: "Suc." };

export type Mutacion = { id: string; aplicar: (s: Spec, r: () => number) => Spec | null };

const conFecha = (fmt: FmtFecha): Mutacion["aplicar"] => (s) => {
  const t = clon(s);
  const c = t.columnas.find((x) => x.rol === "fecha");
  if (!c) return null;
  if (c.celda === "s" && c.fmt === fmt) return null;
  c.celda = "s"; c.fmt = fmt; delete c.z;
  for (const x of t.columnas.filter((x) => x.rol === "fecha2")) { x.celda = "s"; x.fmt = fmt; delete x.z; }
  return t;
};
const conMontoTexto = (fmt: FmtMonto): Mutacion["aplicar"] => (s) => {
  const t = clon(s);
  let n = 0;
  for (const c of t.columnas.filter((x) => PLATA.includes(x.rol))) { if (c.celda === "s" && c.fmt === fmt) continue; c.celda = "s"; c.fmt = fmt; delete c.z; n++; }
  return n ? t : null;
};

export const MUTACIONES: Mutacion[] = [
  { id: "base", aplicar: (s) => clon(s) },
  { id: "titulos_ingles", aplicar: (s) => { if (s.titulos === false) return null; const t = clon(s); t.columnas.forEach((c) => { if (INGLES[c.rol]) c.titulo = INGLES[c.rol]!; }); return t; } },
  { id: "titulos_genericos", aplicar: (s) => { if (s.titulos === false) return null; const t = clon(s); t.columnas.forEach((c, i) => { c.titulo = `Columna ${i + 1}`; }); return t; } },
  { id: "titulos_abreviados", aplicar: (s) => { if (s.titulos === false) return null; const t = clon(s); let n = 0; t.columnas.forEach((c) => { if (ABREV[c.rol]) { c.titulo = ABREV[c.rol]!; n++; } }); return n ? t : null; } },
  { id: "sin_titulos", aplicar: (s) => { if (s.titulos === false) return null; const t = clon(s); t.titulos = false; return t; } },
  { id: "columna_insertada", aplicar: (s) => { const t = clon(s); t.columnas.splice(Math.min(2, t.columnas.length), 0, { titulo: "Nombre contraparte", rol: "nombre" }, { titulo: "Rut", rol: "rut" }); return t; } },
  { id: "columnas_invertidas", aplicar: (s) => { const t = clon(s); t.columnas.reverse(); t.columnas.forEach((c) => delete c.span); return t; } },
  { id: "columnas_barajadas", aplicar: (s, r) => { const t = clon(s); for (let i = t.columnas.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [t.columnas[i], t.columnas[j]] = [t.columnas[j], t.columnas[i]]; } t.columnas.forEach((c) => delete c.span); return t; } },
  { id: "basura_extra", aplicar: (s) => { const t = clon(s); t.arriba = [["Fecha de emisión:", "{FECHA}"], ["Saldo inicial", "{SALDO_INICIAL}"], ["Saldo disponible", "{SALDO_FINAL}"], ["Ejecutivo: {EJECUTIVO}"], ["Nota: los montos están en pesos"], [], ...(t.arriba ?? [])]; return t; } },
  { id: "glosa_con_total", aplicar: (s) => { if (!tiene(s, "glosa")) return null; const t = clon(s); t.extras = { ...t.extras, glosa_con_total: true }; return t; } },
  { id: "montos_formato_ingles", aplicar: conMontoTexto("en") },
  { id: "montos_texto_pesos", aplicar: conMontoTexto("cl_pesos") },
  { id: "montos_texto_decimales", aplicar: conMontoTexto("cl_dec") },
  { id: "montos_texto_cl", aplicar: conMontoTexto("cl") },
  { id: "sin_saldo", aplicar: (s) => { if (!tiene(s, "saldo")) return null; const t = clon(s); t.columnas = t.columnas.filter((c) => c.rol !== "saldo"); return t; } },
  { id: "orden_invertido", aplicar: (s) => { const t = clon(s); t.orden = (s.orden ?? "asc") === "asc" ? "desc" : "asc"; return t; } },
  { id: "fecha_ddmmyyyy_texto", aplicar: conFecha("dd/mm/yyyy") },
  { id: "fecha_iso", aplicar: conFecha("yyyy-mm-dd") },
  { id: "fecha_sin_anio", aplicar: conFecha("dd/mm") },
  { id: "fecha_compacta", aplicar: conFecha("yyyymmdd") },
  { id: "fecha_anio_corto", aplicar: conFecha("dd/mm/yy") },
  { id: "fecha_mes_texto", aplicar: conFecha("dd-mmm-yyyy") },
  { id: "fecha_con_puntos", aplicar: conFecha("dd.mm.yyyy") },
  { id: "fecha_serial_sin_formato", aplicar: (s) => { const t = clon(s); const c = t.columnas.find((x) => x.rol === "fecha"); if (!c || c.celda === "serial") return null; c.celda = "serial"; delete c.z; delete c.fmt; return t; } },
  { id: "fecha_excel", aplicar: (s) => { const t = clon(s); const c = t.columnas.find((x) => x.rol === "fecha"); if (!c || c.celda === "date") return null; c.celda = "date"; c.z = "dd/mm/yyyy"; delete c.fmt; return t; } },
  {
    id: "monto_con_signo", aplicar: (s) => {
      const ic = idx(s, "cargo"), ia = idx(s, "abono");
      if (ic < 0 || ia < 0) return null;
      const t = clon(s);
      const base = t.columnas[ia];
      const nueva: ColSpec = { titulo: "Monto", rol: "monto_signo", celda: base.celda, z: base.z, fmt: base.fmt };
      t.columnas = t.columnas.filter((c) => c.rol !== "cargo" && c.rol !== "abono");
      t.columnas.splice(Math.min(ic, ia), 0, nueva);
      return t;
    },
  },
  {
    id: "monto_y_bandera", aplicar: (s) => {
      const ic = idx(s, "cargo"), ia = idx(s, "abono");
      if (ic < 0 || ia < 0) return null;
      const t = clon(s);
      const base = t.columnas[ia];
      t.columnas = t.columnas.filter((c) => c.rol !== "cargo" && c.rol !== "abono");
      t.columnas.splice(Math.min(ic, ia), 0, { titulo: "Monto", rol: "monto", celda: base.celda, z: base.z, fmt: base.fmt }, { titulo: "Tipo", rol: "flag", flag: { entrada: "Abono", salida: "Cargo" } });
      t.direcciones = s.direcciones ?? "ambas";
      return t;
    },
  },
  {
    id: "separar_cargo_abono", aplicar: (s) => {
      const im = idx(s, "monto"), iff = idx(s, "flag");
      if (im < 0 || iff < 0) return null;
      const t = clon(s);
      const base = t.columnas[im];
      t.columnas = t.columnas.filter((c) => c.rol !== "monto" && c.rol !== "flag");
      t.columnas.splice(Math.min(im, iff), 0, { titulo: "Cargos", rol: "cargo", celda: base.celda, z: base.z, fmt: base.fmt }, { titulo: "Abonos", rol: "abono", celda: base.celda, z: base.z, fmt: base.fmt });
      return t;
    },
  },
  { id: "filtrado_solo_abonos", aplicar: (s) => { if ((s.direcciones ?? "ambas") === "solo_entradas") return null; if (!direccionDecidible(s)) return null; const t = clon(s); t.direcciones = "solo_entradas"; t.filtrada = true; return t; } },
  { id: "resumen_arriba", aplicar: (s) => { if (/SALDO_INICIAL/.test(JSON.stringify(s.arriba ?? []))) return null; const t = clon(s); t.arriba = [...(t.arriba ?? []), ["Resumen del Periodo"], ["Saldo Anterior", "Total Cargos", "Total Abonos", "Saldo Final"], ["{SALDO_INICIAL}", "{TOTAL_CARGOS}", "{TOTAL_ABONOS}", "{SALDO_FINAL}"], []]; return t.filtrada ? null : t; } },
  { id: "resumen_abajo", aplicar: (s) => { if (s.filtrada) return null; const t = clon(s); t.abajo = [...(t.abajo ?? []), [], ["Saldo inicial", "{SALDO_INICIAL}"], ["Total cargos", "{TOTAL_CARGOS}"], ["Total abonos", "{TOTAL_ABONOS}"], ["Saldo final", "{SALDO_FINAL}"]]; return t; } },
  {
    id: "fila_total", aplicar: (s) => {
      const roles = s.columnas.filter((c) => ["cargo", "abono", "monto"].includes(c.rol)).map((c) => c.rol);
      if (!roles.length || tiene(s, "monto_signo")) return null;
      if (tiene(s, "monto") && tiene(s, "flag")) return null;
      const t = clon(s);
      t.pie = [...(t.pie ?? []), { tipo: "fila_total", etiqueta: "Total", col_etiqueta: 0, roles, gap: 1 }];
      return t;
    },
  },
  {
    id: "sum_formula", aplicar: (s) => {
      const roles = s.columnas.filter((c) => ["cargo", "abono", "monto"].includes(c.rol)).map((c) => c.rol);
      if (!roles.length || (tiene(s, "monto") && tiene(s, "flag"))) return null;
      const t = clon(s);
      t.pie = [...(t.pie ?? []).filter((p) => p.tipo !== "sum"), ...roles.map((rol) => ({ tipo: "sum" as const, rol, gap: 0 }))];
      // Una sola fila con todas las SUM: se ponen como fila_total con fórmula.
      t.pie = [...(s.pie ?? []).filter((p) => p.tipo !== "sum"), { tipo: "fila_total", roles, formula: true, gap: 0 }];
      return t;
    },
  },
  { id: "subtotal_por_dia", aplicar: (s) => { if (!tiene(s, "glosa") || tiene(s, "monto_signo") || tiene(s, "flag")) return null; const t = clon(s); t.extras = { ...t.extras, subtotal_dia: true }; return t; } },
  { id: "glosa_partida", aplicar: (s) => { if (!tiene(s, "glosa")) return null; const t = clon(s); t.extras = { ...t.extras, glosa_partida: true }; return t; } },
  { id: "saldo_inicial_fila", aplicar: (s) => { if (!tiene(s, "saldo") || s.filtrada) return null; const t = clon(s); t.extras = { ...t.extras, saldo_inicial_fila: true }; return t; } },
  { id: "hoja_resumen_antes", aplicar: (s) => { if ((s.hojas_extra ?? []).some((h) => h.tipo === "resumen")) return null; const t = clon(s); t.hojas_extra = [...(t.hojas_extra ?? []), { nombre: "Resumen", posicion: "antes", tipo: "resumen", filas: [["Cartola"], ["Cuenta", "{CUENTA}"], ["Saldo Inicial", "{SALDO_INICIAL|cl_pesos}"], ["Total Cargos", "{TOTAL_CARGOS|cl_pesos}"], ["Total Abonos", "{TOTAL_ABONOS|cl_pesos}"], ["Saldo Final", "{SALDO_FINAL|cl_pesos}"]] }]; return t; } },
  { id: "hoja_readme_despues", aplicar: (s) => { const t = clon(s); t.hojas_extra = [...(t.hojas_extra ?? []), { nombre: "Instrucciones", posicion: "despues", tipo: "readme", filas: [["Este archivo fue generado por el banco"], ["Texto ficticio de ayuda"]] }]; return t; } },
  { id: "filas_vacias_intercaladas", aplicar: (s) => { const t = clon(s); t.extras = { ...t.extras, filas_vacias_intercaladas: true }; return t; } },
  { id: "csv_punto_y_coma", aplicar: (s) => { if (s.formato === "csv" || (s.hojas_extra ?? []).length) return null; const t = clon(s); t.formato = "csv"; t.csv_sep = ";"; t.columnas.forEach((c) => delete c.span); return t; } },
  { id: "csv_coma", aplicar: (s) => { if (s.formato === "csv" || (s.hojas_extra ?? []).length) return null; const t = clon(s); t.formato = "csv"; t.csv_sep = ","; t.columnas.forEach((c) => delete c.span); for (const c of t.columnas.filter((x) => PLATA.includes(x.rol))) { c.celda = "s"; c.fmt = "plano"; } return t; } },
  { id: "xls_antiguo", aplicar: (s) => { if (s.formato === "xls" || s.formato === "csv") return null; const t = clon(s); t.formato = "xls"; return t; } },
  { id: "pocas_filas", aplicar: (s) => { const t = clon(s); t.movs = [4, 9]; return t; } },
  { id: "muchas_filas", aplicar: (s) => { const t = clon(s); t.movs = [300, 800]; return t; } },
  { id: "vacio_como_cero", aplicar: (s) => { if (!tiene(s, "cargo")) return null; const t = clon(s); t.columnas.filter((c) => c.rol === "cargo" || c.rol === "abono").forEach((c) => { c.vacio = "cero"; }); return t; } },
  { id: "vacio_como_guion", aplicar: (s) => { if (!tiene(s, "cargo")) return null; const t = clon(s); t.columnas.filter((c) => c.rol === "cargo" || c.rol === "abono").forEach((c) => { c.vacio = "guion"; }); return t; } },
  { id: "celdas_combinadas", aplicar: (s) => { if (s.formato === "csv") return null; const t = clon(s); let n = 0; t.columnas.forEach((c) => { if ((c.rol === "fecha" || c.rol === "glosa") && !c.span) { c.span = 2; n++; } }); return n ? t : null; } },
  { id: "columna_indice", aplicar: (s) => { if (tiene(s, "indice")) return null; const t = clon(s); t.columnas.unshift({ titulo: "", rol: "indice" }); return t; } },
  { id: "montos_rango_serial", aplicar: (s) => { const t = clon(s); t.rango_montos = [20_000, 60_000]; return t; } },
  { id: "dos_fechas", aplicar: (s) => { if (tiene(s, "fecha2")) return null; const f = s.columnas.find((c) => c.rol === "fecha"); if (!f) return null; const t = clon(s); t.columnas.splice(idx(s, "fecha") + 1, 0, { ...clon({ columnas: [f] } as Spec).columnas[0], titulo: "Fecha Contable", rol: "fecha2" }); return t; } },
  { id: "ceros_en_texto", aplicar: (s) => { if (!tiene(s, "monto") && !tiene(s, "abono")) return null; const t = clon(s); t.ceros_texto = [2, 6]; return t; } },
  { id: "saldo_en_texto", aplicar: (s) => { const c = s.columnas.find((x) => x.rol === "saldo"); if (!c || c.celda === "s") return null; const t = clon(s); const d = t.columnas.find((x) => x.rol === "saldo")!; d.celda = "s"; d.fmt = "cl_pesos"; delete d.z; return t; } },
  { id: "fecha_mm_dd", aplicar: (s) => { const c = s.columnas.find((x) => x.rol === "fecha"); if (!c || c.celda !== "s" || c.fmt !== "dd/mm/yyyy") return null; const t = clon(s); t.extras = { ...t.extras, fecha_mm_dd: true }; return t; } },
];

export const MUTACION = new Map(MUTACIONES.map((m) => [m.id, m]));

/** Aplica una lista de mutaciones en orden; null si alguna no aplica o la verdad queda indecidible. */
export function mutar(spec: Spec, ids: string[], r: () => number): Spec | null {
  let s: Spec | null = spec;
  for (const id of ids) {
    const m = MUTACION.get(id);
    if (!m || !s) return null;
    s = m.aplicar(s, r);
  }
  if (!s || !direccionDecidible(s)) return null;
  if (!s.columnas.some((c) => c.rol === "fecha")) return null;
  s.mutaciones = [...(spec.mutaciones ?? []), ...ids.filter((x) => x !== "base")];
  return s;
}
