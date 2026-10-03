/**
 * Corre el lector sobre el BANCO SEUDONIMIZADO de cartolas PDF (2026-10-02):
 * JSON con los items del PDF (texto + posiciones, identificadores reemplazados)
 * y la verdad (saldo inicial, fecha/monto/saldo por fila, cuadre). Los datos NO
 * viven en el repo (quedan en la Mac mini, carpeta 700). Imprime SOLO agregados.
 *
 *   npx tsx scripts/corpus-cartolas/banco-seudonimizado.ts [dir]   (default ~/entrenamiento-lector/banco-seudonimizado)
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { parseExcel } from "../../src/lib/parsers";
import { grillaDesdeItems, libroDesdeGrilla, type ItemPdf } from "../../src/lib/parsers/pdf-grilla";
import { clasificarPdf } from "../../src/lib/parsers/pdf-router";

type Verdad = { saldoInicial: number | null; filas: { fecha: string; monto: number; saldo: number }[]; cuadra: boolean };

async function main() {
  const dir = process.argv[2] ?? join(process.env.HOME ?? "", "entrenamiento-lector", "banco-seudonimizado");
  let ok = 0, total = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const { id, items, verdad } = JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: string; items: ItemPdf[]; verdad: Verdad };
    const rows = grillaDesdeItems(items);
    const ruta = clasificarPdf(items);
    // Mismo trato que la cola: sin marca propia de banco, el lector no sella.
    const r = rows.length ? await parseExcel(libroDesdeGrilla(rows), { origen: "pdf", pdf_sin_marca_banco: !ruta.marca_banco }) : null;
    const pe = r?.preExtracted ?? [];
    const filasOk = pe.filter((m, i) => {
      const v = verdad.filas[i];
      const [d, mo] = v ? v.fecha.split(/[/-]/) : [];
      return v && (m.tipo_flujo === "entrada" ? m.monto : -m.monto) === v.monto && m.fecha.slice(8, 10) === d && m.fecha.slice(5, 7) === mo;
    }).length;
    const sello = r?.censo?.verificacion?.tipo ?? "capa4";
    const exacta = filasOk === verdad.filas.length && pe.length === verdad.filas.length;
    total++; if (exacta && (sello === "saldo" || sello === "total_banco")) ok++;
    const camino = `router ${ruta.tipo}(${ruta.motivo}, marca ${ruta.marca_banco ?? "—"}) · ` + (r?.censo?.mapa?.formato_conocido ? `conocido:${r.censo.mapa.formato_conocido}` : `capa ${r?.capa_usada ?? 4}`);
    console.log(`${id}\t${camino}\tfilas ${filasOk}/${verdad.filas.length}${pe.length !== verdad.filas.length ? ` (leídas ${pe.length})` : ""}\tsello ${sello}\tcuadre banco ${verdad.cuadra ? "sí" : "no"}`);
  }
  console.log(`exactas y selladas: ${ok}/${total}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
