/**
 * Test ESTÁTICO de las escrituras a propuestas_ia (Fase 1 medición).
 *
 * El log de decisiones solo sirve si NINGUNA escritura se escapa. La base marca
 * `sin_sello` lo que no se selló, pero eso se ve recién en prod. Este test lo ve
 * antes: recorre src/, encuentra cada .update/.insert/.upsert/.delete sobre
 * propuestas_ia y exige que
 *   - esté en el INVENTARIO de abajo (un camino nuevo → rojo: agrégalo con su sello);
 *   - cada .update() lleve el sello en su payload (`sello(…)`/`selloDe(…)`/variable `sello*`);
 *   - cada .insert()/.upsert() informe `orig_tipo_dte_fuente` (de dónde nació el tipo).
 * Además vigila que las listas cerradas del código calcen con los CHECK de la migración.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { CANALES_DECISION } from "./sello";
import { FUENTES_TIPO_DTE } from "@/lib/ai/tipo-dte-fuente";

const RAIZ = join(__dirname, "..", "..", "..");
const SRC = join(RAIZ, "src");

/** archivo → operación → cuántas. Fuente: inventario del plan (35 puntos) + grep. */
const INVENTARIO: Record<string, Record<string, number>> = {
  "src/app/(app)/escritorio/v5/cuadre-actions.ts": { upsert: 1 },
  "src/app/(app)/revisar/actions.ts": { update: 16, delete: 1 },
  "src/app/api/intermediaria/factura-unica/route.ts": { insert: 1 },
  "src/app/api/mcp/route.ts": { update: 2 },
  "src/lib/ai/aprender-regla.ts": { update: 1 },
  "src/lib/ai/processor.ts": { insertInBatches: 1 },
  "src/lib/facturas/procesar.ts": { insert: 1 },
  "src/lib/telegram/ingesta.ts": { insert: 2, update: 2 },
  "src/lib/telegram/propuestas.ts": { insert: 1, update: 2 },
};

function archivos(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === "node_modules" || f === "__tests__") continue;
      archivos(p, out);
    } else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith(".d.ts") && f !== "database.types.ts") {
      out.push(p);
    }
  }
  return out;
}

/** Texto de los argumentos de la llamada que abre en `desde` (posición del "("). */
function argumentos(t: string, desde: number): string {
  let prof = 0;
  let comilla: string | null = null;
  for (let i = desde; i < t.length; i++) {
    const ch = t[i];
    if (comilla) {
      if (ch === "\\") { i++; continue; }
      if (ch === comilla) comilla = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { comilla = ch; continue; }
    if (ch === "(") prof++;
    else if (ch === ")") { prof--; if (prof === 0) return t.slice(desde + 1, i); }
  }
  return t.slice(desde + 1);
}

type Escritura = { archivo: string; linea: number; op: string; payload: string };

function escrituras(): Escritura[] {
  const res: Escritura[] = [];
  for (const abs of archivos(SRC)) {
    const t = readFileSync(abs, "utf8");
    const archivo = relative(RAIZ, abs).split("\\").join("/");
    const linea = (i: number) => t.slice(0, i).split("\n").length;
    const reFrom = /\.from\(\s*["']propuestas_ia["']\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = reFrom.exec(t))) {
      const resto = t.slice(m.index + m[0].length);
      const corte = resto.search(/\.from\(/);
      const cadena = corte >= 0 ? resto.slice(0, corte) : resto;
      const op = cadena.match(/^[\s\S]*?\.(update|insert|upsert|delete|select)\s*\(/);
      if (!op || op[1] === "select") continue;
      const abre = m.index + m[0].length + op[0].length - 1;
      res.push({ archivo, linea: linea(m.index), op: op[1], payload: argumentos(t, abre) });
    }
    const reBatch = /insertInBatches\(\s*["']propuestas_ia["']/g;
    while ((m = reBatch.exec(t))) res.push({ archivo, linea: linea(m.index), op: "insertInBatches", payload: "" });
  }
  return res;
}

const TODAS = escrituras();

describe("escrituras a propuestas_ia — inventario cerrado", () => {
  it("cada camino de escritura está inventariado (uno nuevo → agrégalo acá CON su sello)", () => {
    const real: Record<string, Record<string, number>> = {};
    for (const e of TODAS) {
      real[e.archivo] ??= {};
      real[e.archivo][e.op] = (real[e.archivo][e.op] ?? 0) + 1;
    }
    expect(real).toEqual(INVENTARIO);
  });

  it("cada .update() lleva el sello de decisión en el mismo payload", () => {
    const sinSello = TODAS.filter((e) => e.op === "update" && !/sello/i.test(e.payload)).map((e) => `${e.archivo}:${e.linea}`);
    expect(sinSello).toEqual([]);
  });

  it("cada .insert()/.upsert() informa orig_tipo_dte_fuente (en el payload o en el archivo que lo arma)", () => {
    const sinFuente = TODAS.filter((e) => {
      if (e.op !== "insert" && e.op !== "upsert" && e.op !== "insertInBatches") return false;
      if (e.payload.includes("orig_tipo_dte_fuente")) return false;
      return !readFileSync(join(RAIZ, e.archivo), "utf8").includes("orig_tipo_dte_fuente");
    }).map((e) => `${e.archivo}:${e.linea}`);
    expect(sinFuente).toEqual([]);
  });
});

describe("listas cerradas: código ⇄ CHECK de la migración", () => {
  const sql = readFileSync(join(RAIZ, "supabase/migrations/20261004140000_propuestas_foto_y_decisiones.sql"), "utf8");
  const listaDelCheck = (constraint: string) => {
    const bloque = sql.slice(sql.indexOf(`add constraint ${constraint}`));
    const dentro = bloque.slice(bloque.indexOf(" in ("), bloque.indexOf(")\n) not valid"));
    return [...dentro.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  };

  it("canales de decisión (+ sin_sello, que solo pone el trigger)", () => {
    expect(listaDelCheck("propuestas_ia_decision_canal_check")).toEqual([...CANALES_DECISION, "sin_sello"].sort());
    expect(listaDelCheck("propuestas_ia_editado_canal_check")).toEqual([...CANALES_DECISION, "sin_sello"].sort());
  });

  it("fuentes del tipo_dte", () => {
    expect(listaDelCheck("propuestas_ia_orig_tipo_dte_fuente_check")).toEqual([...FUENTES_TIPO_DTE].sort());
  });
});
