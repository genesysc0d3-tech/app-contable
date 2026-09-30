/**
 * El CORPUS sintético del lector (2026-09-30), compartido por correr.ts (pruebas
 * masivas) y sobrevivencia.ts (batería de sellos falsos): specs × mutaciones de
 * formato × semillas, combinaciones, variantes DeepSeek, sabotajes y (opcional)
 * los casos adversariales del scratchpad. Determinístico por semilla.
 */
import { existsSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";
import { leerSpecs, leerSpecsDeepSeek, rendir, rngDe, type CartolaSintetica, type Mov, type Spec } from "./generador";
import { MUTACIONES, mutar } from "./mutaciones";


export interface ItemCorpus extends CartolaSintetica { fuente: "spec" | "combo" | "deepseek" | "sabotaje" | "adversarial"; ambigua: boolean; /** Spec ya mutado (solo items del generador). */ spec?: Spec }
type Item = ItemCorpus;

export function idDe(c: CartolaSintetica) { return `${c.spec_id}|${c.mutaciones.join("+") || "base"}|s${c.seed}`; }

/** Dos columnas de plata sin saldo ni títulos que digan la dirección: la verdad no se puede deducir del archivo. */
export function direccionAmbigua(s: Spec): boolean {
  const cols = s.columnas;
  const dos = cols.some((c) => c.rol === "cargo") && cols.some((c) => c.rol === "abono");
  if (!dos || cols.some((c) => c.rol === "saldo")) return false;
  if (/TOTAL_(CARGOS|ABONOS)/.test(JSON.stringify([s.arriba, s.abajo, s.hojas_extra]))) return false;
  if (s.titulos === false) return true;
  const t = cols.filter((c) => c.rol === "cargo" || c.rol === "abono").map((c) => c.titulo.toLowerCase());
  return !t.every((x) => /cargo|abono|egreso|ingreso|debit|credit|dep[oó]sito|cheque|\(\s*[+-]\s*\)/.test(x));
}

export function construirCorpus(SOLO_SPEC?: string): Item[] {
  const specs = leerSpecs().filter((s) => !SOLO_SPEC || s.id === SOLO_SPEC);
  const out: Item[] = [];
  const agregar = (s: Spec | null, seed: number, fuente: Item["fuente"]) => {
    if (!s) return;
    const c = rendir(s, seed);
    const it: Item = { ...c, fuente, ambigua: direccionAmbigua(s), spec: s };
    it.id = idDe(it);
    out.push(it);
  };
  // 1) cada spec × cada mutación simple × 2 semillas
  for (const s of specs) {
    MUTACIONES.forEach((m, mi) => {
      for (const k of [0, 1]) {
        const seed = 10_000 + specs.indexOf(s) * 1_000 + mi * 10 + k;
        agregar(mutar(s, [m.id], rngDe(seed)), seed, "spec");
      }
    });
  }
  // 2) combinaciones de 2-3 mutaciones (semilla fija por spec)
  const ids = MUTACIONES.map((m) => m.id).filter((x) => x !== "base");
  for (const s of specs) {
    const r = rngDe(77_000 + specs.indexOf(s));
    let hechos = 0;
    for (let intento = 0; intento < 400 && hechos < 45; intento++) {
      const n = r() < 0.6 ? 2 : 3;
      const combo = Array.from({ length: n }, () => ids[Math.floor(r() * ids.length)]);
      if (new Set(combo).size !== n) continue;
      const seed = 200_000 + specs.indexOf(s) * 1_000 + intento;
      const m = mutar(s, combo, rngDe(seed));
      if (!m) continue;
      agregar(m, seed, "combo");
      hechos++;
    }
  }
  // 3) variantes adversariales inventadas por DeepSeek (specs/deepseek)
  for (const s of leerSpecsDeepSeek()) {
    if (SOLO_SPEC && !s.id.startsWith(SOLO_SPEC)) continue;
    for (const k of [0, 1, 2]) agregar(mutar(s, ["base"], rngDe(k)), 500_000 + out.length + k, "deepseek");
  }
  return out;
}

export async function corpusExterno(SOLO_SPEC?: string, ADVERSARIALES?: string): Promise<Item[]> {
  const out: Item[] = [];
  if (SOLO_SPEC) return out;
  // Banco de sabotajes del repo (5 bancos × 10 sabotajes).
  const { todasLasCartolas } = await import("../../src/lib/parsers/testing/sabotajes");
  for (const c of todasLasCartolas()) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(c.rows as unknown[][], { cellDates: true }), "Cartola");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    out.push({ id: `sabotaje|${c.nombre}`, familia: "banco de sabotajes (sintético)", spec_id: "sabotajes", mutaciones: [c.sabotaje], seed: 0, ext: "xlsx", buf, verdad: c.verdad, fuente: "sabotaje", ambigua: false,
      meta: { tieneSaldo: c.sabotaje !== "sin_saldo", saldoInicialImpreso: false, resumenImpreso: false, saldoInicial: 20_000_000, saldoFinal: NaN, cuenta: "sab", mes: 9, filtrada: false } });
  }
  // Casos de las revisiones adversariales 1-3 (scratchpad, opcionales).
  if (ADVERSARIALES && existsSync(join(ADVERSARIALES, "casos.ts"))) {
    const m1 = await import(join(ADVERSARIALES, "casos.ts"));
    const m2 = await import(join(ADVERSARIALES, "casos2.ts"));
    const m3 = await import(join(ADVERSARIALES, "casos3.ts"));
    const lista = [...m1.casos().map((c: unknown) => [c, m1.libroDe]), ...m2.casos2().map((c: unknown) => [c, m2.libro2]), ...m3.casos3().map((c: unknown) => [c, (x: unknown) => m3.libro3(x) ?? m2.libro2(x)])];
    for (const [c, libro] of lista as [{ id: string; verdad: Mov[]; discutible?: boolean; csv?: string }, (x: unknown) => ArrayBuffer][]) {
      out.push({ id: `adversarial|${c.id}`, familia: "revisiones adversariales 1-3", spec_id: "adversariales", mutaciones: [c.id], seed: 0, ext: c.csv != null ? "csv" : "xlsx", buf: libro(c), verdad: c.verdad, fuente: "adversarial", ambigua: !!c.discutible,
        meta: { tieneSaldo: true, saldoInicialImpreso: false, resumenImpreso: false, saldoInicial: NaN, saldoFinal: NaN, cuenta: "adv", mes: 9, filtrada: false } });
    }
  }
  return out;
}


// ---------------------------------------------------------------------------
// Comparación con la verdad y estadística

export type L = { fecha: string; monto: number; tipo: "ENTRADA" | "SALIDA" };
function normFecha(f: string) { const m = f.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; const d = f.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); return d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : f; }
export function exacto(lines: L[], v: Mov[]) {
  const k = (f: string, m: number, t: string) => `${normFecha(f)}|${m}|${t}`;
  const a = lines.map((l) => k(l.fecha, l.monto, l.tipo)).sort();
  const b = v.map((m) => k(m.fecha, m.monto, m.tipo)).sort();
  if (a.join() === b.join()) return { ok: true, det: `${a.length}/${b.length}` };
  const ca = new Map<string, number>(); a.forEach((x) => ca.set(x, (ca.get(x) ?? 0) + 1));
  let faltan = 0; for (const x of b) { const n = ca.get(x) ?? 0; if (n > 0) ca.set(x, n - 1); else faltan++; }
  const sobran = [...ca.values()].reduce((s, n) => s + n, 0);
  // ¿Solo la dirección está mal? (mismas fechas y montos)
  const sinTipo = (xs: string[]) => xs.map((x) => x.split("|").slice(0, 2).join("|")).sort().join();
  const soloDireccion = sinTipo(a) === sinTipo(b);
  return { ok: false, det: `leídas ${a.length}/${b.length} faltan ${faltan} sobran ${sobran}${soloDireccion ? " (solo dirección)" : ""}` };
}


export function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
