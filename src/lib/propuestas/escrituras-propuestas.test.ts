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
  "src/app/(app)/revisar/actions.ts": { update: 17, delete: 1 },
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

type Escritura = { archivo: string; linea: number; op: string; payload: string; pos: number; texto: string };

/** Cómo se nombra la tabla en un .from(…): literal con cualquier comilla (incluido
 *  template sin interpolar), con o sin `as never`/`as X`, o una CONSTANTE del archivo
 *  cuyo valor es "propuestas_ia". */
const LITERAL = String.raw`(?:"propuestas_ia"|'propuestas_ia'|\x60propuestas_ia\x60)`;
const COMO = String.raw`(?:\s+as\s+[\w.<>\[\]]+)?`;

function constantesDeTabla(t: string): string[] {
  const re = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*` + LITERAL + COMO + String.raw`\s*[;,\n]`, "g");
  return [...t.matchAll(re)].map((m) => m[1]);
}

function escriturasDe(t: string, archivo: string): Escritura[] {
  const res: Escritura[] = [];
  const linea = (i: number) => t.slice(0, i).split("\n").length;
  const nombres = [LITERAL, ...constantesDeTabla(t).map((c) => `\\b${c}\\b`)];
  const reFrom = new RegExp(String.raw`\.from\(\s*(?:${nombres.join("|")})` + COMO + String.raw`\s*\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = reFrom.exec(t))) {
    const resto = t.slice(m.index + m[0].length);
    const corte = resto.search(/\.from\(/);
    const cadena = corte >= 0 ? resto.slice(0, corte) : resto;
    const op = cadena.match(/^[\s\S]*?\.(update|insert|upsert|delete|select)\s*\(/);
    if (!op || op[1] === "select") continue;
    const abre = m.index + m[0].length + op[0].length - 1;
    res.push({ archivo, linea: linea(m.index), op: op[1], payload: argumentos(t, abre), pos: m.index, texto: t });
  }
  const reBatch = new RegExp(String.raw`insertInBatches\(\s*(?:${nombres.join("|")})`, "g");
  while ((m = reBatch.exec(t))) {
    const args = argumentos(t, m.index + "insertInBatches".length);
    res.push({ archivo, linea: linea(m.index), op: "insertInBatches", payload: args.slice(args.indexOf(",") + 1), pos: m.index, texto: t });
  }
  return res;
}

function escrituras(): Escritura[] {
  return archivos(SRC).flatMap((abs) => escriturasDe(readFileSync(abs, "utf8"), relative(RAIZ, abs).split("\\").join("/")));
}

/**
 * ¿ESTA escritura (no el archivo) informa orig_tipo_dte_fuente? Si el payload es
 * literal, en el payload; si es una variable, en su definición (desde el `const X =`
 * más cercano antes de la llamada hasta la llamada), siguiendo alias `const a = b;`.
 */
function informaFuente(e: Escritura): boolean {
  let payload = e.payload;
  let hasta = e.pos;
  for (let saltos = 0; saltos < 5; saltos++) {
    if (payload.includes("orig_tipo_dte_fuente")) return true;
    const id = payload.trim().match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/)?.[1];
    if (!id) return false;
    const antes = e.texto.slice(0, hasta);
    const def = [...antes.matchAll(new RegExp(String.raw`\b(?:const|let|var)\s+${id}\b[^=]*=`, "g"))].pop();
    if (!def || def.index === undefined) return false;
    const cuerpo = antes.slice(def.index + def[0].length);
    const alias = cuerpo.match(/^\s*([A-Za-z_$][\w$]*)\s*;/);
    if (alias) { payload = alias[1]; hasta = def.index; continue; }
    return cuerpo.includes("orig_tipo_dte_fuente");
  }
  return false;
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

  it("cada .insert()/.upsert() informa orig_tipo_dte_fuente (por LLAMADA: en su payload o en la definición de su variable)", () => {
    const sinFuente = TODAS
      .filter((e) => (e.op === "insert" || e.op === "upsert" || e.op === "insertInBatches") && !informaFuente(e))
      .map((e) => `${e.archivo}:${e.linea}`);
    expect(sinFuente).toEqual([]);
  });
});

describe("listas cerradas: código ⇄ CHECK de la migración", () => {
  const sql = readFileSync(join(RAIZ, "supabase/migrations/20261004160000_propuestas_foto_y_decisiones.sql"), "utf8");
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

describe("el detector no se deja esquivar", () => {
  const sintetico = (codigo: string) => escriturasDe(codigo, "x");
  it("ve from(`propuestas_ia`), from(\"propuestas_ia\" as never) y una constante con el nombre", () => {
    const codigo = [
      "sb.from(`propuestas_ia`).update({ estado: 'x' });",
      "sb.from(\"propuestas_ia\" as never).update({ estado: 'y', ...sello('mcp', o) });",
      "const TABLA = \"propuestas_ia\";",
      "sb.from(TABLA).insert({ a: 1 });",
    ].join("\n");
    const es = sintetico(codigo);
    expect(es.map((e) => e.op)).toEqual(["update", "update", "insert"]);
    expect(es.filter((e) => e.op === "update" && !/sello/i.test(e.payload))).toHaveLength(1);
    expect(informaFuente(es[2])).toBe(false);
  });
  it("valida la fuente por llamada, no por archivo", () => {
    const codigo = [
      "const filas = [{ orig_tipo_dte_fuente: 'regla' }];",
      "sb.from('propuestas_ia').insert(filas);",
      "const otras = [{ a: 1 }];",
      "sb.from('propuestas_ia').insert(otras);",
      "const alias = filas;",
      "sb.from('propuestas_ia').insert(alias);",
    ].join("\n");
    const es = sintetico(codigo);
    expect(es.map(informaFuente)).toEqual([true, false, true]);
  });
});
