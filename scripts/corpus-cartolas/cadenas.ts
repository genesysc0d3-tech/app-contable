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

/** La primera fila (cronológica) de B leída con δ de diferencia: el peor caso que compensa el veneno de A. */
function compensar(c: CartolaSintetica, delta: number): { buf: ArrayBuffer } | null {
  if (!c.fisico || !c.spec_id) return null;
  return null;
}

export async function correrCadenas(salida: string) {
  delete process.env.LECTOR_ESTRUCTURA_IA;
  const M = await cargar();
  const specs = leerSpecs();
  const variantes = ["base", "orden_invertido", "fecha_sin_anio", "columna_insertada", "titulos_genericos", "montos_texto_cl"];
  const filas: { spec: string; variante: string; escenario: "limpio" | "veneno"; pos: number; sola: string; exacta: boolean; p1: boolean; p2: boolean; miente1: boolean; miente2: boolean }[] = [];
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
          let prev1: { acept: Aceptada; final: number | null } = { acept: null, final: null };
          let prev2: { acept: Aceptada; final: number | null } = { acept: null, final: null };
          for (let pos = 0; pos < 3; pos++) {
            const c = rendir(m, seed * 10 + pos, { mes: 5 + pos, saldo0: saldo, cuenta });
            saldo = c.meta.saldoFinal;
            let buf = c.buf;
            // Veneno: B (pos 1) trae la primera fila con −δ (compensa el cierre malo de A).
            let delta = 0;
            if (escenario === "veneno" && pos === 1) {
              delta = 1_000 + Math.floor(r() * 400_000);
              const L0 = new Libro({ ...c, fuente: "spec", ambigua: false, spec: m }, m);
              const desc = (m.orden ?? "asc") === "desc";
              const x = [...L0.movs].sort((a, b) => (desc ? b.fila - a.fila : a.fila - b.fila))[0];
              // Efecto en el saldo de −δ: una entrada baja δ, una salida sube δ.
              const nuevo = x.mov.tipo === "ENTRADA" ? x.mov.monto - delta : x.mov.monto + delta;
              if (nuevo <= 0) { delta = 0; } else { L0.escribirMov(x.fila, nuevo, x.mov.tipo); buf = L0.escribir(); }
            }
            const l = await leer(M, c, buf);
            const sola = l.sello;
            const exacta = l.exacta;
            // Re-sello por la cadena (cada política con SU cartola anterior).
            const conCadena = (prev: typeof prev1, permitida: (a: Aceptada) => boolean) =>
              !objetivo(sola) && prev.final != null && permitida(prev.acept) ? objetivo(sellarConSaldoAnterior(M, buf, prev.final)) : false;
            const p1 = objetivo(sola) || conCadena(prev1, (a) => a != null);
            const p2 = objetivo(sola) || conCadena(prev2, (a) => a === "objetiva" || a === "cadena_objetiva");
            filas.push({ spec: s.id, variante: v, escenario, pos, sola, exacta, p1, p2, miente1: p1 && !exacta, miente2: p2 && !exacta });
            // Qué queda registrado para la siguiente.
            const finalLeido = l.saldoFinal;
            const envenenado = escenario === "veneno" && pos === 0 && finalLeido != null ? finalLeido + (r() < 0.5 ? 1 : 1) * 0 : finalLeido;
            // A (pos 0) en "veneno": el cliente la confirmó con un cierre malo (+δ que B compensará).
            const nextDelta = escenario === "veneno" && pos === 0;
            const acept = (p: boolean, prev: typeof prev1, obj: boolean): Aceptada =>
              objetivo(sola) ? "objetiva" : p ? (prev.acept === "objetiva" || prev.acept === "cadena_objetiva" ? "cadena_objetiva" : "cadena_cliente") : exacta || nextDelta ? (obj ? null : "cliente") : null;
            const a1 = acept(p1, prev1, false);
            const a2 = acept(p2, prev2, true);
            prev1 = { acept: a1, final: envenenado };
            prev2 = { acept: a2 ?? (objetivo(sola) ? "objetiva" : null), final: envenenado };
            if (nextDelta) (prev1 as { pendienteVeneno?: boolean }).pendienteVeneno = true;
            void delta;
          }
        }
      }
    }
  }
  void compensar;
  const md = informe(filas);
  writeFileSync(join(salida, "cadenas.md"), md);
  writeFileSync(join(salida, "cadenas.json"), JSON.stringify(filas));
  console.log(md);
}

function informe(filas: { escenario: string; pos: number; sola: string; exacta: boolean; p1: boolean; p2: boolean; miente1: boolean; miente2: boolean }[]): string {
  const t = (k: number, n: number) => { const [a, b] = wilson(k, n); return n ? `${((100 * k) / n).toFixed(1)}% (${k}/${n}; IC95 ${(100 * a).toFixed(1)}–${(100 * b).toFixed(1)})` : "—"; };
  const L: string[] = ["# Cadena entre cartolas — envenenamiento y lineage objetivo", ""];
  for (const esc of ["limpio", "veneno"]) {
    L.push(`## Escenario ${esc}`, "", "| Posición | n | Sellada sola | P1 cualquier raíz | P2 lineage objetivo | Sello miente P1 | Sello miente P2 |", "|---|---|---|---|---|---|---|");
    for (const pos of [0, 1, 2]) {
      const xs = filas.filter((f) => f.escenario === esc && f.pos === pos);
      L.push(`| ${pos + 1}ª | ${xs.length} | ${t(xs.filter((f) => objetivo(f.sola) && f.exacta).length, xs.length)} | ${t(xs.filter((f) => f.p1 && f.exacta).length, xs.length)} | ${t(xs.filter((f) => f.p2 && f.exacta).length, xs.length)} | ${t(xs.filter((f) => f.miente1).length, xs.length)} | ${t(xs.filter((f) => f.miente2).length, xs.length)} |`);
    }
    L.push("");
  }
  return L.join("\n");
}
