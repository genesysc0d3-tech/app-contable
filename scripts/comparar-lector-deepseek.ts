/**
 * MEDICIÓN (no es código de producto, no corre en CI): lector ACTUAL vs NUEVO,
 * mismas cartolas, mismo DeepSeek de OpenCode Go.
 *
 *   npx tsx scripts/comparar-lector-deepseek.ts [--sin-ia] [--ref=origin/dev] [--solo=base,sin_saldo]
 *   ENV_FILE=/ruta/.env.local npx tsx scripts/comparar-lector-deepseek.ts
 *
 * - ACTUAL = el lector de `--ref` (por defecto origin/dev), extraído con
 *   `git show` a una carpeta temporal: heurística → nombres → validador. Sin sello.
 * - NUEVO sin IA = el orquestador de esta rama (sello saldo/total_banco/…).
 * - NUEVO + IA = el mismo con LECTOR_ESTRUCTURA_IA=1 (DeepSeek como segunda
 *   opinión, grilla enmascarada).
 * - IA sola = el mapa de DeepSeek aplicado por applyAdapter (para medir la IA).
 *
 * Datos: el banco de sabotajes sintético (src/lib/parsers/testing/sabotajes.ts,
 * 5 bancos × 10 sabotajes). A DeepSeek solo viaja la grilla ENMASCARADA.
 * Proveedor forzado a OpenCode (scripts/lib/solo-opencode.ts): Fireworks nunca;
 * Supabase/Vercel bloqueados (nada toca producción).
 */
import { soloOpenCode, reporteSoloOpenCode } from "./lib/solo-opencode";
soloOpenCode();

import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import * as XLSX from "xlsx";
import type { AdapterConfig, DescarteFila, ParsedLine, Row } from "../src/lib/parsers/types";
import { exacto, todasLasCartolas, type Cartola } from "../src/lib/parsers/testing/sabotajes";

const args = process.argv.slice(2);
const sinIa = args.includes("--sin-ia");
const ref = args.find((a) => a.startsWith("--ref="))?.slice(6) ?? "origin/dev";
const solo = args.find((a) => a.startsWith("--solo="))?.slice(7).split(",");

// ---------- lector ACTUAL (snapshot de la ref) ----------
async function cargarActual() {
  const dir = join(tmpdir(), `lector-actual-${ref.replace(/[^\w]/g, "_")}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  for (const f of ["types", "apply", "saldo-cuadre", "encabezados", "heuristic", "named", "validator"]) {
    const src = execFileSync("git", ["show", `${ref}:src/lib/parsers/${f}.ts`], { encoding: "utf8" });
    writeFileSync(join(dir, `${f}.ts`), src);
  }
  const heur = await import(join(dir, "heuristic.ts"));
  const named = await import(join(dir, "named.ts"));
  const apply = await import(join(dir, "apply.ts"));
  const val = await import(join(dir, "validator.ts"));
  return { detectHeuristic: heur.detectHeuristic, detectByNames: named.detectByNames, applyAdapter: apply.applyAdapter, validate: val.validate };
}

type Actual = Awaited<ReturnType<typeof cargarActual>>;
function evaluarActual(L: Actual, rows: Row[], cfg: AdapterConfig | null, verdad: Cartola["verdad"]) {
  if (!cfg) return "NO_DETECTA";
  const d: DescarteFila[] = [];
  const lines: ParsedLine[] = L.applyAdapter(rows, cfg, d);
  const v = L.validate(lines, rows, cfg, d);
  const ex = exacto(lines, verdad);
  if (ex.ok && v.ok) return "OK";
  if (ex.ok) return "RECHAZO_FALSO";
  return v.ok ? "SILENCIOSO" : "ATRAPADO";
}
function lectorActual(L: Actual, c: Cartola): string {
  const h = L.detectHeuristic(c.rows);
  const eh = evaluarActual(L, c.rows, h, c.verdad);
  if (eh === "OK" || eh === "SILENCIOSO") return eh;
  const en = evaluarActual(L, c.rows, L.detectByNames(c.rows), c.verdad);
  return en !== "NO_DETECTA" ? en : eh;
}

// ---------- lector NUEVO ----------
function libro(rows: Row[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows as unknown[][], { cellDates: true }), "Cartola");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
async function lectorNuevo(c: Cartola, conIa: boolean): Promise<{ r: string; sello: string; disputa: boolean }> {
  if (conIa) process.env.LECTOR_ESTRUCTURA_IA = "1"; else delete process.env.LECTOR_ESTRUCTURA_IA;
  const { parseExcelWithOrchestrator } = await import("../src/lib/parsers/orchestrator");
  const { result } = await parseExcelWithOrchestrator(libro(c.rows), { empresa_id: "medicion" });
  if (result.capa_usada === 4 || !result.preExtracted) return { r: "CAPA4", sello: "-", disputa: false };
  const lines = result.preExtracted.map((m) => ({ fecha: m.fecha, monto: m.monto, tipo: m.tipo_flujo === "entrada" ? "ENTRADA" as const : "SALIDA" as const }));
  const ex = exacto(lines, c.verdad);
  const sello = result.verificacion?.tipo ?? "sin_comprobar";
  const probado = sello === "saldo" || sello === "total_banco";
  const disputa = result.warnings.some((w) => w.startsWith("dos_opiniones"));
  return { r: ex.ok ? (probado ? "OK_PROBADO" : "OK_PREGUNTA") : (probado ? "SILENCIOSO" : "MAL_PREGUNTA"), sello, disputa };
}

// Caché por cuerpo de request: la corrida "IA sola" y "nuevo + IA" mandan la
// MISMA grilla → una sola llamada real a DeepSeek por cartola.
const cache = new Map<string, Promise<Response>>();
const fetchConRed = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const key = typeof init?.body === "string" ? createHash("sha256").update(init.body).digest("hex") : null;
  if (!key) return fetchConRed(input, init);
  if (!cache.has(key)) cache.set(key, fetchConRed(input, init).then(async (r) => new Response(await r.text(), { status: r.status })));
  const r = await cache.get(key)!;
  return r.clone();
}) as typeof fetch;

async function main() {
  const L = await cargarActual();
  const { mapaPorIA } = await import("../src/lib/parsers/estructura-ia");
  const { applyAdapter } = await import("../src/lib/parsers/apply");
  const casos = todasLasCartolas().filter((c) => !solo || solo.includes(c.sabotaje));
  const filas: Record<string, string>[] = [];
  const ms: number[] = [];
  for (const c of casos) {
    const actual = lectorActual(L, c);
    const nuevo = await lectorNuevo(c, false);
    const f: Record<string, string> = { caso: c.nombre, actual, nuevo: nuevo.r, sello: nuevo.sello };
    if (!sinIa) {
      const ia = await mapaPorIA(c.rows);
      ms.push(ia.ms);
      f.ia_sola = ia.cfg ? (exacto(applyAdapter(c.rows, ia.cfg, []), c.verdad).ok ? "OK" : "MAL") : `ERROR(${ia.error})`;
      const conIa = await lectorNuevo(c, true);
      f.nuevo_ia = conIa.r;
      f.sello_ia = conIa.sello;
      f.disputa = conIa.disputa ? "sí" : "";
    }
    filas.push(f);
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  const cols = Object.keys(filas[0] ?? {});
  console.log(cols.join("\t"));
  for (const f of filas) console.log(cols.map((k) => f[k] ?? "").join("\t"));
  const cuenta = (k: string) => filas.reduce<Record<string, number>>((a, f) => ((a[f[k]] = (a[f[k]] ?? 0) + 1), a), {});
  console.log(`\nRESUMEN (${filas.length} cartolas, ref actual = ${ref})`);
  console.log("actual       :", JSON.stringify(cuenta("actual")));
  console.log("nuevo sin IA :", JSON.stringify(cuenta("nuevo")), "sellos", JSON.stringify(cuenta("sello")));
  if (!sinIa) {
    console.log("IA sola      :", JSON.stringify(cuenta("ia_sola")));
    console.log("nuevo + IA   :", JSON.stringify(cuenta("nuevo_ia")), "sellos", JSON.stringify(cuenta("sello_ia")), "disputas", filas.filter((f) => f.disputa).length);
    const t = [...ms].sort((a, b) => a - b);
    console.log("latencia DeepSeek ms: mediana", t[Math.floor(t.length / 2)], "máx", t[t.length - 1]);
  }
  console.log("Leyenda: OK_PROBADO = exacta y sellada por saldo/total del banco · OK_PREGUNTA = exacta, sin prueba (se le pide confirmar al cliente) · MAL_PREGUNTA = mal leída pero sin sello (se le pide al cliente) · SILENCIOSO = mal leída y sellada como probada.");
  console.log(reporteSoloOpenCode());
}
main();
