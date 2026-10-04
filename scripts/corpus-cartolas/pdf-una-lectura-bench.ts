/**
 * Medición "una sola apertura" (2026-10-03): ms y memoria por PDF de la lectura
 * de la cola, ANTES (getText de pdf-parse + leerItemsPdf = dos aperturas) vs
 * DESPUÉS (leerPdf = una apertura). Corpus PDF SINTÉTICO (sin datos reales).
 * Cada modo corre en su PROPIO proceso (memoria comparable). Correr en la mini:
 *
 *   npx tsx scripts/corpus-cartolas/pdf-una-lectura-bench.ts generar <dir> [n=200]
 *   node --expose-gc $(tsx) ... medir <dir> antes|despues
 *   npx tsx scripts/corpus-cartolas/pdf-una-lectura-bench.ts banco [dir]   (banco seudonimizado: items JSON)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { cartolaPdfSintetica, negativoPdfSintetico, TIPOS_NEGATIVOS, type FormatoPdf } from "../../src/lib/parsers/testing/cartola-pdf-sintetica";

const [modo, dir = join(process.env.TMPDIR ?? "/tmp", "pdf-una-lectura"), extra] = process.argv.slice(2);
const LARGOS = [1, 2, 3, 5, 8, 12, 20, 30, 45, 60, 90, 140, 200];

async function generar() {
  const n = Number(extra ?? 200);
  mkdirSync(dir, { recursive: true });
  for (let s = 0; s < n; s++) {
    const pdf = s % 5 === 4
      ? await negativoPdfSintetico(TIPOS_NEGATIVOS[s % TIPOS_NEGATIVOS.length], s, 6 + (s % 30))
      : (await cartolaPdfSintetica({ formato: (["itau", "estado"] as FormatoPdf[])[s % 2], filas: LARGOS[s % LARGOS.length], seed: s, glosaMultilinea: s % 3 === 0 })).pdf;
    writeFileSync(join(dir, `s${String(s).padStart(4, "0")}.pdf`), pdf);
  }
  console.log(`${n} PDFs en ${dir}`);
}

const q = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const mem = () => { const m = process.memoryUsage(); return m.heapUsed + m.external; };

async function medir() {
  const { leerPdf, leerItemsPdf } = await import("../../src/lib/parsers/pdf-grilla");
  const { PDFParse } = await import("pdf-parse");
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error("correr con node --expose-gc");
  const archivos = readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort();
  const pdfs = archivos.map((f) => new Uint8Array(readFileSync(join(dir, f))));
  const leer = extra === "antes"
    ? async (pdf: Uint8Array) => {
      const p = new PDFParse({ data: new Uint8Array(pdf) });
      let texto: string;
      try { texto = (await p.getText()).text; } finally { await p.destroy().catch(() => {}); }
      return { texto, items: (await leerItemsPdf(pdf)).items };
    }
    : (pdf: Uint8Array) => leerPdf(pdf);
  for (const pdf of pdfs.slice(0, 10)) await leer(pdf); // calentar (JIT, worker)
  const ms: number[] = [], bytes: number[] = [];
  let chars = 0, items = 0;
  for (const pdf of pdfs) {
    gc();
    const m0 = mem();
    let pico = m0;
    const reloj = setInterval(() => { pico = Math.max(pico, mem()); }, 1);
    const t0 = performance.now();
    const r = await leer(pdf);
    ms.push(performance.now() - t0);
    clearInterval(reloj);
    pico = Math.max(pico, mem());
    bytes.push(pico - m0);
    chars += r.texto.length; items += r.items.length;
  }
  const kb = (b: number) => Math.round(b / 1024);
  const rss = process.resourceUsage().maxRSS; // KB
  console.log(JSON.stringify({
    modo: extra, pdfs: pdfs.length, chars, items,
    ms_mediana: +q(ms, 0.5).toFixed(2), ms_p95: +q(ms, 0.95).toFixed(2), ms_total: Math.round(ms.reduce((a, b) => a + b, 0)),
    mem_pico_kb_mediana: kb(q(bytes, 0.5)), mem_pico_kb_p95: kb(q(bytes, 0.95)), max_rss_mb: Math.round(rss / 1024),
  }));
}

/** Banco seudonimizado (JSON de items, no PDFs): el lector con posiciones YA leídas = el de antes. */
async function banco() {
  const d = extra ?? join(process.env.HOME ?? "", "entrenamiento-lector", "banco-seudonimizado");
  const { parsePdfCartola, parseExcel } = await import("../../src/lib/parsers");
  const { libroDesdeGrilla } = await import("../../src/lib/parsers/pdf-grilla");
  const { clasificarPdf } = await import("../../src/lib/parsers/pdf-router");
  let iguales = 0, total = 0;
  for (const f of readdirSync(d).filter((x) => x.endsWith(".json")).sort()) {
    const { id, items } = JSON.parse(readFileSync(join(d, f), "utf8")) as { id: string; items: import("../../src/lib/parsers/pdf-grilla").ItemPdf[] };
    const paginas = Math.max(0, ...items.map((i) => i.pagina));
    // DESPUÉS: la cola le pasa las posiciones de la apertura única (el PDF ni se mira).
    const nuevo = await parsePdfCartola(new Uint8Array(0), { leido: { items, paginas, truncado: false } });
    // ANTES: lo que hacía parsePdfCartola tras leerItemsPdf (router → grilla → lector).
    const ruta = clasificarPdf(items);
    const viejo = ruta.tipo === "cartola" && ruta.rows.length ? await parseExcel(libroDesdeGrilla(ruta.rows), { origen: "pdf" }) : null;
    const viejoLeido = viejo && viejo.capa_usada < 4 && viejo.preExtracted?.length ? viejo : null;
    const ok = JSON.stringify(nuevo?.preExtracted ?? null) === JSON.stringify(viejoLeido?.preExtracted ?? null)
      && (nuevo?.censo?.verificacion?.tipo ?? null) === (viejoLeido?.censo?.verificacion?.tipo ?? null);
    total++; if (ok) iguales++;
    console.log(`${id}\t${ok ? "igual" : "DISTINTO"}\tfilas ${nuevo?.preExtracted?.length ?? 0}\tsello ${nuevo?.censo?.verificacion?.tipo ?? "-"}`);
  }
  console.log(`banco: ${iguales}/${total} iguales`);
}

(modo === "generar" ? generar() : modo === "medir" ? medir() : modo === "banco" ? banco() : Promise.reject(new Error("modo: generar|medir|banco")))
  .catch((e) => { console.error(e); process.exit(1); });
