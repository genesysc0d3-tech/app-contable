#!/usr/bin/env node
/**
 * Medición del clasificador (Fase 1 del plan cirujano — docs/plan-clasificador-cirujano-2026-10-03.md).
 * SOLO LECTURA. Corre en la Mac mini (cómputo pesado → mini), nunca en el notebook:
 *
 *   ssh mini "zsh -lc 'cd <repo> && /opt/homebrew/bin/node scripts/medicion/medir-clasificador.mjs --consulta hoy'"
 *
 * Fuentes de datos (elige una):
 *   --db <url>            psql con default_transaction_read_only=on (o env MEDICION_DB_URL).
 *   --api --ref <ref>     Management API de Supabase con el token de .supabase/token,
 *                         pidiendo read_only. Antes de medir hace una SONDA: si la sesión
 *                         no es de solo lectura, aborta sin correr nada.
 * Consultas: --consulta hoy | precision | ambas (default hoy). Solo ejecuta los .sql
 * versionados de scripts/medicion/sql (sin interpolar nada).
 *
 * Salida AGREGADA, sin datos personales: empresa_id → E1, E2… (por tamaño), celdas con
 * n < 5 suprimidas, tasas micro (todas las filas) y macro (promedio por empresa con
 * n ≥ 5), intervalo de Wilson 95%. Respeta empresas.es_prueba (las excluye el SQL).
 * Escribe artifacts/runs/medicion-clasificador-YYYYMMDD-<consulta>.json.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, "..", "..");
const N_MIN = 5;
const Z = 1.96;

const COLUMNAS = {
  hoy: ["empresa_id", "fuente", "banda", "n", "n_cerrada", "n_cerrada_juzgada_no"],
  precision: ["empresa_id", "fuente_tipo", "banda", "n", "n_mirada", "k_acierto_mirada", "n_aceptada_ciega",
    "n_propagada", "k_propagada_corregida", "n_sin_sello", "n_fuente_desconocida"],
};
const CODIGO = /^[a-z0-9_]{1,40}$/;
const UUID = /^[0-9a-f-]{36}$/;

function args(argv) {
  const a = { consulta: "hoy", db: process.env.MEDICION_DB_URL ?? null, api: false, ref: null, salida: true };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--consulta") a.consulta = argv[++i];
    else if (k === "--db") a.db = argv[++i];
    else if (k === "--api") a.api = true;
    else if (k === "--ref") a.ref = argv[++i];
    else if (k === "--sin-archivo") a.salida = false;
    else throw new Error(`argumento desconocido: ${k}`);
  }
  if (!["hoy", "precision", "ambas"].includes(a.consulta)) throw new Error("--consulta hoy|precision|ambas");
  if (!a.api && !a.db) throw new Error("falta --db <url> (o MEDICION_DB_URL) o --api --ref <ref>");
  if (a.api && !/^[a-z]{20}$/.test(a.ref ?? "")) throw new Error("--api requiere --ref <ref de 20 letras>");
  return a;
}

/** Defensa extra: los .sql versionados son solo SELECT/WITH. */
function soloLectura(sql) {
  const sinComentarios = sql.replace(/--.*$/gm, "");
  if (/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke|copy|vacuum|call|do)\b/i.test(sinComentarios)) {
    throw new Error("el .sql contiene una palabra de escritura: se niega a correrlo");
  }
  return sinComentarios.trim().replace(/;\s*$/, "");
}

function parseCsv(txt) {
  const [cab, ...filas] = txt.trim().split("\n");
  const cols = cab.split(",");
  return filas.filter(Boolean).map((f) => Object.fromEntries(f.split(",").map((v, i) => [cols[i], v])));
}

function correrPsql(url, sql) {
  const env = { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on -c statement_timeout=120000" };
  const psql = process.env.PSQL ?? "/opt/homebrew/bin/psql";
  const sonda = execFileSync(psql, [url, "-X", "-At", "-c", "show transaction_read_only"], { env, encoding: "utf8" }).trim();
  if (sonda !== "on") throw new Error(`SONDA: la sesión no es de solo lectura (${sonda}); no se mide`);
  return parseCsv(execFileSync(psql, [url, "-X", "--csv", "-c", sql], { env, encoding: "utf8", maxBuffer: 64 << 20 }));
}

async function correrApi(ref, sql) {
  const token = readFileSync(join(REPO, ".supabase", "token"), "utf8").trim();
  const q = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, read_only: true }),
    });
    const j = await r.json();
    if (!r.ok || !Array.isArray(j)) throw new Error(`API: ${JSON.stringify(j).slice(0, 300)}`);
    return j;
  };
  const sonda = await q("show transaction_read_only");
  if (sonda[0]?.transaction_read_only !== "on") throw new Error("SONDA: la API no abrió una sesión de solo lectura; no se mide");
  return (await q(sql)).map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)])));
}

/** Lista cerrada de columnas y valores (códigos / conteos / uuid de empresa). */
function validar(filas, columnas) {
  return filas.map((f) => {
    const o = {};
    for (const c of columnas) {
      const v = f[c];
      if (v === undefined) throw new Error(`falta la columna ${c}`);
      if (c === "empresa_id") { if (!UUID.test(v)) throw new Error("empresa_id inválido"); o[c] = v; }
      else if (/^(n|k)(_|$)/.test(c)) { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw new Error(`conteo inválido en ${c}`); o[c] = n; }
      else { if (!CODIGO.test(v)) throw new Error(`código inválido en ${c}`); o[c] = v; }
    }
    for (const k of Object.keys(f)) if (!columnas.includes(k)) throw new Error(`columna no permitida: ${k}`);
    return o;
  });
}

export function wilson(k, n) {
  if (!n) return null;
  const p = k / n;
  const d = 1 + (Z * Z) / n;
  const c = (p + (Z * Z) / (2 * n)) / d;
  const h = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return { tasa: +p.toFixed(4), ic95: [+Math.max(0, c - h).toFixed(4), +Math.min(1, c + h).toFixed(4)] };
}

/** Tasa k/n por corte: micro (suma) + macro (promedio por empresa con n ≥ N_MIN). Suprime n < N_MIN. */
function tasa(filas, corteDe, kDe, nDe) {
  const porCorte = new Map();
  for (const f of filas) {
    const corte = corteDe(f);
    if (corte == null) continue;
    const c = porCorte.get(corte) ?? { k: 0, n: 0, emp: new Map() };
    const k = kDe(f), n = nDe(f);
    c.k += k; c.n += n;
    const e = c.emp.get(f.empresa_id) ?? { k: 0, n: 0 };
    e.k += k; e.n += n; c.emp.set(f.empresa_id, e);
    porCorte.set(corte, c);
  }
  const out = {};
  for (const [corte, c] of [...porCorte].sort()) {
    if (c.n < N_MIN) { out[corte] = { n: `<${N_MIN}`, suprimida: true }; continue; }
    const emps = [...c.emp.values()].filter((e) => e.n >= N_MIN);
    out[corte] = {
      n: c.n, k: c.k, micro: wilson(c.k, c.n),
      macro: emps.length ? +(emps.reduce((s, e) => s + e.k / e.n, 0) / emps.length).toFixed(4) : null,
      empresas_n_ge_5: emps.length,
    };
  }
  return out;
}

/** Seudónimos E1, E2… por tamaño (n desc). Nunca sale un empresa_id. */
function porEmpresa(filas, kDe, nDe) {
  const m = new Map();
  for (const f of filas) { const e = m.get(f.empresa_id) ?? { k: 0, n: 0 }; e.k += kDe(f); e.n += nDe(f); m.set(f.empresa_id, e); }
  return [...m.values()].sort((a, b) => b.n - a.n).map((e, i) => (
    e.n < N_MIN ? { empresa: `E${i + 1}`, n: `<${N_MIN}`, suprimida: true } : { empresa: `E${i + 1}`, n: e.n, ...wilson(e.k, e.n) }
  ));
}

const ALTA = (b) => b === "alta" || b === "bulk";

function resumirHoy(f) {
  return {
    definiciones: {
      cobertura_al_nacer: "filas en banda ≥ bulk (0,80) / población — lo que el sistema decidió sin preguntar (exacto)",
      abstencion: "1 − cobertura (exacto)",
      falsos_seguros_cota_inferior: "en banda alta/bulk y cartola cerrada, % que terminó rechazado/descartado/oculto. COTA INFERIOR: los cambios afecta↔exenta no se ven sin la foto",
    },
    poblacion: f.reduce((s, x) => s + x.n, 0),
    cobertura_por_fuente: tasa(f, (x) => x.fuente, (x) => (ALTA(x.banda) ? x.n : 0), (x) => x.n),
    cobertura_total: tasa(f, () => "todas", (x) => (ALTA(x.banda) ? x.n : 0), (x) => x.n),
    cobertura_por_empresa: porEmpresa(f, (x) => (ALTA(x.banda) ? x.n : 0), (x) => x.n),
    falsos_seguros_por_fuente_banda: tasa(f.filter((x) => ALTA(x.banda)), (x) => `${x.fuente}·${x.banda}`, (x) => x.n_cerrada_juzgada_no, (x) => x.n_cerrada),
    falsos_seguros_total: tasa(f.filter((x) => ALTA(x.banda)), () => "todas", (x) => x.n_cerrada_juzgada_no, (x) => x.n_cerrada),
  };
}

function resumirPrecision(f) {
  return {
    definiciones: {
      precision_estricta: "de las filas que un humano MIRÓ (check_fila/check_detalle o abierta): tipo final = foto, aprobada y sin cambio humano de tipo/receptor",
      aceptacion_ciega: "aprobadas solo vía aprobar_cartola/check_lote sin abrir — NO cuenta como acierto confirmado",
      error_propagacion: "hermanos volteados por propagación que después un humano corrigió",
      salud_sello: "filas con evento sin_sello y con orig_tipo_dte_fuente='desconocido' — ambas deberían ser 0",
    },
    filas_con_foto_en_cerradas: f.reduce((s, x) => s + x.n, 0),
    precision_por_fuente_banda: tasa(f.filter((x) => ALTA(x.banda)), (x) => `${x.fuente_tipo}·${x.banda}`, (x) => x.k_acierto_mirada, (x) => x.n_mirada),
    precision_total_alta_bulk: tasa(f.filter((x) => ALTA(x.banda)), () => "todas", (x) => x.k_acierto_mirada, (x) => x.n_mirada),
    aceptacion_ciega: tasa(f, () => "todas", (x) => x.n_aceptada_ciega, (x) => x.n),
    error_propagacion: tasa(f, () => "todas", (x) => x.k_propagada_corregida, (x) => x.n_propagada),
    precision_por_empresa: porEmpresa(f.filter((x) => ALTA(x.banda)), (x) => x.k_acierto_mirada, (x) => x.n_mirada),
    salud: {
      filas_sin_sello: f.reduce((s, x) => s + x.n_sin_sello, 0),
      filas_fuente_desconocida: f.reduce((s, x) => s + x.n_fuente_desconocida, 0),
    },
  };
}

async function main() {
  const a = args(process.argv);
  const consultas = a.consulta === "ambas" ? ["hoy", "precision"] : [a.consulta];
  const hoyStr = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  for (const c of consultas) {
    const sql = soloLectura(readFileSync(join(AQUI, "sql", `${c}.sql`), "utf8"));
    const crudas = a.api ? await correrApi(a.ref, sql) : correrPsql(a.db, sql);
    const filas = validar(crudas, COLUMNAS[c]);
    const informe = {
      consulta: c, generado: new Date().toISOString(), n_min: N_MIN,
      empresas: new Set(filas.map((f) => f.empresa_id)).size,
      ...(c === "hoy" ? resumirHoy(filas) : resumirPrecision(filas)),
    };
    const txt = JSON.stringify(informe, null, 2);
    console.log(txt);
    if (a.salida) {
      const dir = join(REPO, "artifacts", "runs");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `medicion-clasificador-${hoyStr}-${c}.json`), txt + "\n");
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`medir-clasificador: ${e.message}`); process.exit(1); });
}
