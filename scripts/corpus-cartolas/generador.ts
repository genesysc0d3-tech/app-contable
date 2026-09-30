/**
 * GENERADOR de cartolas SINTÉTICAS desde un "spec de formato" (2026-09-30).
 *
 * Un spec (scripts/corpus-cartolas/specs/*.json) describe SOLO la estructura de
 * un formato real que ya pasó por prod (hoja, filas de basura arriba, títulos,
 * rol / tipo de celda / formato Excel de cada columna, orden, pie, resumen,
 * hojas extra). Aquí se rinde con datos 100% FALSOS (semilla determinística) a
 * un XLSX/XLS/CSV real vía SheetJS —con tipos de celda, cell.z, fórmulas SUM y
 * celdas combinadas— y se devuelve la VERDAD (cada movimiento con su dirección)
 * y los saldos con que se generó.
 *
 * No lo importa código de producto: solo scripts de prueba.
 */
import * as XLSX from "xlsx";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export type Rol =
  | "fecha" | "fecha2" | "hora" | "glosa" | "doc" | "doc_corto" | "codigo" | "tipo_txt" | "nombre" | "rut"
  | "cuenta_contraparte" | "sucursal" | "comentario" | "vacia" | "dia_num" | "tasa" | "bs_neg" | "comision"
  | "cuenta_fija" | "alias_fijo" | "ncartola_fijo" | "indice" | "monto" | "monto_signo" | "cargo" | "abono"
  | "flag" | "saldo" | "otro_texto" | "otro_num";

export type FmtFecha =
  | "dd/mm/yyyy" | "dd-mm-yyyy" | "dd/mm" | "yyyymmdd" | "dd/mm/yy" | "yyyy-mm-dd" | "d/m/yyyy" | "dd-mmm-yyyy" | "dd.mm.yyyy" | "mm/dd/yyyy";
export type FmtMonto = "cl" | "cl_pesos" | "cl_pesos_pegado" | "cl_dec" | "en" | "en_dec" | "plano";

export interface ColSpec {
  titulo: string;
  rol: Rol;
  /** date = serial de Excel con formato de fecha; n = número; s = texto. */
  celda?: "date" | "n" | "s" | "serial";
  /** Formato Excel (cell.z). */
  z?: string;
  /** Formato del texto (fecha o monto) cuando celda = "s". */
  fmt?: FmtFecha | FmtMonto;
  /** Cómo se ve una celda de plata vacía (la otra dirección). */
  vacio?: "vacia" | "cero" | "cero_txt" | "guion";
  flag?: { entrada: string; salida: string };
  /** La celda ocupa k columnas (combinadas). */
  span?: number;
  /** Glosa que empieza con un número de 10 dígitos (Santander). */
  prefijo_doc?: boolean;
}

export interface PieSpec {
  tipo: "sum" | "fila_total" | "fila_libre";
  rol?: Rol;
  roles?: Rol[];
  etiqueta?: string;
  col_etiqueta?: number;
  formula?: boolean;
  celdas?: Partial<Record<Rol, string>>;
  gap?: number;
  /** Probabilidad de que el pie aparezca (0-1); default 1. */
  prob?: number;
}

export interface HojaExtra { nombre: string; posicion: "antes" | "despues"; tipo: string; filas: (string | number | null)[][] }

export interface Spec {
  id: string;
  familia: string;
  origen: string;
  evidencia?: string;
  base?: string;
  hoja: string;
  formato?: "xlsx" | "xls" | "csv";
  csv_sep?: ";" | ",";
  hojas_extra?: HojaExtra[];
  arriba?: (string[] | string)[];
  arriba_recortar?: number;
  titulos?: boolean;
  columnas: ColSpec[];
  orden?: "asc" | "desc";
  direcciones?: "ambas" | "solo_entradas";
  /** El export muestra una sola dirección pero el saldo incluye la otra (filtro del cliente). */
  filtrada?: boolean;
  pie?: PieSpec[];
  abajo?: (string | number | null)[][];
  filas_vacias_al_final?: [number, number];
  ancho_vacio?: number;
  movs?: [number, number];
  rango_montos?: [number, number];
  /** Filas "$0" en texto intercaladas (no son movimientos). */
  ceros_texto?: [number, number];
  // Modificadores de rendición (los ponen las mutaciones)
  extras?: {
    glosa_partida?: boolean;
    subtotal_dia?: boolean;
    filas_vacias_intercaladas?: boolean;
    saldo_inicial_fila?: boolean;
    glosa_con_total?: boolean;
    fecha_mm_dd?: boolean;
  };
  mutaciones?: string[];
}

export type Mov = { fecha: string; monto: number; tipo: "ENTRADA" | "SALIDA"; glosa: string };

export interface CartolaSintetica {
  id: string;
  familia: string;
  spec_id: string;
  mutaciones: string[];
  seed: number;
  ext: "xlsx" | "xls" | "csv";
  buf: ArrayBuffer;
  verdad: Mov[];
  meta: {
    tieneSaldo: boolean;
    /** El archivo imprime el saldo inicial (resumen / fila) o no. */
    saldoInicialImpreso: boolean;
    resumenImpreso: boolean;
    saldoInicial: number;
    saldoFinal: number;
    cuenta: string;
    mes: number;
    filtrada: boolean;
  };
}

// ---------------------------------------------------------------------------
// Specs

const DIR_SPECS = join(__dirname, "specs");

export function leerSpecs(dir = DIR_SPECS): Spec[] {
  const out: Spec[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as Spec);
  // Resuelve "base": el spec hereda todo lo que no redefine.
  const porId = new Map(out.map((s) => [s.id, s]));
  return out.map((s) => resolverBase(s, porId));
}

export function leerSpecsDeepSeek(dir = join(DIR_SPECS, "deepseek")): Spec[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((x) => x.endsWith(".json")).sort().flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Spec[]);
}

function resolverBase(s: Spec, porId: Map<string, Spec>): Spec {
  if (!s.base) return s;
  const b = porId.get(s.base);
  if (!b) return s;
  return { ...resolverBase(b, porId), ...s, base: undefined };
}

// ---------------------------------------------------------------------------
// Azar determinístico

export function rngDe(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type R = () => number;
const entre = (r: R, a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const elegir = <T>(r: R, xs: T[]): T => xs[Math.floor(r() * xs.length)];

const GLOSAS_IN = ["TRANSF DE COMERCIAL OMEGA LTDA", "Transferencia recibida de Juan Ficticio", "DEPOSITO EFECTIVO SUC CENTRO", "Abono transferencia 76.111.222-3", "PAGO CLIENTE FACTURA 1234", "TEF DE PERSONA FICTICIA", "Transf. Cliente Ficticio", "ABONO PAGO PROVEEDOR ALFA"];
const GLOSAS_OUT = ["PAGO PROVEEDOR DELTA SPA", "Cargo comision mantencion", "Transferencia a Maria Ficticia", "PAC AGUA ANDINA", "GIRO CAJERO RED", "PAGO TARJETA CREDITO", "COMPRA COMERCIO FICTICIO", "Transf a Luis Ficticio"];
const SUCURSALES = ["Internet", "OFICINA CENTRAL", "SUC PROVIDENCIA", "Web", "Santiago", "APP MOVIL"];
const MES_TXT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// ---------------------------------------------------------------------------
// Formatos

const cl = (n: number) => Math.round(n).toLocaleString("es-CL");
export function fmtMonto(n: number, f: FmtMonto): string {
  const neg = n < 0 ? "-" : "";
  const a = Math.abs(Math.round(n));
  switch (f) {
    case "cl": return neg + cl(a);
    case "cl_pesos": return `${neg}$ ${cl(a)}`;
    case "cl_pesos_pegado": return `${neg}$${cl(a)}`;
    case "cl_dec": return `${neg}${cl(a)},00`;
    case "en": return neg + a.toLocaleString("en-US");
    case "en_dec": return `${neg}${a.toLocaleString("en-US")}.00`;
    case "plano": return `${neg}${a}`;
  }
}
export function fmtFecha(iso: string, f: FmtFecha): string {
  const [y, m, d] = iso.split("-");
  switch (f) {
    case "dd/mm/yyyy": return `${d}/${m}/${y}`;
    case "dd-mm-yyyy": return `${d}-${m}-${y}`;
    case "dd/mm": return `${d}/${m}`;
    case "yyyymmdd": return `${y}${m}${d}`;
    case "dd/mm/yy": return `${d}/${m}/${y.slice(2)}`;
    case "yyyy-mm-dd": return iso;
    case "d/m/yyyy": return `${Number(d)}/${Number(m)}/${y}`;
    case "dd-mmm-yyyy": return `${d}-${MES_TXT[Number(m) - 1]}-${y}`;
    case "dd.mm.yyyy": return `${d}.${m}.${y}`;
    case "mm/dd/yyyy": return `${m}/${d}/${y}`;
  }
}
const serial = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
};
function rutFicticio(r: R, puntos = true): string {
  const n = entre(r, 5_000_000, 78_000_000);
  const dv = "0123456789K"[entre(r, 0, 10)];
  return puntos ? `${cl(n)}-${dv}` : `${n}-${dv}`;
}

// ---------------------------------------------------------------------------
// Movimientos

interface Plan { full: (Mov & { saldo: number; visible: boolean })[]; saldo0: number; saldoFinal: number }

function planMovimientos(spec: Spec, r: R, o: { mes: number; saldo0?: number; n?: number }): Plan {
  const [a, b] = spec.movs ?? [20, 60];
  const nVis = o.n ?? entre(r, a, b);
  const dir = spec.direcciones ?? "ambas";
  const filtrada = !!spec.filtrada && dir === "solo_entradas";
  // En un export filtrado, ~35% de los movimientos de la cuenta no se ven.
  const nFull = filtrada ? Math.round(nVis / 0.65) : nVis;
  const diasMes = new Date(Date.UTC(2026, o.mes, 0)).getUTCDate();
  const [mn, mx] = spec.rango_montos ?? [3_000, 2_500_000];
  const movs: (Mov & { visible: boolean })[] = [];
  let vis = 0;
  for (let i = 0; i < nFull; i++) {
    let entrada: boolean;
    if (dir === "solo_entradas" && !filtrada) entrada = true;
    else if (filtrada) entrada = vis < nVis && (nFull - i <= nVis - vis || r() < 0.65);
    else entrada = r() < 0.55;
    if (filtrada && entrada) vis++;
    const dia = 1 + Math.floor((i * diasMes) / nFull);
    let monto = mn + Math.floor(Math.pow(r(), 2.2) * (mx - mn));
    monto = r() < 0.25 ? Math.max(1_000, Math.round(monto / 1_000) * 1_000) : Math.max(1, Math.round(monto / 10) * 10);
    const glosa = elegir(r, entrada ? GLOSAS_IN : GLOSAS_OUT);
    movs.push({ fecha: `2026-${String(o.mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`, monto, tipo: entrada ? "ENTRADA" : "SALIDA", glosa, visible: filtrada ? entrada : true });
  }
  if (spec.extras?.glosa_con_total && movs.length > 8) {
    const k = movs.findIndex((m, i) => i >= 5 && m.visible);
    if (k >= 0) movs[k].glosa = "PAGO TOTAL TARJETA CREDITO";
  }
  const saldo0 = o.saldo0 ?? entre(r, 500_000, 30_000_000);
  let s = saldo0;
  const full = movs.map((m) => { s += m.tipo === "ENTRADA" ? m.monto : -m.monto; return { ...m, saldo: s }; });
  return { full, saldo0, saldoFinal: s };
}

// ---------------------------------------------------------------------------
// Rendición

type Celda = { v: string | number | null; t?: "n" | "s"; z?: string; f?: string };
const vacia = (): Celda => ({ v: null });
const txt = (v: string): Celda => ({ v, t: "s" });
const num = (v: number, z?: string): Celda => ({ v, t: "n", ...(z ? { z } : {}) });

interface Ctx {
  r: R; spec: Spec; plan: Plan; cuenta: string; mes: number;
  fijos: { titular: string; empresa: string; usuario: string; rut: string; rut2: string; alias: string; ncartola: number; oficina: string; ejecutivo: string };
}

function celdaMonto(c: ColSpec, n: number): Celda {
  if (c.celda === "s") return txt(fmtMonto(n, (c.fmt as FmtMonto) ?? "cl"));
  return num(n, c.z);
}
function celdaVaciaPlata(c: ColSpec): Celda {
  switch (c.vacio ?? "vacia") {
    case "vacia": return vacia();
    case "cero": return c.celda === "s" ? txt("0") : num(0, c.z);
    case "cero_txt": return txt("$0");
    case "guion": return txt("-");
  }
}
function celdaFecha(c: ColSpec, iso: string, ctx: Ctx): Celda {
  const cel = c.celda ?? "s";
  if (cel === "date") return num(serial(iso), c.z ?? "dd/mm/yyyy");
  if (cel === "serial") return num(serial(iso));
  const f = ctx.spec.extras?.fecha_mm_dd ? "mm/dd/yyyy" : ((c.fmt as FmtFecha) ?? "dd/mm/yyyy");
  return txt(fmtFecha(iso, f));
}

function valor(c: ColSpec, m: Plan["full"][number], i: number, ctx: Ctx): Celda {
  const { r } = ctx;
  switch (c.rol) {
    case "fecha": return celdaFecha(c, m.fecha, ctx);
    case "fecha2": return celdaFecha(c, m.fecha, ctx);
    case "hora": return txt(`${String(entre(r, 8, 22)).padStart(2, "0")}:${String(entre(r, 0, 59)).padStart(2, "0")}`);
    case "glosa": return txt((c.prefijo_doc ? `${entre(r, 1_000_000_000, 1_999_999_999)} ` : "") + m.glosa);
    case "doc": return txt(String(entre(r, 1_000_000, 999_999_999_999)));
    case "doc_corto": return txt(String(entre(r, 0, 99)));
    case "codigo": return txt(Array.from({ length: 40 }, () => "0123456789ABCDEF"[entre(r, 0, 15)]).join(""));
    case "tipo_txt": return txt(m.tipo === "ENTRADA" ? "TRANSFERENCIA RECIBIDA" : "TRANSFERENCIA ENVIADA");
    case "nombre": return txt(`Persona Ficticia ${entre(r, 1, 999)}`);
    case "rut": return txt(rutFicticio(r, false));
    case "cuenta_contraparte": return txt(String(entre(r, 10_000_000, 99_999_999)));
    case "sucursal": return txt(elegir(r, SUCURSALES));
    case "comentario": return r() < 0.68 ? vacia() : txt("Pago servicio ficticio");
    case "vacia": return vacia();
    case "dia_num": return num(Number(m.fecha.slice(8)));
    case "tasa": return num(Math.round((20 + r() * 20) * 100000) / 100000, c.z);
    case "bs_neg": return num(-Math.round((m.monto / (20 + r() * 20)) * 100000) / 100000, c.z);
    case "comision": return num(Math.round(m.monto * 0.02), c.z);
    case "cuenta_fija": return txt(ctx.cuenta);
    case "alias_fijo": return txt(ctx.fijos.alias);
    case "ncartola_fijo": return num(ctx.fijos.ncartola);
    case "indice": return num(i + 1);
    case "otro_texto": return txt(`Ref ${entre(r, 100, 999)}`);
    case "otro_num": return num(entre(r, 1, 999));
    case "monto": return celdaMonto(c, m.monto);
    case "monto_signo": return celdaMonto(c, m.tipo === "ENTRADA" ? m.monto : -m.monto);
    case "cargo": return m.tipo === "SALIDA" ? celdaMonto(c, m.monto) : celdaVaciaPlata(c);
    case "abono": return m.tipo === "ENTRADA" ? celdaMonto(c, m.monto) : celdaVaciaPlata(c);
    case "flag": return txt(m.tipo === "ENTRADA" ? c.flag?.entrada ?? "A" : c.flag?.salida ?? "C");
    case "saldo": return celdaMonto(c, m.saldo);
  }
}

function placeholder(s: string, ctx: Ctx, extra: Record<string, number>): Celda {
  const m = s.match(/^\{([A-Z_0-9]+)(?:\|([a-z_]+))?\}$/);
  const numericos: Record<string, number> = extra;
  if (m && m[1] in numericos) {
    const v = numericos[m[1]];
    return m[2] ? txt(fmtMonto(v, m[2] as FmtMonto)) : num(v);
  }
  const f = ctx.fijos;
  const desde = `2026-${String(ctx.mes).padStart(2, "0")}-01`;
  const hasta = `2026-${String(ctx.mes).padStart(2, "0")}-${new Date(Date.UTC(2026, ctx.mes, 0)).getUTCDate()}`;
  const rep: Record<string, string> = {
    TITULAR: f.titular, EMPRESA: f.empresa, USUARIO: f.usuario, RUT: f.rut, RUT2: f.rut2, CUENTA: ctx.cuenta,
    CUENTA_GUION: `00-${ctx.cuenta.slice(0, 3)}-${ctx.cuenta.slice(3)}`, ALIAS: f.alias, NCARTOLA: String(f.ncartola),
    OFICINA: f.oficina, EJECUTIVO: f.ejecutivo, EMAIL_FICTICIO: "usuario@ficticio.cl", HORA: "10:15",
    FECHA: fmtFecha(hasta, "dd/mm/yyyy"), FECHA_LARGA: `${hasta.slice(8)} de ${MES_TXT[ctx.mes - 1]} de 2026`,
    FECHA_DESDE: fmtFecha(desde, "dd/mm/yyyy"), FECHA_HASTA: fmtFecha(hasta, "dd/mm/yyyy"),
    FECHA_DESDE_GUION: fmtFecha(desde, "dd-mm-yyyy"), FECHA_HASTA_GUION: fmtFecha(hasta, "dd-mm-yyyy"),
    PERIODO: `${fmtFecha(desde, "dd/mm/yyyy")} al ${fmtFecha(hasta, "dd/mm/yyyy")}`,
  };
  return txt(s.replace(/\{([A-Z_0-9]+)(?:\|[a-z_]+)?\}/g, (_, k: string) => rep[k] ?? (k in numericos ? cl(numericos[k]) : k)));
}

interface HojaRendida { nombre: string; filas: Celda[][]; merges: XLSX.Range[] }

function rendirFilasLibres(filas: (string | number | null | (string | number | null)[])[] | undefined, ctx: Ctx, extra: Record<string, number>, ncols: number, recortar: boolean): Celda[][] {
  const out: Celda[][] = [];
  for (const f of filas ?? []) {
    if (f === "{BLOQUE_NUMEROS_14}") {
      for (let i = 0; i < 14; i++) out.push([num(entre(ctx.r, 10_000, 99_999)), num(entre(ctx.r, 100, 999))]);
      continue;
    }
    const fila = (Array.isArray(f) ? f : [f]).map((v) => (v == null || v === "" ? vacia() : typeof v === "number" ? num(v) : placeholder(v, ctx, extra)));
    out.push(recortar ? fila.slice(0, ncols) : fila);
  }
  return out;
}

export function rendir(spec: Spec, seed: number, o: { mes?: number; saldo0?: number; cuenta?: string; n?: number } = {}): CartolaSintetica {
  const r = rngDe(seed);
  const mes = o.mes ?? 8;
  const plan = planMovimientos(spec, r, { mes, saldo0: o.saldo0, n: o.n });
  const cuenta = o.cuenta ?? String(entre(r, 10_000_000, 99_999_999));
  const ctx: Ctx = {
    r, spec, plan, cuenta, mes,
    fijos: {
      titular: `EMPRESA FICTICIA ${entre(r, 1, 99)} SPA`, empresa: `COMERCIAL FICTICIA ${entre(r, 1, 99)} LTDA`, usuario: "PERSONA FICTICIA DE PRUEBA",
      rut: rutFicticio(r), rut2: rutFicticio(r), alias: "CHEQUERA ELECTRONICA", ncartola: entre(r, 1, 300), oficina: "SUC FICTICIA", ejecutivo: "EJECUTIVO FICTICIO",
    },
  };
  const cols = spec.columnas;
  const visibles = plan.full.filter((m) => m.visible);
  const verdad: Mov[] = visibles.map(({ fecha, monto, tipo, glosa }) => ({ fecha, monto, tipo, glosa }));
  const totC = plan.full.filter((m) => m.tipo === "SALIDA").reduce((s, m) => s + m.monto, 0);
  const totA = plan.full.filter((m) => m.tipo === "ENTRADA").reduce((s, m) => s + m.monto, 0);
  const extra: Record<string, number> = {
    SALDO_INICIAL: plan.saldo0, SALDO_FINAL: plan.saldoFinal, TOTAL_CARGOS: totC, TOTAL_ABONOS: totA,
    TOTAL_VISIBLE: visibles.reduce((s, m) => s + m.monto, 0), N_MOVS: visibles.length, N_MOVS_TOTAL: plan.full.length,
  };

  // Columnas físicas (span = celdas combinadas a la derecha).
  const colIdx: number[] = [];
  let x = 0;
  for (const c of cols) { colIdx.push(x); x += Math.max(1, c.span ?? 1); }
  const ncols = x;
  const filas: Celda[][] = [];
  const merges: XLSX.Range[] = [];
  const filaFisica = (celdas: Celda[]): Celda[] => {
    const f: Celda[] = Array.from({ length: ncols }, vacia);
    celdas.forEach((c, j) => { f[colIdx[j]] = c; });
    return f;
  };
  const conSpan = (fila: number) => cols.forEach((c, j) => { if ((c.span ?? 1) > 1) merges.push({ s: { r: fila, c: colIdx[j] }, e: { r: fila, c: colIdx[j] + (c.span as number) - 1 } }); });

  filas.push(...rendirFilasLibres(spec.arriba as never, ctx, extra, ncols, !!spec.arriba_recortar));
  if (spec.titulos !== false) { conSpan(filas.length); filas.push(filaFisica(cols.map((c) => (c.titulo ? txt(c.titulo) : vacia())))); }

  // Cuerpo en orden de la hoja (asc/desc), con extras.
  let cuerpo = visibles.map((m, i) => ({ m, i }));
  const ceros = spec.ceros_texto ? entre(r, spec.ceros_texto[0], spec.ceros_texto[1]) : 0;
  const filasCuerpo: { celdas: Celda[]; mov?: number }[] = [];
  const colPlata = cols.findIndex((c) => ["monto", "abono"].includes(c.rol));
  if (spec.extras?.saldo_inicial_fila) {
    const cs = cols.findIndex((c) => c.rol === "saldo");
    const cf = cols.findIndex((c) => c.rol === "fecha");
    const cg = cols.findIndex((c) => c.rol === "glosa");
    const f = cols.map(() => vacia());
    if (cf >= 0) f[cf] = celdaFecha(cols[cf], `2026-${String(mes).padStart(2, "0")}-01`, ctx);
    if (cg >= 0) f[cg] = txt("SALDO INICIAL");
    if (cs >= 0) f[cs] = celdaMonto(cols[cs], plan.saldo0);
    filasCuerpo.push({ celdas: f });
  }
  const porDia = new Map<string, typeof cuerpo>();
  for (const e of cuerpo) porDia.set(e.m.fecha, [...(porDia.get(e.m.fecha) ?? []), e]);
  cuerpo.forEach((e, k) => {
    filasCuerpo.push({ celdas: cols.map((c) => valor(c, e.m, e.i, ctx)), mov: e.i });
    if (spec.extras?.glosa_partida && k % 5 === 2) {
      const cg = cols.findIndex((c) => c.rol === "glosa");
      if (cg >= 0) { const f = cols.map(() => vacia()); f[cg] = txt("REF: continuación de la glosa"); filasCuerpo.push({ celdas: f }); }
    }
    if (ceros > 0 && colPlata >= 0 && k % Math.max(2, Math.floor(cuerpo.length / (ceros + 1))) === 1 && filasCuerpo.filter((x) => x.mov === undefined && x.celdas[colPlata]?.v === "$0").length < ceros) {
      const f = cols.map((c) => (c.rol === "fecha" ? celdaFecha(c, e.m.fecha, ctx) : ["glosa"].includes(c.rol) ? txt("COMISION EXENTA") : ["sucursal", "cuenta_fija", "alias_fijo", "ncartola_fijo", "doc"].includes(c.rol) ? valor(c, e.m, e.i, ctx) : vacia()));
      f[colPlata] = txt("$0");
      filasCuerpo.push({ celdas: f });
    }
    const ultimoDelDia = k === cuerpo.length - 1 || cuerpo[k + 1].m.fecha !== e.m.fecha;
    if (spec.extras?.subtotal_dia && ultimoDelDia) {
      const d = porDia.get(e.m.fecha) ?? [];
      const f = cols.map((c) => {
        if (c.rol === "fecha") return celdaFecha(c, e.m.fecha, ctx);
        if (c.rol === "glosa") return txt("Total del día");
        if (c.rol === "cargo") { const t = d.filter((z) => z.m.tipo === "SALIDA").reduce((s, z) => s + z.m.monto, 0); return t ? celdaMonto(c, t) : vacia(); }
        if (c.rol === "abono" || c.rol === "monto") { const t = d.filter((z) => z.m.tipo === "ENTRADA").reduce((s, z) => s + z.m.monto, 0); return t ? celdaMonto(c, t) : vacia(); }
        if (c.rol === "saldo") return celdaMonto(c, e.m.saldo);
        return vacia();
      });
      filasCuerpo.push({ celdas: f });
    }
    if (spec.extras?.filas_vacias_intercaladas && k % 7 === 3) filasCuerpo.push({ celdas: cols.map(() => vacia()) });
  });
  if ((spec.orden ?? "asc") === "desc") {
    // Lo más nuevo arriba: se invierte por movimiento (con sus filas anexas).
    const bloques: { celdas: Celda[]; mov?: number }[][] = [];
    for (const f of filasCuerpo) { if (f.mov !== undefined || !bloques.length) bloques.push([f]); else bloques[bloques.length - 1].push(f); }
    filasCuerpo.length = 0;
    for (const b of bloques.reverse()) filasCuerpo.push(...b);
  }
  const primeraDatos = filas.length;
  for (const f of filasCuerpo) { conSpan(filas.length); filas.push(filaFisica(f.celdas)); }
  const ultimaDatos = filas.length - 1;

  // Pie
  const letra = (c: number) => XLSX.utils.encode_col(c);
  for (const p of spec.pie ?? []) {
    if (p.prob != null && r() > p.prob) continue;
    for (let g = 0; g < (p.gap ?? 0); g++) filas.push(Array.from({ length: ncols }, vacia));
    const f: Celda[] = Array.from({ length: ncols }, vacia);
    const sumaRol = (rol: Rol) => {
      const j = cols.findIndex((c) => c.rol === rol);
      if (j < 0) return null;
      const t = rol === "cargo" ? visibles.filter((m) => m.tipo === "SALIDA") : rol === "abono" ? visibles.filter((m) => m.tipo === "ENTRADA") : visibles;
      return { j, total: t.reduce((s, m) => s + m.monto, 0) };
    };
    if (p.tipo === "sum" && p.rol) {
      const s = sumaRol(p.rol);
      if (!s) continue;
      const cc = colIdx[s.j];
      f[cc] = { v: s.total, t: "n", z: cols[s.j].z, f: `SUM(${letra(cc)}${primeraDatos + 1}:${letra(cc)}${ultimaDatos + 1})` };
    } else if (p.tipo === "fila_total") {
      if (p.col_etiqueta != null) f[p.col_etiqueta] = txt(p.etiqueta ?? "TOTAL");
      for (const rol of p.roles ?? []) {
        const s = sumaRol(rol);
        if (!s) continue;
        const cc = colIdx[s.j];
        f[cc] = { v: s.total, t: "n", z: cols[s.j].z, ...(p.formula ? { f: `SUM(${letra(cc)}${primeraDatos + 1}:${letra(cc)}${ultimaDatos + 1})` } : {}) };
      }
    } else if (p.tipo === "fila_libre") {
      for (const [rol, v] of Object.entries(p.celdas ?? {})) {
        const j = cols.findIndex((c) => c.rol === rol);
        if (j >= 0 && v) f[colIdx[j]] = placeholder(v, ctx, extra);
      }
    }
    filas.push(f);
  }
  filas.push(...rendirFilasLibres(spec.abajo as never, ctx, extra, ncols, false));
  const [va, vb] = spec.filas_vacias_al_final ?? [0, 0];
  const nVacias = entre(r, va, vb);
  for (let i = 0; i < nVacias; i++) filas.push([txt("")]);

  const hojas: HojaRendida[] = [];
  for (const h of (spec.hojas_extra ?? []).filter((h) => h.posicion === "antes")) hojas.push({ nombre: h.nombre, filas: rendirFilasLibres(h.filas as never, ctx, extra, 99, false), merges: h.tipo === "resumen" ? h.filas.map((_, i) => ({ s: { r: i, c: 0 }, e: { r: i, c: 3 } })).slice(4) : [] });
  hojas.push({ nombre: spec.hoja, filas, merges });
  for (const h of (spec.hojas_extra ?? []).filter((h) => h.posicion === "despues")) hojas.push({ nombre: h.nombre, filas: rendirFilasLibres(h.filas as never, ctx, extra, 99, false), merges: [] });

  const ext = spec.formato ?? "xlsx";
  const buf = ext === "csv" ? aCsv(hojas.find((h) => h.nombre === spec.hoja)!, spec.csv_sep ?? ";") : aLibro(hojas, ext, spec.ancho_vacio ?? 0);
  const textoArribaAbajo = JSON.stringify([spec.arriba, spec.abajo, spec.hojas_extra]);
  return {
    id: "", familia: spec.familia, spec_id: spec.id, mutaciones: spec.mutaciones ?? [], seed, ext, buf, verdad,
    meta: {
      tieneSaldo: cols.some((c) => c.rol === "saldo"),
      saldoInicialImpreso: /SALDO_INICIAL/.test(textoArribaAbajo) || !!spec.extras?.saldo_inicial_fila,
      resumenImpreso: /SALDO_INICIAL|SALDO_FINAL|TOTAL_(CARGOS|ABONOS)/.test(textoArribaAbajo),
      saldoInicial: plan.saldo0, saldoFinal: plan.saldoFinal, cuenta, mes, filtrada: !!spec.filtrada,
    },
  };
}

function aLibro(hojas: HojaRendida[], ext: "xlsx" | "xls", anchoVacio: number): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const h of hojas) {
    const ws: XLSX.WorkSheet = {};
    let maxC = 0;
    h.filas.forEach((fila, ri) => {
      fila.forEach((c, ci) => {
        if (c.v == null && !c.f) return;
        const cell: XLSX.CellObject = c.t === "n" ? { t: "n", v: c.v as number } : { t: "s", v: String(c.v) };
        if (c.z) cell.z = c.z;
        if (c.f) cell.f = c.f;
        ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = cell;
        maxC = Math.max(maxC, ci);
      });
      if (anchoVacio && fila.some((c) => c.v != null && c.v !== "")) ws[XLSX.utils.encode_cell({ r: ri, c: maxC + anchoVacio })] = { t: "s", v: "" };
    });
    const lastC = Math.max(maxC + anchoVacio, 0);
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, h.filas.length - 1), c: lastC } });
    if (h.merges.length) ws["!merges"] = h.merges;
    XLSX.utils.book_append_sheet(wb, ws, h.nombre.slice(0, 31));
  }
  return XLSX.write(wb, { type: "array", bookType: ext === "xls" ? "biff8" : "xlsx" }) as ArrayBuffer;
}

function aCsv(h: HojaRendida, sep: string): ArrayBuffer {
  const esc = (v: string) => (v.includes(sep) || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v);
  const lineas = h.filas.map((f) => f.map((c) => {
    if (c.v == null) return "";
    if (c.t === "n" && c.z && /[dmy]{2}/i.test(c.z) && !/#/.test(c.z)) {
      // fecha serial → texto dd/mm/yyyy
      const d = new Date(Date.UTC(1899, 11, 30) + (c.v as number) * 86_400_000).toISOString().slice(0, 10);
      return fmtFecha(d, "dd/mm/yyyy");
    }
    if (c.t === "n") return sep === ";" ? String(c.v).replace(".", ",") : String(c.v);
    return esc(String(c.v));
  }).join(sep).replace(new RegExp(`${sep === ";" ? ";" : ","}+$`), ""));
  const u = new TextEncoder().encode(lineas.join("\n") + "\n");
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}
