/**
 * Deriva los FORMATOS CONOCIDOS de las specs reales (scripts/corpus-cartolas/
 * specs, solo ESTRUCTURA: títulos, roles, formatos, rótulos del encabezado) y
 * escribe src/lib/parsers/formatos-conocidos.specs.ts. Rinde cada spec una vez
 * (datos falsos) para tomar la fila de títulos TAL COMO la ve el lector
 * (posiciones con celdas combinadas incluidas).
 *
 *   npx tsx scripts/corpus-cartolas/derivar-conocidos.ts
 *
 * Fuera a propósito (ver EXCLUIDAS): títulos genéricos compartidos por varios
 * bancos, planillas caseras sin títulos, exports editados por la clienta sin
 * dirección en los títulos, y la plantilla massDTE (tiene su propia capa).
 */
import * as XLSX from "xlsx";
import { writeFileSync } from "fs";
import { join } from "path";
import { leerSpecs, rendir, type Spec } from "./generador";
import { leerLibroCartola } from "../../src/lib/parsers/libro";
import { normalizarTitulo } from "../../src/lib/parsers/encabezados";

export const EXCLUIDAS: Record<string, string> = {
  "cartola-cuenta-corriente-simple": "títulos genéricos (Fecha|Descripción|Cargos|Abonos|Saldo) y rótulo genérico: los comparten varios bancos",
  "cartola-simple-fecha-tipo-saldo": "títulos genéricos (Fecha|Descripcion|Monto|Tipo|Saldo) sin rótulos del banco",
  "clp-bs-montos-como-fecha": "planilla casera sin títulos",
  "clp-bs-planilla-casera": "planilla casera sin títulos",
  "me-planilla-fecha-monto-comision": "planilla casera (Fecha|Monto|Comisión), sin banco",
  "plantilla-massdte-boletas": "plantilla massDTE: ya tiene su propia capa (firma exacta)",
  "santander-3-columnas-editada": "export editado por la clienta: MONTO sin columna de dirección",
  "bci-mes-actual-xls": "export editado por la clienta (solo 'Abono EXENTAS'): sin evidencia del export original del banco",
  // Mismos títulos y rótulos que otra spec (el mismo formato filtrado): una sola entrada.
  "mis-movimientos-solo-ingresos-con-saldo": "mismo formato que mis-movimientos-completa",
  "santander-movimientos-ctacte-completa": "mismo formato que santander-movimientos-ctacte",
};
const BANCO: Record<string, string> = {
  "bancochile-cartola-historica": "Banco de Chile", "bancoestado-chequera-completa": "BancoEstado", "bancoestado-chequera-solo-abonos": "BancoEstado",
  "bancoestado-fechas-compactas": "BancoEstado", "bci-detallado-invertido": "BCI", "bci-mes-actual-xls": "BCI", "bci-movimientos-detallado": "BCI",
  "bci-transferencias-recibidas": "BCI", "bice-estado-de-cuenta": "BICE", "bice-estado-de-cuenta-solo-abonos": "BICE",
  "mis-movimientos-completa": "BCI (Mis Movimientos)", "mis-movimientos-solo-ingresos": "BCI (Mis Movimientos)", "santander-movimientos-ctacte": "Santander",
};

const ROL: Record<string, string> = { fecha: "fecha", glosa: "descripcion", doc: "n_documento", doc_corto: "n_documento", cargo: "cargo", abono: "abono", saldo: "saldo", monto: "monto", flag: "flag" };

function derivar(s: Spec) {
  const c = rendir(s, 1);
  const wb = leerLibroCartola(c.buf);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[s.hoja] ?? wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  const tit = s.columnas.map((x) => normalizarTitulo(x.titulo)).filter(Boolean);
  const h = rows.findIndex((r) => { const n = r.map(normalizarTitulo).filter(Boolean); return n.length === tit.length && n.every((t, i) => t === tit[i]); });
  if (h < 0) throw new Error(`${s.id}: no encontré la fila de títulos`);
  const fila = rows[h].map(normalizarTitulo);
  while (fila.length && !fila[fila.length - 1]) fila.pop();
  const roles: string[] = fila.map(() => "ignorar");
  let k = 0;
  // Sin columna de glosa (BCI transferencias recibidas), la glosa es el NOMBRE de la contraparte.
  const sinGlosa = !s.columnas.some((x) => x.rol === "glosa");
  fila.forEach((t, j) => {
    if (!t) return;
    const col = s.columnas.filter((x) => normalizarTitulo(x.titulo))[k++];
    roles[j] = (sinGlosa && col.rol === "nombre" ? "descripcion" : ROL[col.rol]) ?? "ignorar";
  });
  // Rótulos LITERALES del encabezado del banco (sin {placeholders} ni números), que de verdad aparecen arriba.
  const arriba = new Set(rows.slice(0, h).flatMap((r) => r.map(normalizarTitulo)));
  const marcas = [...new Set((s.arriba ?? []).flatMap((r) => (Array.isArray(r) ? r : [])).filter((x) => typeof x === "string" && x && !/[{}\d]/.test(x)).map(normalizarTitulo))]
    .filter((m) => m.length >= 3 && arriba.has(m));
  const fFecha = s.columnas.find((x) => x.rol === "fecha");
  const flag = s.columnas.find((x) => x.rol === "flag")?.flag ?? null;
  // Hoja de resumen del MISMO export (BancoEstado chequera: "Resumen" con el período y los saldos).
  const resumen_en_hoja = (s.hojas_extra ?? []).find((h) => h.tipo === "resumen")?.nombre ?? null;
  return { id: s.id, banco: BANCO[s.id], familia: s.familia.replace(/[{}]/g, ""), titulos: fila, roles, marcas, fecha_sin_anio: fFecha?.fmt === "dd/mm", flag, resumen_en_hoja };
}

const out = leerSpecs().filter((s) => !EXCLUIDAS[s.id]).map(derivar);
const claves = new Map<string, string>();
for (const f of out) {
  const k = JSON.stringify([f.titulos, f.marcas]);
  if (claves.has(k)) throw new Error(`huella repetida: ${f.id} = ${claves.get(k)}`);
  claves.set(k, f.id);
}
const ts = `// GENERADO por scripts/corpus-cartolas/derivar-conocidos.ts desde las specs reales (solo estructura). No editar a mano.
import type { FormatoDeSpec } from "./formatos-conocidos";

export const FORMATOS_DE_SPECS: FormatoDeSpec[] = ${JSON.stringify(out, null, 2)};

/** Specs que NO quedaron como formato conocido, y por qué. */
export const SPECS_EXCLUIDAS: Record<string, string> = ${JSON.stringify(EXCLUIDAS, null, 2)};
`;
writeFileSync(join(__dirname, "..", "..", "src", "lib", "parsers", "formatos-conocidos.specs.ts"), ts);
for (const f of out) console.log(`${f.id}\t${f.banco}\t${f.titulos.length} títulos\t${f.marcas.length} marcas\t${f.fecha_sin_anio ? "dd/mm" : ""}\t${f.flag ? "flag" : ""}`);
console.log(`${out.length} formatos · ${Object.keys(EXCLUIDAS).length} fuera`);
