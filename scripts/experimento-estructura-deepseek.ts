/**
 * EXPERIMENTO (no es código de producto): ¿un paso de ESTRUCTURA con DeepSeek
 * (OpenCode Go) rescata las cartolas que el lector determinístico no entiende?
 *
 * DeepSeek solo devuelve el MAPA de columnas (AdapterConfig). Los montos los lee
 * applyAdapter desde las celdas y el validador decide. Datos 100% sintéticos.
 *
 *   npx tsx scripts/experimento-estructura-deepseek.ts [--sin-ia] [--solo=base,mover]
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { detectHeuristic } from "../src/lib/parsers/heuristic";
import { detectByNames } from "../src/lib/parsers/named";
import { applyAdapter } from "../src/lib/parsers/apply";
import { validate, formatoVerificadoPorSaldo } from "../src/lib/parsers/validator";
import type { AdapterConfig, DescarteFila, ParsedLine, Row } from "../src/lib/parsers/types";

type Cell = string | number | null | Date;
type Mov = { fecha: string; monto: number; tipo: "ENTRADA" | "SALIDA"; glosa: string };
type Cartola = { nombre: string; rows: Cell[][]; verdad: Mov[] };

// ---------- generador determinístico ----------
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

// Cada base: función que arma filas a partir de movimientos. Roles por columna
// para poder sabotear (renombrar/mover/insertar) sin romper la verdad.
type Base = {
  id: string;
  junk: Cell[][];
  cols: { titulo: string; rol: "fecha" | "glosa" | "cargo" | "abono" | "monto" | "flag" | "saldo" | "otro"; val: (m: Mov, saldo: number, i: number) => Cell }[];
  desc?: boolean; // lo más nuevo arriba
  total?: boolean;
};

const BASES: Base[] = [
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

const INGLES: Record<string, string> = { fecha: "Date", glosa: "Details", cargo: "Debit", abono: "Credit", monto: "Amount", flag: "D/C", saldo: "Balance", otro: "Ref" };

type Sabotaje = (b: Base, movs: Mov[]) => { b: Base; movs: Mov[]; sinTitulos?: boolean; junkExtra?: Cell[][]; montosIngles?: boolean };
const SABOTAJES: Record<string, Sabotaje> = {
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

function construir(base: Base, sab: string, seed: number): Cartola {
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
  return { nombre: `${base.id}/${sab}`, rows, verdad: s.movs };
}

// ---------- comparar contra la verdad ----------
function normFecha(f: string): string {
  const m = f.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = f.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  return d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : f;
}
function exacto(lines: ParsedLine[], verdad: Mov[]): { ok: boolean; detalle: string } {
  const k = (f: string, monto: number, t: string) => `${normFecha(f)}|${monto}|${t}`;
  const a = lines.map((l) => k(l.fecha, l.monto, l.tipo)).sort();
  const b = verdad.map((m) => k(m.fecha, m.monto, m.tipo)).sort();
  if (a.join() === b.join()) return { ok: true, detalle: "" };
  const faltan = b.filter((x) => !a.includes(x)).length;
  const sobran = a.filter((x) => !b.includes(x)).length;
  return { ok: false, detalle: `leídas ${a.length}/${b.length}, faltan ${faltan}, sobran/malas ${sobran}` };
}

type Resultado = "OK" | "ATRAPADO" | "SILENCIOSO" | "RECHAZO_FALSO" | "NO_DETECTA";
function firma(rows: Row[], cfg: AdapterConfig | null): string {
  if (!cfg) return "null";
  try { return applyAdapter(rows, cfg, []).map((l) => `${normFecha(l.fecha)}|${l.monto}|${l.tipo}`).sort().join(); } catch { return "err"; }
}
function valida(rows: Row[], cfg: AdapterConfig | null): boolean {
  if (!cfg) return false;
  try { const d: DescarteFila[] = []; return validate(applyAdapter(rows, cfg, d), rows, cfg, d).ok; } catch { return false; }
}
function evaluar(rows: Row[], cfg: AdapterConfig | null, verdad: Mov[]): { r: Resultado; detalle: string } {
  if (!cfg) return { r: "NO_DETECTA", detalle: "" };
  let lines: ParsedLine[] = [];
  const descartes: DescarteFila[] = [];
  try {
    lines = applyAdapter(rows, cfg, descartes);
  } catch (e) {
    return { r: "ATRAPADO", detalle: `excepción: ${(e as Error).message}` };
  }
  const v = validate(lines, rows, cfg, descartes);
  const ex = exacto(lines, verdad);
  const perdidas = descartes.filter((d) => !d.legitimo).length;
  if (ex.ok && v.ok) return { r: "OK", detalle: "" };
  if (ex.ok && !v.ok) return { r: "RECHAZO_FALSO", detalle: v.errors.join("; ").slice(0, 120) };
  if (!v.ok) return { r: "ATRAPADO", detalle: `${ex.detalle} | ${v.errors[0]?.slice(0, 80)}` };
  return { r: "SILENCIOSO", detalle: `${ex.detalle}${perdidas ? ` (censo avisó ${perdidas})` : " (censo: 0 pérdidas)"}` };
}

function lectorDeHoy(rows: Row[], verdad: Mov[]) {
  const h = detectHeuristic(rows);
  const eh = evaluar(rows, h, verdad);
  if (eh.r === "OK" || eh.r === "SILENCIOSO") return { ...eh, capa: "heurística", cfg: h };
  const n = detectByNames(rows);
  const en = evaluar(rows, n, verdad);
  if (en.r !== "NO_DETECTA") return { ...en, capa: "nombres", cfg: n };
  return { ...eh, capa: h ? "heurística" : "ninguna", cfg: h };
}

// ---------- paso de ESTRUCTURA con DeepSeek (OpenCode Go) ----------
function env(k: string): string {
  const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith(k + "="));
  return (line?.slice(k.length + 1) ?? "").replace(/^["']|["']$/g, "").trim();
}
function grilla(rows: Row[]): string {
  const cel = (v: unknown) => {
    if (v === null || v === undefined || v === "") return "·";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).replace(/\s+/g, " ").slice(0, 28);
  };
  const idx = rows.map((_, i) => i);
  const mostrar = idx.length <= 30 ? idx : [...idx.slice(0, 22), ...idx.slice(-6)];
  let prev = -1;
  const out: string[] = [];
  for (const i of mostrar) {
    if (prev >= 0 && i !== prev + 1) out.push("… (filas omitidas)");
    const r = rows[i] ?? [];
    out.push(`fila ${i}: ` + (r.length ? r.map((v, j) => `[${j}] ${cel(v)}`).join(" | ") : "(vacía)"));
    prev = i;
  }
  return out.join("\n");
}

const TOOL = {
  type: "function",
  function: {
    name: "mapa_cartola",
    description: "Devuelve SOLO la estructura de la cartola bancaria: qué columna cumple qué rol. No devuelvas montos.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["layout", "header_row", "primera_fila_datos", "date_format", "number_format", "fecha", "descripcion", "n_documento", "cargo", "abono", "saldo", "monto", "tipo_flujo_col", "razon"],
      properties: {
        layout: { type: "string", enum: ["two_cols", "single_col", "transactions_log"], description: "two_cols = columnas separadas de cargo y abono; single_col = una columna de monto + columna con letra/palabra que dice si es cargo o abono; transactions_log = un monto sin tipo" },
        header_row: { type: "integer", description: "fila de títulos; -1 si no hay títulos" },
        primera_fila_datos: { type: "integer", description: "índice de la primera fila que es un movimiento" },
        date_format: { type: "string", enum: ["dd/mm/yyyy", "yyyy-mm-dd", "dd-mm-yyyy", "unknown"] },
        number_format: { type: "string", enum: ["chilean", "generic"], description: "chilean = 1.234.567 (punto de miles); generic = 1,234,567 (coma de miles)" },
        fecha: { type: "integer" },
        descripcion: { type: "integer", description: "glosa del movimiento (no códigos/hash)" },
        n_documento: { type: "integer", description: "-1 si no hay" },
        cargo: { type: "integer", description: "columna de SALIDAS de plata (two_cols); -1 si no aplica" },
        abono: { type: "integer", description: "columna de ENTRADAS de plata (two_cols); -1 si no aplica" },
        saldo: { type: "integer", description: "-1 si no hay" },
        monto: { type: "integer", description: "single_col/transactions_log: columna del monto; -1 si no aplica" },
        tipo_flujo_col: { type: "integer", description: "single_col: columna con C/A, Cargo/Abono, D/C; -1 si no aplica" },
        razon: { type: "string", description: "una frase" },
      },
    },
  },
};

async function deepseekMapa(rows: Row[]): Promise<{ cfg: AdapterConfig | null; ms: number; err?: string }> {
  const t0 = Date.now();
  const body = {
    model: env("OPENCODE_GO_MODEL") || "deepseek-v4-flash",
    temperature: 0,
    tools: [TOOL],
    tool_choice: { type: "function", function: { name: "mapa_cartola" } },
    messages: [
      { role: "system", content: "Eres un lector de ESTRUCTURA de cartolas bancarias chilenas exportadas a Excel. Recibes una grilla con índices de fila y columna ([j] = columna j). Identifica qué columna es la fecha, la glosa, las salidas (cargos/egresos/débitos), las entradas (abonos/ingresos/créditos/depósitos) y el saldo. Los títulos pueden estar en otro idioma, ser genéricos o no existir: decide por el CONTENIDO (el saldo es la columna que va acumulando; cargo y abono nunca tienen valor en la misma fila). Filas de basura arriba (logo, cuenta, saldo inicial) NO son datos. No inventes columnas." },
      { role: "user", content: grilla(rows) },
    ],
  };
  try {
    const res = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("OPENCODE_GO_API_KEY")}`, "Content-Type": "application/json", "x-opencode-session": randomUUID(), "User-Agent": "massdte-experimento/1.0" },
      body: JSON.stringify(body),
    });
    const txt = await res.text();
    if (!res.ok) return { cfg: null, ms: Date.now() - t0, err: `HTTP ${res.status} ${txt.slice(0, 120)}` };
    const j = JSON.parse(txt);
    const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return { cfg: null, ms: Date.now() - t0, err: "sin tool_call" };
    const a = JSON.parse(args);
    const cfg: AdapterConfig = {
      header_row: Math.max(0, a.header_row),
      skip_rows_before_data: a.primera_fila_datos,
      date_format: a.date_format,
      number_format: a.number_format,
      layout: a.layout,
      columns: { fecha: a.fecha, descripcion: a.descripcion, n_documento: a.n_documento, cargo: a.cargo, abono: a.abono, saldo: a.saldo, monto: a.monto >= 0 ? a.monto : undefined, tipo_flujo_col: a.tipo_flujo_col >= 0 ? a.tipo_flujo_col : undefined },
    };
    return { cfg, ms: Date.now() - t0 };
  } catch (e) {
    return { cfg: null, ms: Date.now() - t0, err: (e as Error).message };
  }
}

// ---------- correr ----------
async function main() {
  const sinIa = process.argv.includes("--sin-ia");
  const solo = process.argv.find((a) => a.startsWith("--solo="))?.slice(7).split(",");
  const casos: Cartola[] = [];
  BASES.forEach((b, bi) => Object.keys(SABOTAJES).forEach((s, si) => { if (!solo || solo.includes(s)) casos.push(construir(b, s, 1000 + bi * 37 + si)); }));

  const filas: { caso: string; hoy: string; hoyCapa: string; ia: string; final: string; dos: string; det: string; ms: number }[] = [];
  const cola = [...casos];
  async function worker() {
    for (let c = cola.shift(); c; c = cola.shift()) {
      const rows = c.rows as Row[];
      const hoy = lectorDeHoy(rows, c.verdad);
      let ia = "-", det = hoy.detalle, ms = 0, final = hoy.r as string, dos = "-";
      if (!sinIa) {
        const d = await deepseekMapa(rows);
        ms = d.ms;
        const e = d.err ? { r: "ERROR_API", detalle: d.err } : evaluar(rows, d.cfg, c.verdad);
        ia = e.r;
        // Pipeline propuesto: si el lector de hoy no quedó OK/SILENCIOSO, entra el paso de estructura.
        // Pipeline B (DOS OPINIONES): corren siempre ambos. Si leen lo mismo y valida → acepta.
        // Si discrepan: acepta el que valida si es UNO solo; si ambos validan o ninguno → al humano.
        {
          const fh = firma(rows, hoy.cfg), fi = firma(rows, d.cfg ?? null);
          const vh = valida(rows, hoy.cfg), vi = valida(rows, d.cfg ?? null);
          let cfgB: AdapterConfig | null = null, etiqueta = "";
          if (fh === fi && vh) cfgB = hoy.cfg; else if (vh && !vi) cfgB = hoy.cfg; else if (vi && !vh) cfgB = d.cfg ?? null; else if (vh && vi) {
            const sh = !!hoy.cfg && formatoVerificadoPorSaldo(rows, hoy.cfg), si = !!d.cfg && formatoVerificadoPorSaldo(rows, d.cfg);
            if (si && !sh) cfgB = d.cfg ?? null; else if (sh && !si) cfgB = hoy.cfg; else etiqueta = "AL_HUMANO";
          } else etiqueta = fh === fi ? "AMBOS_FALLAN" : "AL_HUMANO";
          dos = cfgB ? evaluar(rows, cfgB, c.verdad).r : etiqueta;
        }
        if (hoy.r !== "OK" && hoy.r !== "SILENCIOSO") { final = ia === "OK" ? "OK (rescatada)" : ia; det = `hoy: ${hoy.r} ${hoy.detalle} || IA: ${e.detalle}`; }
        else if (e.r !== "OK") det = `${hoy.detalle} || IA sola: ${e.r} ${e.detalle}`;
      }
      filas.push({ caso: c.nombre, hoy: hoy.r, hoyCapa: hoy.capa, ia, final, dos, det, ms });
      process.stderr.write(".");
    }
  }
  await Promise.all(Array.from({ length: sinIa ? 1 : 4 }, worker));
  process.stderr.write("\n");
  filas.sort((a, b) => a.caso.localeCompare(b.caso));
  console.log("caso\thoy\tcapa\tIA-sola\tpipeline\tdos-opiniones\tms\tdetalle");
  for (const f of filas) console.log(`${f.caso}\t${f.hoy}\t${f.hoyCapa}\t${f.ia}\t${f.final}\t${f.dos}\t${f.ms}\t${f.det}`);
  const cuenta = (k: "hoy" | "ia" | "final" | "dos") => filas.reduce<Record<string, number>>((acc, f) => ((acc[f[k]] = (acc[f[k]] ?? 0) + 1), acc), {});
  console.log("\nRESUMEN (" + filas.length + " cartolas)");
  console.log("lector de hoy:", JSON.stringify(cuenta("hoy")));
  if (!sinIa) {
    console.log("DeepSeek solo:", JSON.stringify(cuenta("ia")));
    console.log("pipeline hoy+IA:", JSON.stringify(cuenta("final")));
    console.log("dos opiniones:", JSON.stringify(cuenta("dos")));
    const t = filas.map((f) => f.ms).sort((a, b) => a - b);
    console.log("latencia DeepSeek ms: mediana", t[Math.floor(t.length / 2)], "máx", t[t.length - 1]);
  }
}
if (process.env.DEBUG_CASO) { debug(process.env.DEBUG_CASO); } else { main(); }

function debug(nombre: string) {
  const [bid, sab] = nombre.split("/");
  const bi = BASES.findIndex((b) => b.id === bid);
  const si = Object.keys(SABOTAJES).indexOf(sab);
  const c = construir(BASES[bi], sab, 1000 + bi * 37 + si);
  const rows = c.rows as Row[];
  console.log(grilla(rows).split("\n").slice(0, 9).join("\n"));
  for (const [n, cfg] of [["heur", detectHeuristic(rows)], ["nombres", detectByNames(rows)]] as const) {
    console.log(n, JSON.stringify(cfg));
    if (!cfg) continue;
    const d: DescarteFila[] = [];
    const l = applyAdapter(rows, cfg, d);
    console.log(" leídas", l.slice(0, 3).map((x) => `${x.fecha} ${x.tipo} ${x.monto} s=${x.saldo}`));
    console.log(" verdad", c.verdad.slice(0, 3).map((x) => `${x.fecha} ${x.tipo} ${x.monto}`), "| validar:", validate(l, rows, cfg, d).errors);
  }
}
