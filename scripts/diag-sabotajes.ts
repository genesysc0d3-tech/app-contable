/**
 * Diagnóstico local del banco de sabotajes con el lector de ESTA rama (sin red).
 *   npx tsx scripts/diag-sabotajes.ts [filtro]
 */
import { detectHeuristic } from "../src/lib/parsers/heuristic";
import { detectByNames } from "../src/lib/parsers/named";
import { applyAdapter } from "../src/lib/parsers/apply";
import { validate } from "../src/lib/parsers/validator";
import type { AdapterConfig, DescarteFila } from "../src/lib/parsers/types";
import { exacto, todasLasCartolas } from "../src/lib/parsers/testing/sabotajes";

const filtro = process.argv[2];
const cuenta: Record<string, number> = {};
for (const c of todasLasCartolas()) {
  if (filtro && !c.nombre.includes(filtro)) continue;
  let res = "NO_DETECTA";
  let det = "";
  for (const [capa, cfg] of [["heur", detectHeuristic(c.rows)], ["nombres", detectByNames(c.rows)]] as [string, AdapterConfig | null][]) {
    if (!cfg) continue;
    const d: DescarteFila[] = [];
    const lines = applyAdapter(c.rows, cfg, d);
    const v = validate(lines, c.rows, cfg, d);
    const ex = exacto(lines, c.verdad);
    const sinLeer = d.filter((x) => !x.legitimo).length;
    res = ex.ok && v.ok ? "OK" : ex.ok ? "RECHAZO_FALSO" : v.ok ? "SILENCIOSO" : "ATRAPADO";
    det = `${capa} ${cfg.layout ?? "two_cols"} f=${cfg.columns.fecha} g=${cfg.columns.descripcion} c=${cfg.columns.cargo} a=${cfg.columns.abono} s=${cfg.columns.saldo} m=${cfg.columns.monto ?? "-"} t=${cfg.columns.tipo_flujo_col ?? "-"} ${ex.detalle} ${v.errors[0] ?? ""} perdidas=${sinLeer}`;
    if (v.ok) break;
  }
  cuenta[res] = (cuenta[res] ?? 0) + 1;
  console.log(`${c.nombre.padEnd(34)} ${res.padEnd(14)} ${det}`);
}
console.log(cuenta);
