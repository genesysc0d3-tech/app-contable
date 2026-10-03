/**
 * CORPUS PDF (2026-10-02): cartolas PDF SINTÉTICAS (src/lib/parsers/testing/
 * cartola-pdf-sintetica.ts) que imitan dos formatos reales, con variantes
 * (largo 1-200 filas, multipágina, sobregiro, glosa partida, sin resumen,
 * meses/años) y sabotajes (monto alterado, títulos cargo↔abono cruzados), por
 * el MISMO camino que la cola: parsePdfCartola (posiciones → grilla → lector con
 * juez y sello). Sin IA, sin red, sin Supabase.
 *
 *   npx tsx scripts/corpus-cartolas/pdf.ts [--por-variante=40] [--salida=<dir>]
 *
 * Clases: EXACTA_PROBADA (sello saldo/total_banco y exacta) · EXACTA_PREGUNTA
 * (exacta, sin sello → popup) · MAL_CON_AVISO · MAL_SIN_AVISO (mal, sin sello ni
 * alerta) · SELLO_MIENTE (sellada y mal, o sellada siendo sabotaje) · NO_CARTOLA
 * (null → flujo de antes) · ERROR.
 */
import { soloOpenCode, reporteSoloOpenCode } from "../lib/solo-opencode";
soloOpenCode();

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { parsePdfCartola } from "../../src/lib/parsers";
import { cartolaPdfSintetica, negativoPdfSintetico, TIPOS_NEGATIVOS, type OpcionesPdf } from "../../src/lib/parsers/testing/cartola-pdf-sintetica";
import type { DiagnosticoPdf } from "../../src/lib/parsers";
import { wilson } from "./corpus";

delete process.env.LECTOR_ESTRUCTURA_IA;
const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const N = Number(arg("por-variante") ?? 40);
const SALIDA = arg("salida") ?? join(process.env.TMPDIR ?? "/tmp", "corpus-pdf");

type Variante = { id: string; sabotaje: boolean; o: (seed: number) => Omit<OpcionesPdf, "formato"> };
const LARGOS = [1, 2, 3, 5, 8, 9, 10, 11, 12, 15, 20, 30, 45, 60, 90, 140, 200];
const VARIANTES: Variante[] = [
  { id: "normal", sabotaje: false, o: (s) => ({ seed: s, filas: LARGOS[s % LARGOS.length], anio: 2021 + (s % 5), mes: 1 + (s % 12) }) },
  { id: "multipagina", sabotaje: false, o: (s) => ({ seed: s, filas: 60 + (s % 150) }) },
  { id: "sobregiro", sabotaje: false, o: (s) => ({ seed: s, filas: 10 + (s % 40), saldoInicial: -(200_000 + (s % 7) * 900_000) }) },
  { id: "glosa_multilinea", sabotaje: false, o: (s) => ({ seed: s, filas: 6 + (s % 60), glosaMultilinea: true }) },
  { id: "sin_resumen", sabotaje: false, o: (s) => ({ seed: s, filas: 3 + (s % 30), sinResumen: true }) },
  { id: "un_sentido", sabotaje: false, o: (s) => ({ seed: s, filas: 2 + (s % 40), unSentido: s % 2 ? "cargos" : "abonos" }) },
  { id: "pyme_cupo_autorizado", sabotaje: false, o: (s) => ({ seed: s, filas: 3 + (s % 40), lineaCredito: true }) },
  { id: "pie_aviso", sabotaje: false, o: (s) => ({ seed: s, filas: 3 + (s % 60), aviso: ["Simule su Crédito de Consumo en bancoejemplo.cl", "Paga tus cotizaciones AFP desde tu cuenta", "Dólar observado $ 950,12", "Pague su Tarjeta de Crédito con cargo a su cuenta"][s % 4] }) },
  { id: "glosa_partida_fin_pagina", sabotaje: false, o: (s) => ({ seed: s, filas: 40 + (s % 120), glosaMultilinea: true }) },
  { id: "dic_ene", sabotaje: false, o: (s) => ({ seed: s, filas: 5 + (s % 25), anio: 2024 + (s % 2), mes: s % 2 ? 12 : 1 }) },
  { id: "SAB_monto_alterado", sabotaje: true, o: (s) => ({ seed: s, filas: 4 + (s % 80), montoAlterado: true }) },
  { id: "SAB_titulos_cruzados", sabotaje: true, o: (s) => ({ seed: s, filas: 4 + (s % 80), titulosCruzados: true }) },
];

const MATRIZ = new Map<string, Map<string, number>>();
function matriz(real: string, router: string) {
  const f = MATRIZ.get(real) ?? new Map<string, number>();
  f.set(router, (f.get(router) ?? 0) + 1);
  MATRIZ.set(real, f);
}

interface Res { formato: string; variante: string; seed: number; filas: number; clase: string; sello: string; det: string; ms: number }

async function main() {
  mkdirSync(SALIDA, { recursive: true });
  const res: Res[] = [];
  for (const formato of ["itau", "estado"] as const) {
    for (const v of VARIANTES) {
      if (formato === "estado" && v.id === "sin_resumen") continue; // "estado" no trae resumen abajo
      if (formato === "itau" && v.id === "pyme_cupo_autorizado") continue; // Itaú ya informa su línea
      for (let seed = 1; seed <= N; seed++) {
        const o = { formato, ...v.o(seed * 97 + 13) } as OpcionesPdf;
        const c = await cartolaPdfSintetica(o);
        const t0 = Date.now();
        let r;
        let diag: DiagnosticoPdf | null = null;
        try { r = await parsePdfCartola(c.pdf, { diagnostico: (d) => { diag = d; } }); matriz(`cartola${v.sabotaje ? " (sabotaje)" : ""}`, (diag as DiagnosticoPdf | null)?.tipo ?? "?"); } catch (e) {
          res.push({ formato, variante: v.id, seed, filas: c.verdad.length, clase: "ERROR", sello: "-", det: String((e as Error).message).slice(0, 80), ms: Date.now() - t0 });
          continue;
        }
        const ms = Date.now() - t0;
        if (!r) { res.push({ formato, variante: v.id, seed, filas: c.verdad.length, clase: "NO_CARTOLA", sello: "-", det: "", ms }); continue; }
        const pe = r.preExtracted ?? [];
        let malas = 0;
        pe.forEach((m, i) => {
          const t = c.verdad[i];
          const tipo = m.tipo_flujo === "entrada" ? "ENTRADA" : "SALIDA";
          if (!t || t.fecha !== m.fecha || t.monto !== m.monto || t.tipo !== tipo || !String(m.descripcion).includes(t.glosa)) malas++;
        });
        const ok = malas === 0 && pe.length === c.verdad.length;
        const vf = r.censo?.verificacion;
        const sello = vf?.tipo ?? "sin_comprobar";
        const probado = sello === "saldo" || sello === "total_banco" || sello === "cliente";
        let clase: string;
        if (probado && (v.sabotaje || !ok)) clase = "SELLO_MIENTE";
        else if (v.sabotaje) clase = vf?.alerta || vf?.revisar ? "SAB_SIN_SELLO_CON_AVISO" : "SAB_SIN_SELLO";
        else if (ok) clase = probado ? "EXACTA_PROBADA" : "EXACTA_PREGUNTA";
        else clase = vf?.alerta || vf?.revisar ? "MAL_CON_AVISO" : "MAL_SIN_AVISO";
        res.push({ formato, variante: v.id, seed, filas: c.verdad.length, clase, sello, det: `leidas ${pe.length}/${c.verdad.length} malas ${malas} · ${String(vf?.detalle ?? "").replace(/\$\s?-?[\d.]+/g, "$#").slice(0, 90)}`, ms });
      }
    }
  }
  // Negativos: PDFs con tablas de fecha+monto que NO son cartola. Ninguno debe llegar al lector.
  let negAlLector = 0;
  for (const tipo of TIPOS_NEGATIVOS) for (let seed = 1; seed <= N; seed++) {
    let diag: DiagnosticoPdf | null = null;
    const r = await parsePdfCartola(await negativoPdfSintetico(tipo, seed, 2 + (seed % 25)), { diagnostico: (d) => { diag = d; } });
    matriz(tipo, (diag as DiagnosticoPdf | null)?.tipo ?? "?");
    if (r || (diag as DiagnosticoPdf | null)?.tipo === "cartola") negAlLector++;
  }
  writeFileSync(join(SALIDA, "resultados.json"), JSON.stringify(res, null, 1));
  const L: string[] = [`# Corpus PDF sintético — ${res.length} cartolas (${N} por variante)`, ""];
  const pct = (k: number, n: number) => { const [a, b] = wilson(k, n); return `${n ? ((100 * k) / n).toFixed(1) : "—"}% (${k}/${n}; IC95 ${(100 * a).toFixed(1)}–${(100 * b).toFixed(1)})`; };
  const clases = [...new Set(res.map((r) => r.clase))].sort();
  L.push("| Clase | Total |", "|---|---|");
  for (const k of clases) L.push(`| ${k} | ${pct(res.filter((r) => r.clase === k).length, res.length)} |`);
  L.push("", "| Formato · variante | n | " + clases.join(" | ") + " |", "|---|---|" + clases.map(() => "---").join("|") + "|");
  for (const f of ["itau", "estado"]) for (const v of VARIANTES) {
    const xs = res.filter((r) => r.formato === f && r.variante === v.id);
    if (!xs.length) continue;
    L.push(`| ${f} · ${v.id} | ${xs.length} | ${clases.map((k) => xs.filter((r) => r.clase === k).length).join(" | ")} |`);
  }
  const raras = res.filter((r) => ["SELLO_MIENTE", "MAL_SIN_AVISO", "MAL_CON_AVISO", "ERROR"].includes(r.clase) || (r.clase === "NO_CARTOLA" && r.filas > 1));
  L.push("", `Casos a mirar (${raras.length}):`, "");
  for (const r of raras.slice(0, 60)) L.push(`- ${r.formato}/${r.variante}/seed ${r.seed} (${r.filas} filas): ${r.clase} · ${r.sello} · ${r.det}`);
  const cols = ["cartola", "comprobante", "factura", "tarjeta", "otro"];
  L.push("", "## Matriz de confusión del router (filas = lo que es; columnas = lo que dijo el router)", "", `| Real \\ Router | ${cols.join(" | ")} |`, `|---|${cols.map(() => "---").join("|")}|`);
  for (const [real, f] of MATRIZ) L.push(`| ${real} | ${cols.map((c) => f.get(c) ?? 0).join(" | ")} |`);
  L.push("", `Negativos que llegaron al lector: **${negAlLector}**`);
  const ms = res.map((r) => r.ms).sort((a, b) => a - b);
  L.push("", `Tiempo por cartola: p50 ${ms[Math.floor(ms.length / 2)]} ms · p95 ${ms[Math.floor(ms.length * 0.95)]} ms`);
  L.push("", reporteSoloOpenCode());
  writeFileSync(join(SALIDA, "tablas.md"), L.join("\n"));
  console.log(L.join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
