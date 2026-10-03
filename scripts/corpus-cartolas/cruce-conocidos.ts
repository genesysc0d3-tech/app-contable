/**
 * PRUEBA CRUZADA de formatos conocidos (2026-10-02): cada cartola sintética del
 * corpus (specs × mutaciones, combos, variantes DeepSeek, sabotajes,
 * adversariales) y las PDF sintéticas → ¿qué formato conocido detecta? Un
 * archivo solo puede caer en el formato de SU spec (o en ninguno). Sin red.
 *
 *   npx tsx scripts/corpus-cartolas/cruce-conocidos.ts
 */
import * as XLSX from "xlsx";
import { construirCorpus, corpusExterno } from "./corpus";
import { leerLibroCartola } from "../../src/lib/parsers/libro";
import { normalizarTitulo } from "../../src/lib/parsers/encabezados";
import { detectarFormatoConocido, FORMATOS_CONOCIDOS } from "../../src/lib/parsers/formatos-conocidos";
import { grillaDesdeItems, itemsDePdf } from "../../src/lib/parsers/pdf-grilla";
import { cartolaPdfSintetica } from "../../src/lib/parsers/testing/cartola-pdf-sintetica";

const PDF_ID = { itau: "itau-cartola-historica-pdf", estado: "estado-de-cuenta-desde-hasta-pdf" } as const;
// Specs que comparten formato con otra registrada (mismo export, filtrado).
const ALIAS: Record<string, string> = {
  "mis-movimientos-solo-ingresos-con-saldo": "mis-movimientos-completa",
  "santander-movimientos-ctacte-completa": "santander-movimientos-ctacte",
};

async function main() {
  const conocidos = new Set(FORMATOS_CONOCIDOS.map((f) => f.id));
  const corpus = [...construirCorpus(), ...(await corpusExterno(undefined, process.env.ADVERSARIALES_DIR))];
  const tabla = new Map<string, number>();
  let ajenos = 0, cruzadosQueEntran = 0, propios = 0;
  const sumar = (k: string) => tabla.set(k, (tabla.get(k) ?? 0) + 1);
  for (const it of corpus) {
    const wb = leerLibroCartola(it.buf);
    for (const n of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: "" }) as never[];
      const d = detectarFormatoConocido(rows)?.formato.id ?? null;
      if (!d) continue;
      const propio = ALIAS[it.spec_id] ?? it.spec_id;
      // Mismo formato de hecho: la mutación dejó el archivo con los MISMOS títulos
      // (en las mismas posiciones) que otro formato del mismo banco ("Mis
      // Movimientos" sin la columna Saldo = el export sin saldo). El mapa por
      // título es el mismo: no es una captura ajena.
      const f = FORMATOS_CONOCIDOS.find((x) => x.id === d)!;
      const titulosSpec = (it.spec?.columnas ?? []).map((c) => normalizarTitulo(c.titulo)).filter(Boolean);
      const equivalente = d !== propio && JSON.stringify(titulosSpec) === JSON.stringify(f.titulos.map(([t]) => t).filter(Boolean))
        && FORMATOS_CONOCIDOS.find((x) => x.id === propio)?.nombre.split(" · ")[0] === f.nombre.split(" · ")[0];
      if (equivalente) { propios++; sumar(`ok-equivalente ${it.spec_id}[${it.mutaciones.join("+")}] -> ${d}`); continue; }
      const cruzado = it.mutaciones.some((m) => /columnas_invertidas|columnas_barajadas/.test(m));
      if (d !== propio) { ajenos++; sumar(`AJENO ${it.fuente}:${it.spec_id}[${it.mutaciones.join("+")}] -> ${d}`); }
      else if (cruzado) { cruzadosQueEntran++; sumar(`CRUZADO ${it.spec_id}[${it.mutaciones.join("+")}] -> ${d}`); }
      else { propios++; sumar(`ok ${d}`); }
    }
  }
  for (const formato of ["itau", "estado"] as const) for (let seed = 1; seed <= 60; seed++) {
    const cruz = seed % 5 === 0;
    const c = await cartolaPdfSintetica({ formato, seed: seed * 41, filas: 2 + (seed % 50), titulosCruzados: cruz });
    const d = detectarFormatoConocido(grillaDesdeItems(await itemsDePdf(c.pdf)))?.formato.id ?? null;
    if (cruz && d) { cruzadosQueEntran++; sumar(`CRUZADO pdf-${formato} -> ${d}`); }
    else if (!cruz && d !== PDF_ID[formato]) { ajenos++; sumar(`AJENO/NULO pdf-${formato} -> ${d}`); }
    else if (d) { propios++; sumar(`ok ${d}`); }
  }
  for (const [k, v] of [...tabla].sort()) console.log(`${v}\t${k}`);
  const sinUso = [...conocidos].filter((id) => !tabla.has(`ok ${id}`));
  console.log(`\npropios ${propios} · AJENOS ${ajenos} · títulos cruzados que entran ${cruzadosQueEntran} · conocidos sin ningún archivo propio: ${sinUso.join(", ") || "ninguno"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
