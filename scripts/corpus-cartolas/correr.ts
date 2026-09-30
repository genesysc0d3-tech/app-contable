/**
 * PRUEBAS MASIVAS del lector de cartolas (2026-09-30): lector ACTUAL (origin/dev)
 * vs NUEVO (esta rama, sin IA) vs NUEVO+IA (LECTOR_ESTRUCTURA_IA=1, DeepSeek por
 * OpenCode Go) sobre miles de cartolas SINTÉTICAS generadas desde los formatos
 * reales que ya pasaron por prod (specs/*.json), sus mutaciones, las variantes
 * adversariales que inventó DeepSeek (specs/deepseek/*.json), el banco de
 * sabotajes y (opcional) los casos de las revisiones adversariales 1-3.
 *
 * TODO corre LOCAL: sin Supabase, sin Vercel, sin la app desplegada. La única
 * red permitida es opencode.ai (scripts/lib/solo-opencode.ts la hace cumplir;
 * una llamada a fireworks.ai se redirige a OpenCode y se cuenta).
 *
 *   LECTOR_ACTUAL=<worktree de origin/dev> npx tsx scripts/corpus-cartolas/correr.ts \
 *     [--ia=700] [--sin-ia] [--limite=N] [--salida=<dir>] [--repro=<id>] [--solo-spec=<id>]
 *
 * Salida: <dir>/resultados.json (crudo) y <dir>/tablas.md (resumen). Por defecto
 * <tmpdir>/corpus-cartolas. Nada de esto va al repo.
 */
import { soloOpenCode, reporteSoloOpenCode } from "../lib/solo-opencode";
soloOpenCode();

import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { leerSpecs, leerSpecsDeepSeek, rendir, rngDe, type CartolaSintetica, type Mov, type Spec } from "./generador";
import { mutar } from "./mutaciones";
import { construirCorpus as construirCorpusBase, corpusExterno as corpusExternoBase, exacto, idDe, wilson, type ItemCorpus, type L } from "./corpus";

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const SIN_IA = args.includes("--sin-ia");
const N_IA = Number(arg("ia") ?? 700);
const LIMITE = arg("limite") ? Number(arg("limite")) : Infinity;
const SALIDA = arg("salida") ?? join(tmpdir(), "corpus-cartolas");
const REPRO = arg("repro");
const SOLO_SPEC = arg("solo-spec");
const ACTUAL = process.env.LECTOR_ACTUAL;
const NUEVO = join(__dirname, "..", "..");
const ADVERSARIALES = process.env.ADVERSARIALES_DIR;
const CONCURRENCIA_IA = Number(process.env.CONCURRENCIA_IA ?? 8);

// ---------------------------------------------------------------------------
// Corpus (scripts/corpus-cartolas/corpus.ts: lo comparte la batería de sellos falsos)

type Item = ItemCorpus;
const construirCorpus = () => construirCorpusBase(SOLO_SPEC);
const corpusExterno = () => corpusExternoBase(SOLO_SPEC, ADVERSARIALES);

// ---------------------------------------------------------------------------
// Lectura y clasificación

async function cargar(root: string) {
  return {
    orq: await import(`${root}/src/lib/parsers/orchestrator.ts`),
    heur: await import(`${root}/src/lib/parsers/heuristic.ts`),
    named: await import(`${root}/src/lib/parsers/named.ts`),
    apply: await import(`${root}/src/lib/parsers/apply.ts`),
  };
}
type Mods = Awaited<ReturnType<typeof cargar>>;
let leerLibroNuevo: (b: ArrayBuffer) => XLSX.WorkBook;

function hojas(buf: ArrayBuffer): unknown[][][] {
  const wb = leerLibroNuevo(buf);
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: "" }));
}
function algunMapaExacto(M: Mods, buf: ArrayBuffer, v: Mov[]): boolean {
  for (const rows of hojas(buf)) {
    for (const f of [M.heur.detectHeuristic, M.named.detectByNames]) {
      let cfg; try { cfg = f(rows); } catch { cfg = null; }
      if (!cfg) continue;
      try { if (exacto(M.apply.applyAdapter(rows, cfg, []), v).ok) return true; } catch { /* */ }
    }
  }
  return false;
}

export interface Salida {
  clase: string; sello: string; capa: number; det: string; detalle: string; motivo: string; ms: number;
  alerta: boolean; revisar: boolean; filtrada: string | null; exacta: boolean; leidas: number; disputa: boolean;
  saldoFinalLeido: number | null; saldoInicialLeido: number | null;
}

function motivoSinSello(s: { sello: string; detalle: string; capa: number; disputa: boolean; filtrada: string | null }, it: Item): string {
  if (s.capa === 4) return "capa4";
  if (s.sello === "saldo" || s.sello === "total_banco") return "-";
  if (s.sello === "cliente") return "plantilla_cliente";
  const d = s.detalle;
  if (s.disputa || /dos_opiniones|opini/i.test(d)) return "disputa_con_ia";
  if (/^El banco no calza/.test(d)) return "banco_contradice";
  if (/Otra\(s\) hoja/.test(d)) return "otras_hojas_con_movimientos";
  if (/fila\(s\)/.test(d)) return "plata_sin_leer_o_monto_dudoso";
  if (s.filtrada) return "export_filtrado_un_sentido";
  if (/saldo corrido no cierra/.test(d)) return /al revés/.test(d) ? "columnas_al_reves" : "saldo_no_cierra";
  if (/primera no se puede comprobar/.test(d)) return "primera_fila_sin_saldo_inicial";
  if (/primera fila deja el saldo inicial en \$0/.test(d)) return "primera_fila_desde_cero";
  if (/signo negativo/.test(d)) return "signo_sin_titulo";
  if (/nada dice qué columna es cargo/.test(d)) return "totales_calzan_sin_direccion";
  if (/no cubre todas las filas/.test(d)) return "sum_parcial";
  if (/títulos de la hoja dicen lo contrario/.test(d)) return "titulos_contra_mapa";
  if (/no trae saldo ni totales/.test(d)) return it.meta.tieneSaldo && it.verdad.length < 11 ? "menos_de_10_filas" : "sin_saldo_ni_totales";
  return "otro";
}

async function correr(M: Mods, it: Item, esNuevo: boolean): Promise<Salida> {
  const t0 = Date.now();
  let res;
  const vacio = { alerta: false, revisar: false, filtrada: null, exacta: false, leidas: 0, disputa: false, saldoFinalLeido: null, saldoInicialLeido: null };
  try { res = (await M.orq.parseExcelWithOrchestrator(it.buf, {})).result; }
  catch (e) { return { ...vacio, clase: "ERROR", sello: "-", capa: -1, det: String((e as Error).message).slice(0, 100), detalle: "", motivo: "error", ms: Date.now() - t0 }; }
  const ms = Date.now() - t0;
  if (res.capa_usada === 4 || !res.preExtracted) {
    const rf = algunMapaExacto(M, it.buf, it.verdad);
    return { ...vacio, clase: rf ? "RECHAZO_FALSO" : "CAPA4", sello: "-", capa: 4, det: "capa 4 (hoja entera a la IA como texto)", detalle: "", motivo: "capa4", ms };
  }
  const lines: L[] = res.preExtracted.map((m: { fecha: string; monto: number; tipo_flujo: string }) => ({ fecha: m.fecha, monto: m.monto, tipo: m.tipo_flujo === "entrada" ? "ENTRADA" : "SALIDA" }));
  const ex = exacto(lines, it.verdad);
  const nolegit = (res.censo?.descartes ?? []).filter((d: { legitimo: boolean }) => !d.legitimo).length;
  const otras = res.censo?.otras_hojas_con_datos?.length ?? 0;
  const v = res.verificacion;
  const sello = esNuevo ? (v?.tipo ?? "sin_comprobar") : "(sin sello)";
  const alerta = !!v?.alerta, revisar = !!v?.revisar, filtrada = v?.filtrada ?? null;
  const disputa = (res.warnings ?? []).some((w: string) => w.startsWith("dos_opiniones"));
  let clase: string;
  if (esNuevo) {
    const probado = sello === "saldo" || sello === "total_banco" || sello === "cliente";
    if (ex.ok) clase = sello === "cliente" ? "EXACTA_CLIENTE" : probado ? "EXACTA_PROBADA" : "EXACTA_PREGUNTA";
    else if (probado) clase = "SELLO_MIENTE";
    else clase = alerta || revisar || filtrada ? "MAL_CON_AVISO" : "MAL_PREGUNTA_SIN_ALERTA";
  } else {
    clase = ex.ok ? "EXACTA" : nolegit > 0 || otras > 0 ? "MAL_CON_AVISO" : "SILENCIOSA";
  }
  const detalle = String(v?.detalle ?? "");
  const base = { sello, detalle, capa: res.capa_usada, disputa, filtrada };
  return {
    clase, sello, capa: res.capa_usada, ms, alerta, revisar, filtrada, exacta: ex.ok, leidas: lines.length, disputa,
    det: `capa ${res.capa_usada} · ${ex.det}${nolegit ? ` · no legít. ${nolegit}` : ""}${otras ? ` · otras hojas ${otras}` : ""}`,
    detalle: detalle.replace(/\$\s?[\d.]+/g, "$#").slice(0, 200), motivo: esNuevo ? motivoSinSello(base, it) : "-",
    saldoFinalLeido: res.censo?.saldo_final ?? null, saldoInicialLeido: res.censo?.saldo_inicial ?? null,
  };
}

// ---------------------------------------------------------------------------
// Simulación "cartola anterior" (SOLO se mide acá; el lector no la implementa)

let Nmods: {
  heur: Mods["heur"]; named: Mods["named"]; apply: Mods["apply"];
  validator: typeof import("../../src/lib/parsers/validator");
  juez: typeof import("../../src/lib/parsers/juez-banco");
  orq: Mods["orq"];
};

/** Re-sella la lectura del NUEVO (sin caché ni IA) como si el saldo inicial viniera de la cartola anterior. */
function sellarConSaldoAnterior(buf: ArrayBuffer, saldoAnterior: number): string {
  const wb = leerLibroNuevo(buf);
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as never[];
    if (!rows.length) continue;
    const formulas = Nmods.juez.formulasSuma(sheet, XLSX.utils.decode_range, XLSX.utils.decode_cell);
    const resumen = Nmods.juez.detectarResumenImpreso(rows);
    const otras = Nmods.orq.otrasHojasConDatos(wb, sn);
    for (const cfg of [Nmods.heur.detectHeuristic(rows), Nmods.named.detectByNames(rows)]) {
      if (!cfg) continue;
      const descartes: never[] = [];
      const lines = Nmods.apply.applyAdapter(rows, cfg, descartes, undefined, { filasFormula: new Set(formulas.map((f) => f.fila)) });
      if (!Nmods.validator.validate(lines, rows, cfg, descartes).ok) continue;
      const v = Nmods.juez.sellarCartola({ rows, cfg, lines, descartes, resumen: { ...(resumen ?? {}), saldoInicial: saldoAnterior }, formulas });
      if (otras.length && !v.alerta) return "sin_comprobar";
      return v.tipo;
    }
  }
  return "capa4";
}

// ---------------------------------------------------------------------------
// Estadística

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(1)}%` : "—");
const ic = (k: number, n: number) => { const [a, b] = wilson(k, n); return n ? `${(100 * a).toFixed(1)}–${(100 * b).toFixed(1)}` : "—"; };
const tasa = (k: number, n: number) => `${pct(k, n)} (${k}/${n}; IC95 ${ic(k, n)})`;

async function pool<T, R>(xs: T[], n: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k], k); } }));
  return out;
}

// ---------------------------------------------------------------------------

async function main() {
  if (!ACTUAL && !REPRO) throw new Error("Falta LECTOR_ACTUAL=<worktree de origin/dev>");
  mkdirSync(SALIDA, { recursive: true });
  leerLibroNuevo = (await import("../../src/lib/parsers/libro")).leerLibroCartola;
  let corpus = [...construirCorpus(), ...(await corpusExterno())];
  if (Number.isFinite(LIMITE)) corpus = corpus.filter((_, i) => i % Math.ceil(corpus.length / LIMITE) === 0);

  if (REPRO) {
    const it = corpus.find((c) => c.id === REPRO);
    if (!it) throw new Error(`no existe ${REPRO}`);
    const f = join(SALIDA, `repro.${it.ext}`);
    writeFileSync(f, Buffer.from(it.buf));
    console.log(`escrito ${f} · verdad ${it.verdad.length} movs (${it.verdad.filter((m) => m.tipo === "ENTRADA").length} entradas)`);
    return;
  }

  const A = await cargar(ACTUAL!);
  const N = await cargar(NUEVO);
  Nmods = { heur: N.heur, named: N.named, apply: N.apply, orq: N.orq, validator: await import("../../src/lib/parsers/validator"), juez: await import("../../src/lib/parsers/juez-banco") };
  process.stderr.write(`corpus: ${corpus.length} cartolas (${Object.entries(corpus.reduce<Record<string, number>>((m, c) => { m[c.fuente] = (m[c.fuente] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k} ${v}`).join(", ")})\n`);

  // Fase 1: ACTUAL y NUEVO sin IA (determinístico, sin red)
  delete process.env.LECTOR_ESTRUCTURA_IA;
  const filas: { it: Item; actual: Salida; nuevo: Salida; nuevoIa?: Salida; simAnterior?: string }[] = [];
  let k = 0;
  for (const it of corpus) {
    const actual = await correr(A, it, false);
    const nuevo = await correr(N, it, true);
    // Cota superior "cartola anterior": el saldo final de la cartola previa = saldo inicial verdadero.
    let simAnterior: string | undefined;
    if (nuevo.sello !== "saldo" && nuevo.sello !== "total_banco" && nuevo.capa !== 4 && Number.isFinite(it.meta.saldoInicial) && it.fuente !== "sabotaje" && it.fuente !== "adversarial") {
      try { simAnterior = sellarConSaldoAnterior(it.buf, it.meta.saldoInicial); } catch { simAnterior = "error"; }
    }
    filas.push({ it, actual, nuevo, simAnterior });
    if (++k % 250 === 0) process.stderr.write(`  ${k}/${corpus.length}\n`);
  }

  // Fase 2: NUEVO + IA sobre una muestra estratificada (misma n para las 3 columnas)
  const muestraIa: number[] = [];
  if (!SIN_IA) {
    const r = rngDe(4242);
    const porFam = new Map<string, number[]>();
    filas.forEach((f, i) => porFam.set(f.it.spec_id, [...(porFam.get(f.it.spec_id) ?? []), i]));
    const cuota = N_IA / filas.length;
    for (const [, idxs] of porFam) {
      const n = Math.max(2, Math.round(idxs.length * cuota));
      const barajados = [...idxs].sort(() => r() - 0.5);
      muestraIa.push(...barajados.slice(0, n));
    }
    // Caché por cuerpo: la misma grilla enmascarada no se pregunta dos veces.
    const cache = new Map<string, Promise<{ txt: string; status: number }>>();
    let llamadas = 0;
    const fetchRed = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = typeof init?.body === "string" ? createHash("sha256").update(init.body).digest("hex") : null;
      if (!key) return fetchRed(input, init);
      if (!cache.has(key)) { llamadas++; cache.set(key, fetchRed(input, init).then(async (x) => ({ txt: await x.text(), status: x.status }))); }
      const x = await cache.get(key)!;
      return new Response(x.txt, { status: x.status });
    }) as typeof fetch;
    process.env.LECTOR_ESTRUCTURA_IA = "1";
    let hechas = 0;
    await pool(muestraIa, CONCURRENCIA_IA, async (i) => {
      filas[i].nuevoIa = await correr(N, filas[i].it, true);
      if (++hechas % 50 === 0) process.stderr.write(`  IA ${hechas}/${muestraIa.length} (llamadas reales ${llamadas})\n`);
    });
    delete process.env.LECTOR_ESTRUCTURA_IA;
    process.stderr.write(`IA: ${muestraIa.length} cartolas, ${llamadas} llamadas reales a DeepSeek\n`);
    (globalThis as { __llamadasIa?: number }).__llamadasIa = llamadas;
  }

  // Fase 3: secuencias de 2-3 cartolas consecutivas de la MISMA cuenta (saldo encadenado)
  const cadenas = simularCadenas(N);
  const cadenasRes = await cadenas;

  const md = informe(filas, muestraIa, cadenasRes);
  writeFileSync(join(SALIDA, "tablas.md"), md);
  writeFileSync(join(SALIDA, "resultados.json"), JSON.stringify({
    red: reporteSoloOpenCode(), llamadasIa: (globalThis as { __llamadasIa?: number }).__llamadasIa ?? 0,
    filas: filas.map((f) => ({ id: f.it.id, familia: f.it.spec_id, fuente: f.it.fuente, ambigua: f.it.ambigua, verdad: f.it.verdad.length, meta: f.it.meta, actual: f.actual, nuevo: f.nuevo, nuevoIa: f.nuevoIa, simAnterior: f.simAnterior })),
    cadenas: cadenasRes,
  }, null, 1));
  console.log(md);
  console.log(`\n${reporteSoloOpenCode()}`);
}

/**
 * conAnterior: re-sello si la cartola ANTERIOR quedó comprobada por el banco (regla estricta).
 * conConfirmada: re-sello si la anterior quedó comprobada o el cliente la confirmó UNA vez
 * (se simula que confirma solo si la lectura era exacta).
 */
interface ResCadena { spec: string; mutacion: string; pos: number; sello: string; exacta: boolean; conAnterior: string | null; conConfirmada: string | null; motivo: string; tieneSaldo: boolean }

async function simularCadenas(N: Mods): Promise<ResCadena[]> {
  const specs = leerSpecs().filter((s) => !SOLO_SPEC || s.id === SOLO_SPEC);
  const out: ResCadena[] = [];
  const variantes = ["base", "sin_saldo", "orden_invertido", "saldo_inicial_fila", "resumen_arriba", "fecha_sin_anio", "pocas_filas", "columna_insertada", "titulos_genericos"];
  delete process.env.LECTOR_ESTRUCTURA_IA;
  for (const s of specs) {
    for (const v of variantes) {
      for (const semilla of [1, 2]) {
        const seed = 900_000 + specs.indexOf(s) * 100 + variantes.indexOf(v) * 10 + semilla;
        const m = mutar(s, [v], rngDe(seed));
        if (!m) continue;
        const largo = semilla === 1 ? 2 : 3;
        const r = rngDe(seed);
        const cuenta = String(10_000_000 + Math.floor(r() * 89_999_999));
        let saldo = 1_000_000 + Math.floor(r() * 20_000_000);
        let anterior: { sellada: boolean; confirmada: boolean; saldoFinal: number | null } | null = null;
        for (let pos = 0; pos < largo; pos++) {
          const c = rendir(m, seed * 10 + pos, { mes: 6 + pos, saldo0: saldo, cuenta });
          saldo = c.meta.saldoFinal;
          const it: Item = { ...c, fuente: "spec", ambigua: false };
          it.id = idDe(it);
          const res = await correr(N, it, true);
          const probada = res.sello === "saldo" || res.sello === "total_banco";
          let conAnterior: string | null = null;
          // Regla simulada: si la cartola anterior de la MISMA cuenta quedó comprobada,
          // su saldo final (leído) es el saldo inicial de ésta.
          if (!probada && res.capa !== 4 && anterior?.sellada && anterior.saldoFinal != null) conAnterior = sellarConSaldoAnterior(c.buf, anterior.saldoFinal);
          let conConfirmada: string | null = null;
          if (!probada && res.capa !== 4 && anterior?.confirmada && anterior.saldoFinal != null) conConfirmada = sellarConSaldoAnterior(c.buf, anterior.saldoFinal);
          const sella = (x: string | null) => x === "saldo" || x === "total_banco";
          out.push({ spec: s.id, mutacion: v, pos, sello: res.sello, exacta: res.exacta, conAnterior, conConfirmada, motivo: res.motivo, tieneSaldo: c.meta.tieneSaldo });
          // La cadena sigue viva si esta quedó comprobada (banco o regla) y bien leída.
          anterior = {
            sellada: (probada || sella(conAnterior)) && res.exacta,
            confirmada: (probada || sella(conConfirmada) || res.exacta) && res.exacta,
            saldoFinal: res.saldoFinalLeido,
          };
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Informe

function informe(filas: { it: Item; actual: Salida; nuevo: Salida; nuevoIa?: Salida; simAnterior?: string }[], muestraIa: number[], cadenas: ResCadena[]): string {
  const L: string[] = [];
  const n = filas.length;
  const cuenta = (xs: Salida[], clase: string) => xs.filter((x) => x.clase === clase).length;
  const A = filas.map((f) => f.actual), Nn = filas.map((f) => f.nuevo);
  L.push(`# Pruebas masivas del lector — ${new Date().toISOString().slice(0, 16)}`, "");
  L.push(`Corpus: **${n} cartolas** (${Object.entries(filas.reduce<Record<string, number>>((m, f) => { m[f.it.fuente] = (m[f.it.fuente] ?? 0) + 1; return m; }, {})).map(([k, v]) => `${k} ${v}`).join(" · ")}); ambiguas por construcción ${filas.filter((f) => f.it.ambigua).length}.`, "");
  L.push("## 1. ACTUAL vs NUEVO (sin IA), corpus completo", "");
  L.push("| Resultado | ACTUAL | NUEVO |", "|---|---|---|");
  const exA = A.filter((x) => x.exacta).length, exN = Nn.filter((x) => x.exacta).length;
  L.push(`| Exacta (fecha, monto y dirección de cada fila) | ${tasa(exA, n)} | ${tasa(exN, n)} |`);
  L.push(`| Exacta con prueba (sello saldo/total_banco) | — | ${tasa(cuenta(Nn, "EXACTA_PROBADA"), n)} |`);
  L.push(`| Exacta con sello cliente (plantilla massDTE) | — | ${tasa(cuenta(Nn, "EXACTA_CLIENTE"), n)} |`);
  L.push(`| Exacta pidiendo confirmar | — | ${tasa(cuenta(Nn, "EXACTA_PREGUNTA"), n)} |`);
  L.push(`| Mal leída CON aviso | ${tasa(cuenta(A, "MAL_CON_AVISO"), n)} | ${tasa(cuenta(Nn, "MAL_CON_AVISO"), n)} |`);
  L.push(`| Mal leída, pide confirmar SIN alerta | — | ${tasa(cuenta(Nn, "MAL_PREGUNTA_SIN_ALERTA"), n)} |`);
  L.push(`| SILENCIOSA (mal y sin aviso) | ${tasa(cuenta(A, "SILENCIOSA"), n)} | — (el nuevo siempre pide confirmar sin sello) |`);
  L.push(`| SELLO QUE MIENTE (mal y sellada) | — | ${tasa(cuenta(Nn, "SELLO_MIENTE"), n)} |`);
  L.push(`| Capa 4 (IA lee la hoja entera) | ${tasa(cuenta(A, "CAPA4"), n)} | ${tasa(cuenta(Nn, "CAPA4"), n)} |`);
  L.push(`| Rechazo falso (capa 4 pudiendo leerla exacta) | ${tasa(cuenta(A, "RECHAZO_FALSO"), n)} | ${tasa(cuenta(Nn, "RECHAZO_FALSO"), n)} |`);
  L.push(`| Error (excepción) | ${tasa(cuenta(A, "ERROR"), n)} | ${tasa(cuenta(Nn, "ERROR"), n)} |`, "");
  const mejora = filas.filter((f) => !f.actual.exacta && f.nuevo.exacta).length;
  const empeora = filas.filter((f) => f.actual.exacta && !f.nuevo.exacta).length;
  L.push(`Pares: el nuevo lee exacta donde el actual NO: **${mejora}**; el actual exacta y el nuevo NO: **${empeora}**. Silenciosas del actual que el nuevo lee exacta: ${filas.filter((f) => f.actual.clase === "SILENCIOSA" && f.nuevo.exacta).length}; silenciosas del actual que el nuevo marca (aviso o pide confirmar): ${filas.filter((f) => f.actual.clase === "SILENCIOSA" && !f.nuevo.exacta && f.nuevo.clase !== "SELLO_MIENTE").length}.`, "");

  // Nunca preguntar
  L.push("## 2. Métrica «nunca preguntar» (NUEVO sin IA)", "");
  const sola = cuenta(Nn, "EXACTA_PROBADA");
  const noAmb = filas.filter((f) => !f.it.ambigua);
  L.push(`- Comprobadas SOLAS (sello saldo/total_banco y exactas): **${tasa(sola, n)}**`);
  L.push(`- Sin contar plantilla massDTE ni ambiguas: ${tasa(noAmb.filter((f) => f.nuevo.clase === "EXACTA_PROBADA").length, noAmb.filter((f) => f.it.spec_id !== "plantilla-massdte-boletas").length)}`);
  L.push(`- No preguntan (sello saldo/total_banco/cliente): ${tasa(Nn.filter((x) => ["saldo", "total_banco", "cliente"].includes(x.sello)).length, n)}`, "");
  const motivos = new Map<string, number>();
  for (const x of Nn) if (x.clase !== "EXACTA_PROBADA" && x.clase !== "EXACTA_CLIENTE") motivos.set(x.motivo, (motivos.get(x.motivo) ?? 0) + 1);
  const resto = n - sola - cuenta(Nn, "EXACTA_CLIENTE");
  L.push("Qué impide sellar el resto:", "", "| Motivo | Cartolas | % del resto |", "|---|---|---|");
  for (const [m, c] of [...motivos].sort((a, b) => b[1] - a[1])) L.push(`| ${m} | ${c} | ${pct(c, resto)} |`);
  L.push("");
  const conSim = filas.filter((f) => f.simAnterior != null);
  const simSella = conSim.filter((f) => f.simAnterior === "saldo" || f.simAnterior === "total_banco" ).filter((f) => f.nuevo.exacta).length;
  L.push(`Cota superior con verificación por la CARTOLA ANTERIOR (saldo inicial = saldo final verdadero de la cartola previa, re-sellando con el mismo juez): se sellarían **${simSella}** más (exactas) → comprobadas solas ${tasa(sola + simSella, n)}. Por motivo:`, "");
  const porMotSim = new Map<string, number>();
  for (const f of conSim) if ((f.simAnterior === "saldo" || f.simAnterior === "total_banco") && f.nuevo.exacta) porMotSim.set(f.nuevo.motivo, (porMotSim.get(f.nuevo.motivo) ?? 0) + 1);
  L.push("| Motivo original | Se sellarían con la cartola anterior |", "|---|---|");
  for (const [m, c] of [...porMotSim].sort((a, b) => b[1] - a[1])) L.push(`| ${m} | ${c} |`);
  const simMiente = conSim.filter((f) => (f.simAnterior === "saldo" || f.simAnterior === "total_banco") && !f.nuevo.exacta).length;
  L.push("", `Ojo: con la regla simulada, ${simMiente} cartolas MAL leídas quedarían selladas (el sello mentiría).`, "");

  // Cadenas
  L.push("## 3. Secuencias de 2-3 cartolas consecutivas de la misma cuenta", "");
  const porPos = [0, 1, 2].map((p) => cadenas.filter((c) => c.pos === p));
  const sel = (x: string | null) => x === "saldo" || x === "total_banco";
  const solaC = (c: ResCadena) => sel(c.sello) && c.exacta;
  const estricta = (c: ResCadena) => (sel(c.sello) || sel(c.conAnterior)) && c.exacta;
  const confirmada = (c: ResCadena) => (sel(c.sello) || sel(c.conConfirmada)) && c.exacta;
  L.push("Regla A (estricta): la anterior quedó comprobada por el banco. Regla B: la anterior quedó comprobada o el cliente la confirmó UNA vez.", "");
  L.push("| Posición | n | Sellada sola | Con regla A | Con regla B | Sello que miente (A/B) |", "|---|---|---|---|---|---|");
  for (const [p, xs] of porPos.entries()) {
    if (!xs.length) continue;
    const miente = `${xs.filter((c) => sel(c.conAnterior) && !c.exacta).length}/${xs.filter((c) => sel(c.conConfirmada) && !c.exacta).length}`;
    L.push(`| ${p + 1}ª | ${xs.length} | ${tasa(xs.filter(solaC).length, xs.length)} | ${tasa(xs.filter(estricta).length, xs.length)} | ${tasa(xs.filter(confirmada).length, xs.length)} | ${miente} |`);
  }
  const tail = cadenas.filter((c) => c.pos > 0);
  const tailSaldo = tail.filter((c) => c.tieneSaldo);
  L.push("", `Cartolas 2ª y 3ª: sola ${tasa(tail.filter(solaC).length, tail.length)} → regla A ${tasa(tail.filter(estricta).length, tail.length)} → regla B ${tasa(tail.filter(confirmada).length, tail.length)}.`);
  L.push(`Solo las que traen columna de saldo: sola ${tasa(tailSaldo.filter(solaC).length, tailSaldo.length)} → regla A ${tasa(tailSaldo.filter(estricta).length, tailSaldo.length)} → regla B ${tasa(tailSaldo.filter(confirmada).length, tailSaldo.length)}.`, "");
  L.push("| Familia | 2ª-3ª sola | regla A | regla B | n |", "|---|---|---|---|---|");
  for (const f of [...new Set(tail.map((c) => c.spec))]) {
    const xs = tail.filter((c) => c.spec === f);
    L.push(`| ${f} | ${pct(xs.filter(solaC).length, xs.length)} | ${pct(xs.filter(estricta).length, xs.length)} | ${pct(xs.filter(confirmada).length, xs.length)} | ${xs.length} |`);
  }
  L.push("", "| Variante | 2ª-3ª sola | regla A | regla B | n |", "|---|---|---|---|---|");
  for (const v of [...new Set(tail.map((c) => c.mutacion))]) {
    const xs = tail.filter((c) => c.mutacion === v);
    L.push(`| ${v} | ${pct(xs.filter(solaC).length, xs.length)} | ${pct(xs.filter(estricta).length, xs.length)} | ${pct(xs.filter(confirmada).length, xs.length)} | ${xs.length} |`);
  }
  L.push("");

  // IA
  if (muestraIa.length) {
    const m = muestraIa.map((i) => filas[i]);
    const nm = m.length;
    L.push(`## 4. ACTUAL vs NUEVO vs NUEVO+IA (muestra estratificada n=${nm})`, "");
    L.push("| Resultado | ACTUAL | NUEVO | NUEVO+IA |", "|---|---|---|---|");
    const col = (sel: (f: typeof m[number]) => Salida | undefined, clase: string) => tasa(m.filter((f) => sel(f)?.clase === clase).length, nm);
    L.push(`| Exacta | ${tasa(m.filter((f) => f.actual.exacta).length, nm)} | ${tasa(m.filter((f) => f.nuevo.exacta).length, nm)} | ${tasa(m.filter((f) => f.nuevoIa?.exacta).length, nm)} |`);
    for (const c of ["EXACTA_PROBADA", "EXACTA_PREGUNTA", "MAL_CON_AVISO", "MAL_PREGUNTA_SIN_ALERTA", "SELLO_MIENTE", "CAPA4", "RECHAZO_FALSO"]) {
      L.push(`| ${c} | ${["EXACTA_PROBADA", "EXACTA_PREGUNTA", "MAL_PREGUNTA_SIN_ALERTA", "SELLO_MIENTE"].includes(c) ? "—" : col((f) => f.actual, c)} | ${col((f) => f.nuevo, c)} | ${col((f) => f.nuevoIa, c)} |`);
    }
    L.push(`| SILENCIOSA (actual) | ${col((f) => f.actual, "SILENCIOSA")} | — | — |`);
    const ayuda = m.filter((f) => !f.nuevo.exacta && f.nuevoIa?.exacta).length;
    const dana = m.filter((f) => f.nuevo.exacta && !f.nuevoIa?.exacta).length;
    const disp = m.filter((f) => f.nuevoIa?.disputa).length;
    const lat = m.map((f) => f.nuevoIa?.ms ?? 0).sort((a, b) => a - b);
    L.push("", `La IA arregla ${ayuda} y estropea ${dana}; disputas (dos opiniones distintas → pide mirar) ${disp}. Latencia del orquestador con IA: p50 ${lat[Math.floor(nm / 2)]} ms, p90 ${lat[Math.floor(nm * 0.9)]} ms, máx ${lat[nm - 1]} ms.`, "");
    L.push(`Comprobadas solas: NUEVO ${tasa(m.filter((f) => f.nuevo.clase === "EXACTA_PROBADA").length, nm)} vs NUEVO+IA ${tasa(m.filter((f) => f.nuevoIa?.clase === "EXACTA_PROBADA").length, nm)}.`, "");
  }

  // Por familia
  L.push("## 5. Por familia de formato (corpus completo, sin IA)", "");
  L.push("| Familia | n | Exacta ACTUAL | Exacta NUEVO | Comprobada sola NUEVO | Silenciosa ACTUAL | Sello miente NUEVO | Capa 4 A→N |", "|---|---|---|---|---|---|---|---|");
  const fams = [...new Set(filas.map((f) => f.it.spec_id))];
  for (const fa of fams) {
    const xs = filas.filter((f) => f.it.spec_id === fa);
    const k = xs.length;
    L.push(`| ${fa} | ${k} | ${pct(xs.filter((f) => f.actual.exacta).length, k)} | ${pct(xs.filter((f) => f.nuevo.exacta).length, k)} | ${pct(xs.filter((f) => f.nuevo.clase === "EXACTA_PROBADA").length, k)} (IC ${ic(xs.filter((f) => f.nuevo.clase === "EXACTA_PROBADA").length, k)}) | ${xs.filter((f) => f.actual.clase === "SILENCIOSA").length} | ${xs.filter((f) => f.nuevo.clase === "SELLO_MIENTE").length} | ${xs.filter((f) => f.actual.capa === 4).length}→${xs.filter((f) => f.nuevo.capa === 4).length} |`);
  }
  L.push("");

  // Por mutación (solo simples)
  L.push("## 6. Por mutación (specs base, mutación simple)", "");
  L.push("| Mutación | n | Exacta A | Exacta N | Sola N | Silenciosa A | Miente N |", "|---|---|---|---|---|---|---|");
  const muts = [...new Set(filas.filter((f) => f.it.fuente === "spec").map((f) => f.it.mutaciones.join("+") || "base"))];
  for (const mu of muts) {
    const xs = filas.filter((f) => f.it.fuente === "spec" && (f.it.mutaciones.join("+") || "base") === mu);
    const k = xs.length;
    L.push(`| ${mu} | ${k} | ${pct(xs.filter((f) => f.actual.exacta).length, k)} | ${pct(xs.filter((f) => f.nuevo.exacta).length, k)} | ${pct(xs.filter((f) => f.nuevo.clase === "EXACTA_PROBADA").length, k)} | ${xs.filter((f) => f.actual.clase === "SILENCIOSA").length} | ${xs.filter((f) => f.nuevo.clase === "SELLO_MIENTE").length} |`);
  }
  L.push("");

  // Peores casos del nuevo
  L.push("## 7. Los 20 peores casos del NUEVO", "");
  const peso = (f: typeof filas[number]) => {
    const x = f.nuevoIa ?? f.nuevo;
    return (f.nuevo.clase === "SELLO_MIENTE" ? 100 : 0) + (f.nuevoIa?.clase === "SELLO_MIENTE" ? 90 : 0) + (f.nuevo.clase === "MAL_PREGUNTA_SIN_ALERTA" ? 50 : 0)
      + (f.actual.exacta && !f.nuevo.exacta ? 30 : 0) + (f.nuevo.clase === "RECHAZO_FALSO" ? 20 : 0) + (x.clase === "CAPA4" ? 5 : 0) - (f.it.ambigua ? 60 : 0);
  };
  const vistos = new Set<string>();
  const peores = [...filas].sort((a, b) => peso(b) - peso(a)).filter((f) => { const k = `${f.it.spec_id}|${f.nuevo.clase}|${f.nuevo.motivo}|${f.it.mutaciones.join("+")}`; if (vistos.has(k)) return false; vistos.add(k); return peso(f) > 0; }).slice(0, 20);
  L.push("| # | Cartola (id = repro) | ACTUAL | NUEVO | NUEVO+IA | Detalle |", "|---|---|---|---|---|---|");
  peores.forEach((f, i) => L.push(`| ${i + 1} | \`${f.it.id}\` | ${f.actual.clase} | ${f.nuevo.clase} (${f.nuevo.sello}) | ${f.nuevoIa ? `${f.nuevoIa.clase} (${f.nuevoIa.sello})` : "—"} | ${f.nuevo.det}; ${f.nuevo.detalle.slice(0, 110)} |`));
  L.push("", "Reproducir: `LECTOR_ACTUAL=… npx tsx scripts/corpus-cartolas/correr.ts --repro=<id>` escribe el archivo.", "");
  return L.join("\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
