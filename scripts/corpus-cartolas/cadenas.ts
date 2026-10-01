/**
 * CADENA ENTRE CARTOLAS: envenenamiento y "lineage objetivo" (2026-09-30).
 * SOLO simulación del corpus: el lector NO implementa la cadena.
 *
 * Regla simulada: si la cartola ANTERIOR de la misma cuenta quedó aceptada, su
 * saldo final es el saldo inicial de ésta y se re-sella con el mismo juez (la
 * primera fila deja de estar "sin comprobar").
 *   - P1 "cualquier raíz": vale la anterior aceptada de cualquier forma (sello
 *     del banco, cadena, o el cliente la confirmó).
 *   - P2 "lineage objetivo": la raíz de la cadena tiene que ser una prueba del
 *     banco (saldo / total_banco); una confirmación del cliente no encadena.
 *
 * Veneno: la cartola A queda aceptada por el cliente con un cierre MALO
 * (saldo final registrado = verdadero + δ) y la B trae su primera fila leída
 * con −δ (el peor caso: el error de B compensa el de A). Con P1 la B sale
 * sellada con la lectura mala (y su cierre sigue envenenando a C); con P2 no.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import * as XLSX from "xlsx";
import { exacto, wilson, type L } from "./corpus";
import { leerSpecs, rendir, rngDe, type CartolaSintetica } from "./generador";
import { mutar } from "./mutaciones";
import { Libro } from "./danos";

type Mods = {
  orq: typeof import("../../src/lib/parsers/orchestrator");
  heur: typeof import("../../src/lib/parsers/heuristic");
  named: typeof import("../../src/lib/parsers/named");
  apply: typeof import("../../src/lib/parsers/apply");
  validator: typeof import("../../src/lib/parsers/validator");
  juez: typeof import("../../src/lib/parsers/juez-banco");
  libro: typeof import("../../src/lib/parsers/libro");
};

async function cargar(): Promise<Mods> {
  return {
    orq: await import("../../src/lib/parsers/orchestrator"),
    heur: await import("../../src/lib/parsers/heuristic"),
    named: await import("../../src/lib/parsers/named"),
    apply: await import("../../src/lib/parsers/apply"),
    validator: await import("../../src/lib/parsers/validator"),
    juez: await import("../../src/lib/parsers/juez-banco"),
    libro: await import("../../src/lib/parsers/libro"),
  };
}

/** Re-sella como si el saldo inicial viniera de la cartola anterior (mismo juez, sin caché ni IA). */
function sellarConSaldoAnterior(M: Mods, buf: ArrayBuffer, saldoAnterior: number): string {
  const wb = M.libro.leerLibroCartola(buf);
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" }) as never[];
    if (!rows.length) continue;
    const formulas = M.juez.formulasSuma(sheet, XLSX.utils.decode_range, XLSX.utils.decode_cell);
    const resumen = M.juez.detectarResumenImpreso(rows);
    const otras = M.orq.otrasHojasConDatos(wb, sn);
    for (const cfg of [M.heur.detectHeuristic(rows), M.named.detectByNames(rows)]) {
      if (!cfg) continue;
      const descartes: never[] = [];
      const lines = M.apply.applyAdapter(rows, cfg, descartes, undefined, { filasFormula: new Set(formulas.map((f) => f.fila)) });
      if (!M.validator.validate(lines, rows, cfg, descartes).ok) continue;
      const v = M.juez.sellarCartola({ rows, cfg, lines, descartes, resumen: { ...(resumen ?? {}), saldoInicial: saldoAnterior }, formulas });
      if (otras.length && !v.alerta) return "sin_comprobar";
      return v.tipo;
    }
  }
  return "capa4";
}

interface Lect { sello: string; exacta: boolean; saldoFinal: number | null }
async function leer(M: Mods, c: CartolaSintetica, buf = c.buf): Promise<Lect> {
  const r = (await M.orq.parseExcelWithOrchestrator(buf, {})).result;
  if (!r.preExtracted) return { sello: "capa4", exacta: false, saldoFinal: null };
  const lines: L[] = r.preExtracted.map((m) => ({ fecha: m.fecha, monto: m.monto, tipo: m.tipo_flujo === "entrada" ? "ENTRADA" : "SALIDA" }));
  return { sello: r.verificacion?.tipo ?? "sin_comprobar", exacta: exacto(lines, c.verdad).ok, saldoFinal: r.censo?.saldo_final ?? null };
}

const objetivo = (s: string) => s === "saldo" || s === "total_banco";
type Aceptada = "objetiva" | "cadena_objetiva" | "cliente" | "cadena_cliente" | null;
const POLITICAS = {
  p1: (a: Aceptada) => a != null,
  p2: (a: Aceptada) => a === "objetiva" || a === "cadena_objetiva",
};
type Pol = keyof typeof POLITICAS;

interface Fila { spec: string; variante: string; escenario: "limpio" | "veneno"; pos: number; sola: string; exacta: boolean; sellada: Record<Pol, boolean>; miente: Record<Pol, boolean> }

export async function correrCadenas(salida: string) {
  delete process.env.LECTOR_ESTRUCTURA_IA;
  const M = await cargar();
  const specs = leerSpecs();
  const variantes = ["base", "orden_invertido", "fecha_sin_anio", "columna_insertada", "titulos_genericos", "montos_texto_cl"];
  const filas: Fila[] = [];
  for (const s of specs) {
    for (const v of variantes) {
      for (const semilla of [1, 2, 3]) {
        const seed = 700_000 + specs.indexOf(s) * 100 + variantes.indexOf(v) * 10 + semilla;
        const m = mutar(s, [v], rngDe(seed));
        if (!m || !m.columnas.some((c) => c.rol === "saldo")) continue;
        for (const escenario of ["limpio", "veneno"] as const) {
          const r = rngDe(seed * 3 + (escenario === "veneno" ? 1 : 0));
          const cuenta = String(10_000_000 + Math.floor(r() * 89_999_999));
          let saldo = 1_000_000 + Math.floor(r() * 20_000_000);
          const delta = 1_000 + Math.floor(r() * 400_000);
          const prev: Record<Pol, { acept: Aceptada; final: number | null }> = { p1: { acept: null, final: null }, p2: { acept: null, final: null } };
          let aEnvenenada = false;
          for (let pos = 0; pos < 3; pos++) {
            const c = rendir(m, seed * 10 + pos, { mes: 5 + pos, saldo0: saldo, cuenta });
            saldo = c.meta.saldoFinal;
            let buf = c.buf;
            // B (pos 1) del escenario veneno: su primera fila (cronológica) con un
            // efecto de −δ en el saldo — el peor caso, compensa el cierre malo de A.
            if (escenario === "veneno" && pos === 1 && aEnvenenada) {
              const L0 = new Libro({ ...c, fuente: "spec", ambigua: false, spec: m }, m);
              const desc = (m.orden ?? "asc") === "desc";
              const x = [...L0.movs].sort((a, b) => (desc ? b.fila - a.fila : a.fila - b.fila))[0];
              const nuevo = x.mov.tipo === "ENTRADA" ? x.mov.monto - delta : x.mov.monto + delta;
              if (nuevo > 0) { L0.escribirMov(x.fila, nuevo, x.mov.tipo); buf = L0.escribir(); }
            }
            const l = await leer(M, c, buf);
            const propia = objetivo(l.sello);
            const sellada = { p1: false, p2: false } as Record<Pol, boolean>;
            for (const pol of Object.keys(POLITICAS) as Pol[]) {
              const pr = prev[pol];
              const cadena = !propia && pr.final != null && POLITICAS[pol](pr.acept) && objetivo(sellarConSaldoAnterior(M, buf, pr.final));
              sellada[pol] = propia || cadena;
              // Lo que queda registrado para la cartola siguiente.
              let acept: Aceptada = null;
              let final: number | null = l.saldoFinal;
              if (propia) acept = "objetiva";
              else if (cadena) acept = pr.acept === "objetiva" || pr.acept === "cadena_objetiva" ? "cadena_objetiva" : "cadena_cliente";
              else if (escenario === "veneno" && pos === 0) {
                // A: el cliente la confirma con un cierre MALO (+δ).
                acept = "cliente"; final = c.meta.saldoFinal + delta; aEnvenenada = true;
              } else if (l.exacta) acept = "cliente"; // cliente honesto: confirma solo lo bien leído
              prev[pol] = { acept, final: acept ? final : null };
            }
            filas.push({ spec: s.id, variante: v, escenario, pos, sola: l.sello, exacta: l.exacta, sellada, miente: { p1: sellada.p1 && !l.exacta, p2: sellada.p2 && !l.exacta } });
          }
        }
      }
    }
  }
  const md = informe(filas);
  writeFileSync(join(salida, "cadenas.md"), md);
  writeFileSync(join(salida, "cadenas.json"), JSON.stringify(filas));
  console.log(md);
}

function informe(filas: Fila[]): string {
  const t = (k: number, n: number) => { const [a, b] = wilson(k, n); return n ? `${((100 * k) / n).toFixed(1)}% (${k}/${n}; IC95 ${(100 * a).toFixed(1)}–${(100 * b).toFixed(1)})` : "—"; };
  const L: string[] = ["# Cadena entre cartolas — envenenamiento y lineage objetivo", "", "Formatos con columna de saldo; cadenas de 3 cartolas consecutivas de la misma cuenta. P1 = cualquier raíz; P2 = lineage objetivo (la raíz es saldo/total_banco).", ""];
  for (const esc of ["limpio", "veneno"] as const) {
    L.push(`## Escenario ${esc}`, "", "| Posición | n | Sellada sola (exacta) | P1 sellada exacta | P2 sellada exacta | Sello miente P1 | Sello miente P2 |", "|---|---|---|---|---|---|---|");
    for (const pos of [0, 1, 2]) {
      const xs = filas.filter((f) => f.escenario === esc && f.pos === pos);
      L.push(`| ${pos + 1}ª | ${xs.length} | ${t(xs.filter((f) => objetivo(f.sola) && f.exacta).length, xs.length)} | ${t(xs.filter((f) => f.sellada.p1 && f.exacta).length, xs.length)} | ${t(xs.filter((f) => f.sellada.p2 && f.exacta).length, xs.length)} | ${t(xs.filter((f) => f.miente.p1).length, xs.length)} | ${t(xs.filter((f) => f.miente.p2).length, xs.length)} |`);
    }
    const cola = filas.filter((f) => f.escenario === esc && f.pos > 0);
    L.push("", `2ª y 3ª: sola ${t(cola.filter((f) => objetivo(f.sola) && f.exacta).length, cola.length)} → P2 ${t(cola.filter((f) => f.sellada.p2 && f.exacta).length, cola.length)} → P1 ${t(cola.filter((f) => f.sellada.p1 && f.exacta).length, cola.length)}.`, "");
  }
  return L.join("\n");
}
