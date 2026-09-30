/**
 * FALSE-PROOF SURVIVAL RATE (2026-09-30): ¿cuántos sellos sobreviven a un daño
 * económico del archivo? Toma TODAS las cartolas del corpus sintético que hoy
 * salen selladas (saldo / total_banco / cliente) y bien leídas, les aplica los
 * daños de danos.ts (varios por tipo, con semilla) y mira:
 *
 *   PROPIEDAD: para todo daño, o la salida lee CORRECTAMENTE la verdad mutada
 *   (y ningún testigo del banco la contradice), o el sello DESAPARECE.
 *   Un sello que sobrevive con la lectura mala (o con un testigo en contra, o en
 *   un archivo ambiguo por construcción) es un CONTRAEJEMPLO.
 *
 * Además mide la UNICIDAD del sello (¿hay otra lectura del mismo archivo que
 * también cierre?) y simula la CADENA entre cartolas (envenenamiento).
 *
 * Solo local, sin IA, sin red:
 *   npx tsx scripts/corpus-cartolas/sobrevivencia.ts --etiqueta=antes --parte=0/4 [--por-tipo=2]
 *   npx tsx scripts/corpus-cartolas/sobrevivencia.ts --etiqueta=antes --juntar
 *   npx tsx scripts/corpus-cartolas/sobrevivencia.ts --cadenas
 * Salida: <salida>/<etiqueta>/parte-k.json y tablas.md.
 */
import { soloOpenCode, reporteSoloOpenCode } from "../lib/solo-opencode";
soloOpenCode();

import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { construirCorpus, exacto, wilson, type ItemCorpus, type L } from "./corpus";
import { DANOS, danar, type Dano } from "./danos";
import { rendir, rngDe } from "./generador";

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const SALIDA = arg("salida") ?? join(process.env.TMPDIR ?? "/tmp", "sobrevivencia");
const ETIQUETA = arg("etiqueta") ?? "sin-etiqueta";
const [PARTE, PARTES] = (arg("parte") ?? "0/1").split("/").map(Number);
const POR_TIPO = Number(arg("por-tipo") ?? 2);
const LIMITE = arg("limite") ? Number(arg("limite")) : Infinity;
const SOLO_TIPO = arg("tipo");
const SOLO_ID = arg("id");
const MINIMIZAR_MAX = Number(arg("minimizar") ?? 4);

delete process.env.LECTOR_ESTRUCTURA_IA;

type Orq = typeof import("../../src/lib/parsers/orchestrator");
let orq: Orq;
/** Raíz del lector a medir (por defecto, este worktree). */
const LECTOR_RAIZ = process.env.LECTOR_RAIZ;
const importarOrq = async (): Promise<Orq> => (LECTOR_RAIZ ? import(join(LECTOR_RAIZ, "src/lib/parsers/orchestrator.ts")) : import("../../src/lib/parsers/orchestrator"));

interface Lectura { sello: string; exacta: boolean; det: string; detalle: string; capa: number; alerta: boolean; revisar: boolean; unicidad?: string | null }
const SELLOS = new Set(["saldo", "total_banco", "cliente"]);

async function leer(buf: ArrayBuffer, verdad: ItemCorpus["verdad"]): Promise<Lectura> {
  let res;
  try { res = (await orq.parseExcelWithOrchestrator(buf, {})).result; }
  catch (e) { return { sello: "error", exacta: false, det: String((e as Error).message).slice(0, 80), detalle: "", capa: -1, alerta: false, revisar: false }; }
  if (res.capa_usada === 4 || !res.preExtracted) return { sello: "capa4", exacta: false, det: "capa 4", detalle: "", capa: 4, alerta: false, revisar: false };
  const lines: L[] = res.preExtracted.map((m) => ({ fecha: m.fecha, monto: m.monto, tipo: m.tipo_flujo === "entrada" ? "ENTRADA" : "SALIDA" }));
  const ex = exacto(lines, verdad);
  const v = res.verificacion;
  return { sello: v?.tipo ?? "sin_comprobar", exacta: ex.ok, det: ex.det, detalle: String(v?.detalle ?? "").replace(/\$\s?[\d.]+/g, "$#").slice(0, 160), capa: res.capa_usada, alerta: !!v?.alerta, revisar: !!v?.revisar };
}

function semilla(...xs: (string | number)[]): number {
  return parseInt(createHash("sha256").update(xs.join("|")).digest("hex").slice(0, 8), 16);
}

/** ¿El sello tras el daño es falso? */
function esMentira(d: Dano, l: Lectura): boolean {
  if (!SELLOS.has(l.sello)) return false;
  if (d.oraculo === "sin_sello") return true;
  return !l.exacta || d.contradice;
}

interface ResDano { id: string; spec: string; fuente: string; selloBase: string; tipo: string; j: number; oraculo: string; contradice: boolean; nota: string; sello: string; exacta: boolean; mentira: boolean; detalle: string; minimo?: number | null }

async function parte() {
  orq = await importarOrq();
  let corpus = construirCorpus();
  if (SOLO_ID) corpus = corpus.filter((c) => c.id === SOLO_ID);
  corpus = corpus.filter((_, i) => i % PARTES === PARTE);
  if (Number.isFinite(LIMITE)) corpus = corpus.slice(0, LIMITE);
  const dir = join(SALIDA, ETIQUETA);
  mkdirSync(dir, { recursive: true });
  const base: { id: string; spec: string; fuente: string; sello: string; exacta: boolean; detalle: string }[] = [];
  const danos: ResDano[] = [];
  const t0 = Date.now();
  let k = 0;
  for (const it of corpus) {
    const l = await leer(it.buf, it.verdad);
    base.push({ id: it.id, spec: it.spec_id, fuente: it.fuente, sello: l.sello, exacta: l.exacta, detalle: l.detalle });
    if (++k % 100 === 0) process.stderr.write(`[${PARTE}] ${k}/${corpus.length} · ${danos.length} daños · ${Math.round((Date.now() - t0) / 1000)} s\n`);
    if (!SELLOS.has(l.sello) || !l.exacta) continue;
    for (const D of DANOS) {
      if (SOLO_TIPO && !SOLO_TIPO.split(",").includes(D.id)) continue;
      for (let j = 0; j < POR_TIPO; j++) {
        const s = semilla(it.id, D.id, j);
        const d = danar(it, D.id, rngDe(s));
        if (!d) break; // no aplica a este formato
        const ld = await leer(d.buf, d.verdad);
        const mentira = esMentira(d, ld);
        const r: ResDano = { id: it.id, spec: it.spec_id, fuente: it.fuente, selloBase: l.sello, tipo: D.id, j, oraculo: d.oraculo, contradice: d.contradice, nota: d.nota, sello: ld.sello, exacta: ld.exacta, mentira, detalle: ld.detalle };
        if (mentira && danos.filter((x) => x.mentira && x.tipo === D.id && x.minimo !== undefined).length < MINIMIZAR_MAX) r.minimo = await minimizar(it, D.id, s);
        danos.push(r);
      }
    }
  }
  writeFileSync(join(dir, `parte-${PARTE}.json`), JSON.stringify({ base, danos, red: reporteSoloOpenCode() }));
  process.stderr.write(`[${PARTE}] listo: ${corpus.length} cartolas, ${danos.length} daños, ${danos.filter((x) => x.mentira).length} sellos falsos (${Math.round((Date.now() - t0) / 1000)} s)\n`);
}

/** Minimización simple: la misma cartola (spec + semilla) con MENOS movimientos, el mismo daño. */
async function minimizar(it: ItemCorpus, tipo: string, s: number): Promise<number | null> {
  if (!it.spec) return null;
  for (const n of [3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 45]) {
    if (n >= it.verdad.length) break;
    const c = rendir(it.spec, it.seed, { n });
    const chico: ItemCorpus = { ...c, id: it.id, fuente: it.fuente, ambigua: it.ambigua, spec: it.spec };
    const l0 = await leer(chico.buf, chico.verdad);
    if (!SELLOS.has(l0.sello) || !l0.exacta) continue;
    const d = danar(chico, tipo, rngDe(s));
    if (!d) continue;
    if (esMentira(d, await leer(d.buf, d.verdad))) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "—");
const ic = (k: number, n: number) => { const [a, b] = wilson(k, n); return n ? `${(100 * a).toFixed(1)}–${(100 * b).toFixed(1)}` : "—"; };
export const tasa = (k: number, n: number) => `${pct(k, n)} (${k}/${n}; IC95 ${ic(k, n)})`;

function juntar() {
  const dir = join(SALIDA, ETIQUETA);
  const partes = readdirSync(dir).filter((f) => /^parte-\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { base: { id: string; spec: string; fuente: string; sello: string; exacta: boolean }[]; danos: ResDano[] });
  const base = partes.flatMap((p) => p.base);
  const danos = partes.flatMap((p) => p.danos);
  const L: string[] = [];
  const sell = base.filter((b) => SELLOS.has(b.sello));
  const sellExact = sell.filter((b) => b.exacta);
  L.push(`# Sobrevivencia de sellos falsos — ${ETIQUETA}`, "");
  L.push(`Cartolas del generador: ${base.length}. Selladas: ${sell.length} (saldo ${sell.filter((b) => b.sello === "saldo").length}, total_banco ${sell.filter((b) => b.sello === "total_banco").length}, cliente ${sell.filter((b) => b.sello === "cliente").length}); selladas y exactas (base de los daños): ${sellExact.length}; **sellos que mienten sin daño: ${sell.length - sellExact.length}**.`, "");
  L.push(`Daños aplicados: ${danos.length}; sellos falsos: **${tasa(danos.filter((d) => d.mentira).length, danos.length)}**.`, "");
  L.push("| Daño | Oráculo | n | Sello sobrevive | Sello FALSO (tasa, IC95) | Mínimo (movs) |", "|---|---|---|---|---|---|");
  for (const D of DANOS) {
    const xs = danos.filter((d) => d.tipo === D.id);
    if (!xs.length) { L.push(`| ${D.id} | — | 0 | — | — | — |`); continue; }
    const orac = [...new Set(xs.map((x) => x.oraculo))].join("/");
    const sob = xs.filter((x) => SELLOS.has(x.sello)).length;
    const mi = xs.filter((x) => x.mentira);
    const minimos = mi.map((x) => x.minimo).filter((x): x is number => typeof x === "number");
    L.push(`| ${D.id} | ${orac} | ${xs.length} | ${sob} | ${tasa(mi.length, xs.length)} | ${minimos.length ? Math.min(...minimos) : "—"} |`);
  }
  L.push("", "Por sello de la cartola ANTES del daño:", "", "| Sello base | n daños | Sellos falsos |", "|---|---|---|");
  for (const s of ["saldo", "total_banco", "cliente"]) { const xs = danos.filter((d) => d.selloBase === s); L.push(`| ${s} | ${xs.length} | ${tasa(xs.filter((d) => d.mentira).length, xs.length)} |`); }
  L.push("", "Contraejemplos (hasta 40, uno por cartola×daño):", "", "| Cartola | Daño | Nota | Sello | Lectura | Detalle |", "|---|---|---|---|---|---|");
  const vistos = new Set<string>();
  for (const d of danos.filter((x) => x.mentira)) {
    const k = `${d.spec}|${d.tipo}`;
    if (vistos.has(k) || vistos.size >= 40) continue;
    vistos.add(k);
    L.push(`| \`${d.id}\` | ${d.tipo} | ${d.nota} | ${d.sello} | ${d.exacta ? "exacta" : "MAL"}${d.contradice ? " · testigo en contra" : ""} | ${d.detalle.slice(0, 90)} |`);
  }
  const md = L.join("\n");
  writeFileSync(join(dir, "tablas.md"), md);
  console.log(md);
}

/**
 * UNICIDAD sobre los sellos de un lector (LECTOR_RAIZ): para cada cartola que
 * sale sellada saldo/total_banco, ¿hay OTRA lectura del mismo archivo que
 * también pase el juez? (unicidad.ts de ESTE worktree).
 */
async function unicidad() {
  orq = await importarOrq();
  const XLSX = await import("xlsx");
  const { leerLibroCartola } = await import("../../src/lib/parsers/libro");
  const { detectHeuristic } = await import("../../src/lib/parsers/heuristic");
  const { detectByNames } = await import("../../src/lib/parsers/named");
  const { applyAdapter } = await import("../../src/lib/parsers/apply");
  const { validate } = await import("../../src/lib/parsers/validator");
  const { formulasSuma, detectarResumenImpreso } = await import("../../src/lib/parsers/juez-banco");
  const { buscarSegundaSolucion } = await import("../../src/lib/parsers/unicidad");
  let corpus = construirCorpus().filter((_, i) => i % PARTES === PARTE);
  if (Number.isFinite(LIMITE)) corpus = corpus.slice(0, LIMITE);
  const out: { id: string; sello: string; exacta: boolean; otra: string | null; ms: number }[] = [];
  for (const it of corpus) {
    const l = await leer(it.buf, it.verdad);
    if (l.sello !== "saldo" && l.sello !== "total_banco") continue;
    const t0 = Date.now();
    let otra: string | null = null;
    const wb = leerLibroCartola(it.buf);
    for (const sn of wb.SheetNames) {
      const sheet = wb.Sheets[sn];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as never[];
      if (!rows.length) continue;
      const formulas = formulasSuma(sheet, XLSX.utils.decode_range, XLSX.utils.decode_cell);
      const cfg = [detectHeuristic(rows), detectByNames(rows)].find((c) => {
        if (!c) return false;
        const d: never[] = [];
        return validate(applyAdapter(rows, c, d, undefined, { filasFormula: new Set(formulas.map((f) => f.fila)) }), rows, c, d).ok;
      });
      if (!cfg) continue;
      const lines = applyAdapter(rows, cfg, [], undefined, { filasFormula: new Set(formulas.map((f) => f.fila)) });
      otra = buscarSegundaSolucion({ rows, cfg, lines, resumen: detectarResumenImpreso(rows), formulas })?.diferencia ?? null;
      break;
    }
    out.push({ id: it.id, sello: l.sello, exacta: l.exacta, otra, ms: Date.now() - t0 });
  }
  const dir = join(SALIDA, ETIQUETA);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `unicidad-${PARTE}.json`), JSON.stringify(out));
  process.stderr.write(`[${PARTE}] unicidad: ${out.length} sellos, ${out.filter((x) => x.otra).length} con segunda solución\n`);
}

async function main() {
  if (args.includes("--juntar")) return juntar();
  if (args.includes("--unicidad")) return unicidad();
  if (args.includes("--cadenas")) return (await import("./cadenas")).correrCadenas(SALIDA);
  await parte();
}

if (!existsSync(SALIDA)) mkdirSync(SALIDA, { recursive: true });
main().catch((e) => { console.error(e); process.exit(1); });
