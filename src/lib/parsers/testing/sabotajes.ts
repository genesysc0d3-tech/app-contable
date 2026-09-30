/**
 * BANCO DE SABOTAJES — generador determinístico de cartolas SINTÉTICAS (sin red,
 * sin datos de clientas). Portado de scripts/experimento-estructura-deepseek.ts
 * (2026-09-30) para usarlo en vitest y en el script de comparación con DeepSeek.
 *
 * 5 formatos de banco × 10 sabotajes (títulos en inglés/genéricos/ausentes,
 * columna insertada, columnas movidas, basura arriba, glosa con TOTAL, montos
 * "1,234,567", sin saldo). Cada cartola trae su VERDAD para comparar al peso.
 *
 * No lo importa código de producto: solo tests y scripts.
 */
import type { ParsedLine, Row } from "../types";

export type Cell = string | number | null | Date;
export type Mov = { fecha: string; monto: number; tipo: "ENTRADA" | "SALIDA"; glosa: string };
export type Cartola = { nombre: string; banco: string; sabotaje: string; rows: Row[]; verdad: Mov[] };

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const GLOSAS_IN = ["Transf de EMPRESA ALFA SPA", "Abono transferencia 76.123.456-7", "Deposito en efectivo", "Transferencia recibida de Juan Ficticio", "Pago cliente factura 1234"];
const GLOSAS_OUT = ["Pago proveedor Beta Ltda", "Cargo comision mantencion", "Transferencia a Maria Ficticia", "Pago PAC luz", "Giro cajero automatico"];

function movimientos(seed: number, n = 30): Mov[] {
  const r = rng(seed);
  const out: Mov[] = [];
  for (let i = 0; i < n; i++) {
    const entrada = r() < 0.55;
    const monto = Math.round((5_000 + r() * 1_500_000) / 10) * 10;
    const dia = 1 + Math.floor((i * 28) / n);
    const glosa = (entrada ? GLOSAS_IN : GLOSAS_OUT)[Math.floor(r() * 5)];
    out.push({ fecha: `2026-09-${String(dia).padStart(2, "0")}`, monto, tipo: entrada ? "ENTRADA" : "SALIDA", glosa });
  }
  return out;
}
const dmy = (iso: string) => iso.split("-").reverse().join("/");
const clp = (n: number) => "$ " + n.toLocaleString("es-CL");

type Rol = "fecha" | "glosa" | "cargo" | "abono" | "monto" | "flag" | "saldo" | "otro";
type Base = {
  id: string;
  junk: Cell[][];
  cols: { titulo: string; rol: Rol; val: (m: Mov, saldo: number, i: number) => Cell }[];
  desc?: boolean; // lo más nuevo arriba
  total?: boolean;
};

export const BASES: Base[] = [
  {
    id: "chile",
    junk: [["Banco Ficticio de Chile"], ["Cartola Histórica"], ["Cuenta Corriente: 00-000-00000-00"], ["Titular: EMPRESA FICTICIA SPA"], []],
    cols: [
      { titulo: "Fecha", rol: "fecha", val: (m) => dmy(m.fecha) },
      { titulo: "Descripción", rol: "glosa", val: (m) => m.glosa },
      { titulo: "Canal o Sucursal", rol: "otro", val: (_m, _s, i) => (i % 2 ? "Internet" : "Oficina Central") },
      { titulo: "Cargos (CLP)", rol: "cargo", val: (m) => (m.tipo === "SALIDA" ? m.monto : null) },
      { titulo: "Abonos (CLP)", rol: "abono", val: (m) => (m.tipo === "ENTRADA" ? m.monto : null) },
      { titulo: "Saldo (CLP)", rol: "saldo", val: (_m, s) => s },
    ],
    desc: true,
    total: true,
  },
  {
    id: "santander",
    junk: [["Movimientos de la cuenta"], ["Cuenta 0-000-00-00000-0"], ["Periodo: 01/09/2026 al 30/09/2026"], []],
    cols: [
      { titulo: "Monto", rol: "monto", val: (m) => m.monto },
      { titulo: "Descripción movimiento", rol: "glosa", val: (m) => m.glosa },
      { titulo: "Fecha", rol: "fecha", val: (m) => dmy(m.fecha) },
      { titulo: "N° Documento", rol: "otro", val: (_m, _s, i) => String(1000 + i) },
      { titulo: "Sucursal", rol: "otro", val: () => "Santiago" },
      { titulo: "Cargo/Abono", rol: "flag", val: (m) => (m.tipo === "ENTRADA" ? "A" : "C") },
      { titulo: "Saldo", rol: "saldo", val: (_m, s) => s },
    ],
    total: true,
  },
  {
    id: "bci",
    junk: [],
    cols: [
      { titulo: "Fecha de transacción", rol: "fecha", val: (m) => new Date(m.fecha + "T12:00:00Z") },
      { titulo: "Hora transacción", rol: "otro", val: (_m, _s, i) => `1${i % 10}:00` },
      { titulo: "Código de transacción", rol: "otro", val: (_m, _s, i) => `D5D76EB61DB98F697D346006F73B22F2622944${i}` },
      { titulo: "Tipo de transacción", rol: "otro", val: () => "TRANSFERENCIA" },
      { titulo: "Glosa detalle", rol: "glosa", val: (m) => m.glosa },
      { titulo: "Ingreso (+)", rol: "abono", val: (m) => (m.tipo === "ENTRADA" ? m.monto : null) },
      { titulo: "Egreso (-)", rol: "cargo", val: (m) => (m.tipo === "SALIDA" ? m.monto : null) },
      { titulo: "Saldo contable", rol: "saldo", val: (_m, s) => s },
    ],
    desc: true,
  },
  {
    id: "estado",
    junk: [["BANCO FICTICIO DEL ESTADO"], ["CUENTARUT / CHEQUERA ELECTRONICA"], ["Nombre: EMPRESA FICTICIA SPA   Rut: 11.111.111-1"], []],
    cols: [
      { titulo: "Fecha", rol: "fecha", val: (m) => dmy(m.fecha) },
      { titulo: "N° Operación", rol: "otro", val: (_m, _s, i) => String(900000 + i * 13) },
      { titulo: "Descripción", rol: "glosa", val: (m) => m.glosa },
      { titulo: "Cheques y Cargos $", rol: "cargo", val: (m) => (m.tipo === "SALIDA" ? clp(m.monto) : "") },
      { titulo: "Depósitos y Abonos $", rol: "abono", val: (m) => (m.tipo === "ENTRADA" ? clp(m.monto) : "") },
      { titulo: "Saldo $", rol: "saldo", val: (_m, s) => clp(s) },
    ],
  },
  {
    id: "itau",
    junk: [["Itaú Ficticio"], ["Últimos movimientos"], []],
    cols: [
      { titulo: "Fecha", rol: "fecha", val: (m) => dmy(m.fecha).replace(/\//g, "-") },
      { titulo: "Oficina", rol: "otro", val: () => "Web" },
      { titulo: "Descripción", rol: "glosa", val: (m) => m.glosa },
      { titulo: "N° Docto", rol: "otro", val: (_m, _s, i) => String(5000 + i) },
      { titulo: "Cargos", rol: "cargo", val: (m) => (m.tipo === "SALIDA" ? m.monto : 0) },
      { titulo: "Abonos", rol: "abono", val: (m) => (m.tipo === "ENTRADA" ? m.monto : 0) },
      { titulo: "Saldo", rol: "saldo", val: (_m, s) => s },
    ],
  },
];

const INGLES: Record<Rol, string> = { fecha: "Date", glosa: "Details", cargo: "Debit", abono: "Credit", monto: "Amount", flag: "D/C", saldo: "Balance", otro: "Ref" };

type Sabotaje = (b: Base, movs: Mov[]) => { b: Base; movs: Mov[]; sinTitulos?: boolean; junkExtra?: Cell[][]; montosIngles?: boolean };
export const SABOTAJES: Record<string, Sabotaje> = {
  base: (b, movs) => ({ b, movs }),
  titulos_ingles: (b, movs) => ({ b: { ...b, cols: b.cols.map((c) => ({ ...c, titulo: INGLES[c.rol] })) }, movs }),
  titulos_genericos: (b, movs) => ({ b: { ...b, cols: b.cols.map((c, i) => ({ ...c, titulo: `Columna ${i + 1}` })) }, movs }),
  columna_insertada: (b, movs) => {
    const cols = [...b.cols];
    cols.splice(2, 0, { titulo: "Nombre contraparte", rol: "otro", val: (_m, _s, i) => `Persona Ficticia ${i}` }, { titulo: "Rut", rol: "otro", val: (_m, _s, i) => `${10 + i}.111.222-3` });
    return { b: { ...b, cols }, movs };
  },
  columnas_movidas: (b, movs) => ({ b: { ...b, cols: [...b.cols].reverse() }, movs }),
  sin_titulos: (b, movs) => ({ b, movs, sinTitulos: true }),
  basura_extra: (b, movs) => ({ b, movs, junkExtra: [["Fecha de emisión:", "01/10/2026"], ["Saldo inicial", 1_000_000], ["Saldo disponible", 1_234_567], ["Ejecutivo: Pedro Ficticio"], ["Nota: los montos están en pesos"], []] }),
  glosa_con_total: (b, movs) => ({ b, movs: movs.map((m, i) => (i === 8 ? { ...m, glosa: "PAGO TOTAL TARJETA CREDITO" } : m)) }),
  montos_formato_ingles: (b, movs) => ({ b, movs, montosIngles: true }),
  sin_saldo: (b, movs) => ({ b: { ...b, cols: b.cols.filter((c) => c.rol !== "saldo") }, movs }),
};

export function construir(base: Base, sab: string, seed: number): Cartola {
  const movs0 = movimientos(seed);
  const s = SABOTAJES[sab](base, movs0);
  const b = s.b;
  let saldo = 20_000_000;
  const cuerpo: Cell[][] = s.movs.map((m, i) => {
    saldo += m.tipo === "ENTRADA" ? m.monto : -m.monto;
    return b.cols.map((c) => {
      let v = c.val(m, saldo, i);
      if (s.montosIngles && typeof v === "number" && ["cargo", "abono", "monto", "saldo"].includes(c.rol)) v = v === 0 ? "" : v.toLocaleString("en-US");
      return v;
    });
  });
  if (b.desc) cuerpo.reverse();
  const rows: Cell[][] = [...(s.junkExtra ?? []), ...b.junk];
  if (!s.sinTitulos) rows.push(b.cols.map((c) => c.titulo));
  rows.push(...cuerpo);
  if (b.total) {
    const tot = b.cols.map((c, i) => (i === 0 ? "Total" : c.rol === "cargo" ? s.movs.filter((m) => m.tipo === "SALIDA").reduce((a, m) => a + m.monto, 0) : c.rol === "abono" ? s.movs.filter((m) => m.tipo === "ENTRADA").reduce((a, m) => a + m.monto, 0) : null));
    rows.push([], tot as Cell[]);
  }
  return { nombre: `${base.id}/${sab}`, banco: base.id, sabotaje: sab, rows: rows as Row[], verdad: s.movs };
}

/** Las 50 cartolas del banco (misma semilla que el experimento del 2026-09-30). */
export function todasLasCartolas(): Cartola[] {
  const out: Cartola[] = [];
  BASES.forEach((b, bi) => Object.keys(SABOTAJES).forEach((s, si) => out.push(construir(b, s, 1000 + bi * 37 + si))));
  return out;
}

function normFecha(f: string): string {
  const m = f.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = f.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : f;
}

/** ¿Lo leído es EXACTAMENTE la verdad (fecha, monto y dirección de cada fila)? */
export function exacto(lines: Pick<ParsedLine, "fecha" | "monto" | "tipo">[], verdad: Mov[]): { ok: boolean; detalle: string } {
  const k = (f: string, monto: number, t: string) => `${normFecha(f)}|${monto}|${t}`;
  const a = lines.map((l) => k(l.fecha, l.monto, l.tipo)).sort();
  const b = verdad.map((m) => k(m.fecha, m.monto, m.tipo)).sort();
  if (a.join() === b.join()) return { ok: true, detalle: "" };
  const faltan = b.filter((x) => !a.includes(x)).length;
  const sobran = a.filter((x) => !b.includes(x)).length;
  return { ok: false, detalle: `leídas ${a.length}/${b.length}, faltan ${faltan}, sobran/malas ${sobran}` };
}
