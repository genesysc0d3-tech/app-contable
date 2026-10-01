/**
 * DeepSeek (OpenCode Go) como GENERADOR ADVERSARIAL de formatos (2026-09-30).
 *
 * Para cada spec real (solo ESTRUCTURA: títulos del banco, roles, tipos de celda,
 * placeholders — jamás valores de clientas) le pide a DeepSeek N variantes
 * plausibles de cómo ese banco chileno podría cambiar su export mañana, o cómo
 * la clienta edita la planilla antes de subirla. La respuesta es un tool STRICT
 * con un vocabulario cerrado de operaciones (enum), que se aplican acá al spec y
 * se guardan en specs/deepseek/<spec>.json. El corredor las rinde con datos falsos.
 *
 *   npx tsx scripts/corpus-cartolas/deepseek-variantes.ts [--n=8] [--solo=<spec>]
 *
 * IA: SOLO DeepSeek por OpenCode Go (scripts/lib/solo-opencode.ts). A DeepSeek
 * solo viaja el spec (estructura), nunca una cartola real.
 */
import { soloOpenCode, reporteSoloOpenCode, OPENCODE_GO_CHAT_URL, MODELO_OPENCODE } from "../lib/solo-opencode";
soloOpenCode();

import { randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { leerSpecs, rngDe, type ColSpec, type FmtFecha, type FmtMonto, type Rol, type Spec } from "./generador";
import { MUTACION, direccionDecidible } from "./mutaciones";

const args = process.argv.slice(2);
const N = Number(args.find((a) => a.startsWith("--n="))?.slice(4) ?? 8);
const SOLO = args.find((a) => a.startsWith("--solo="))?.slice(7);
const DIR = join(__dirname, "specs", "deepseek");

const OPS = [
  "renombrar_columna", "mover_columna", "agregar_columna", "quitar_columna", "formato_fecha", "fecha_como_fecha_excel",
  "montos_como_texto", "montos_como_numero", "unir_en_monto_con_signo", "unir_en_monto_y_bandera", "separar_cargo_y_abono",
  "filtrar_solo_abonos", "quitar_saldo", "agregar_resumen_arriba", "agregar_resumen_abajo", "agregar_fila_total", "agregar_formula_suma",
  "subtotal_por_dia", "glosa_partida_en_dos_filas", "fila_saldo_inicial", "hoja_resumen_antes", "hoja_instrucciones_despues",
  "sin_fila_de_titulos", "titulos_en_ingles", "cambiar_orden", "mas_basura_arriba", "exportar_csv", "celdas_combinadas",
  "columna_indice", "ceros_en_texto", "filas_vacias_intercaladas", "pocas_filas", "muchas_filas", "vacio_como_cero", "vacio_como_guion", "exportar_xls_antiguo",
] as const;
const ROLES = ["", "fecha", "fecha2", "hora", "glosa", "doc", "codigo", "nombre", "rut", "sucursal", "comentario", "cargo", "abono", "monto", "monto_signo", "flag", "saldo", "otro_texto", "otro_num", "vacia"] as const;
const FECHAS: FmtFecha[] = ["dd/mm/yyyy", "dd-mm-yyyy", "dd/mm", "yyyymmdd", "dd/mm/yy", "yyyy-mm-dd", "d/m/yyyy", "dd-mmm-yyyy", "dd.mm.yyyy"];
const MONTOS: FmtMonto[] = ["cl", "cl_pesos", "cl_pesos_pegado", "cl_dec", "en", "en_dec", "plano"];

const TOOL = {
  type: "function",
  function: {
    name: "variantes_formato",
    description: "Variantes plausibles del export de una cartola bancaria chilena, como lista de operaciones sobre su estructura.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["variantes"],
      properties: {
        variantes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["nombre", "razon", "ops"],
            properties: {
              nombre: { type: "string", description: "nombre corto en snake_case" },
              razon: { type: "string", description: "por qué el banco o la clienta haría este cambio (una frase)" },
              ops: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["op", "rol", "titulo", "posicion", "formato_fecha", "formato_monto", "orden", "separador"],
                  properties: {
                    op: { type: "string", enum: OPS },
                    rol: { type: "string", enum: ROLES, description: "columna a la que aplica (o rol de la columna nueva); '' si no aplica" },
                    titulo: { type: "string", description: "título nuevo de columna (renombrar/agregar); '' si no aplica" },
                    posicion: { type: "integer", description: "índice destino (mover/agregar); -1 si no aplica" },
                    formato_fecha: { type: "string", enum: ["", ...FECHAS] },
                    formato_monto: { type: "string", enum: ["", ...MONTOS] },
                    orden: { type: "string", enum: ["", "asc", "desc"] },
                    separador: { type: "string", enum: ["", ";", ","] },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

type Op = { op: (typeof OPS)[number]; rol: string; titulo: string; posicion: number; formato_fecha: string; formato_monto: string; orden: string; separador: string };

const clon = (s: Spec): Spec => JSON.parse(JSON.stringify(s)) as Spec;
const PLATA: Rol[] = ["cargo", "abono", "monto", "monto_signo", "saldo"];
const ESENCIALES: Rol[] = ["fecha", "cargo", "abono", "monto", "monto_signo", "flag"];

function aplicarOp(s: Spec, o: Op, r: () => number): Spec | null {
  const t = clon(s);
  const i = t.columnas.findIndex((c) => c.rol === o.rol);
  const viaMut = (id: string) => MUTACION.get(id)?.aplicar(s, r) ?? null;
  switch (o.op) {
    case "renombrar_columna": if (i < 0 || !o.titulo) return null; t.columnas[i].titulo = o.titulo.slice(0, 40); return t;
    case "mover_columna": { if (i < 0) return null; const [c] = t.columnas.splice(i, 1); t.columnas.splice(Math.max(0, Math.min(o.posicion, t.columnas.length)), 0, c); t.columnas.forEach((x) => delete x.span); return t; }
    case "agregar_columna": {
      const rol = (["otro_texto", "otro_num", "doc", "codigo", "nombre", "rut", "sucursal", "hora", "fecha2", "vacia", "comentario"] as string[]).includes(o.rol) ? (o.rol as Rol) : "otro_texto";
      const c: ColSpec = { titulo: (o.titulo || "Referencia").slice(0, 40), rol };
      if (rol === "fecha2") { const f = t.columnas.find((x) => x.rol === "fecha"); if (f) Object.assign(c, { celda: f.celda, z: f.z, fmt: f.fmt }); }
      t.columnas.splice(Math.max(0, Math.min(o.posicion < 0 ? t.columnas.length : o.posicion, t.columnas.length)), 0, c);
      return t;
    }
    case "quitar_columna": if (i < 0 || ESENCIALES.includes(o.rol as Rol)) return null; t.columnas.splice(i, 1); return t;
    case "formato_fecha": { const c = t.columnas.find((x) => x.rol === "fecha"); if (!c || !FECHAS.includes(o.formato_fecha as FmtFecha)) return null; c.celda = "s"; c.fmt = o.formato_fecha as FmtFecha; delete c.z; return t; }
    case "fecha_como_fecha_excel": return viaMut("fecha_excel");
    case "montos_como_texto": { const f = MONTOS.includes(o.formato_monto as FmtMonto) ? (o.formato_monto as FmtMonto) : "cl_pesos"; for (const c of t.columnas.filter((x) => PLATA.includes(x.rol))) { c.celda = "s"; c.fmt = f; delete c.z; } return t; }
    case "montos_como_numero": for (const c of t.columnas.filter((x) => PLATA.includes(x.rol))) { c.celda = "n"; delete c.fmt; } return t;
    case "unir_en_monto_con_signo": return viaMut("monto_con_signo");
    case "unir_en_monto_y_bandera": return viaMut("monto_y_bandera");
    case "separar_cargo_y_abono": return viaMut("separar_cargo_abono");
    case "filtrar_solo_abonos": return viaMut("filtrado_solo_abonos");
    case "quitar_saldo": return viaMut("sin_saldo");
    case "agregar_resumen_arriba": return viaMut("resumen_arriba");
    case "agregar_resumen_abajo": return viaMut("resumen_abajo");
    case "agregar_fila_total": return viaMut("fila_total");
    case "agregar_formula_suma": return viaMut("sum_formula");
    case "subtotal_por_dia": return viaMut("subtotal_por_dia");
    case "glosa_partida_en_dos_filas": return viaMut("glosa_partida");
    case "fila_saldo_inicial": return viaMut("saldo_inicial_fila");
    case "hoja_resumen_antes": return viaMut("hoja_resumen_antes");
    case "hoja_instrucciones_despues": return viaMut("hoja_readme_despues");
    case "sin_fila_de_titulos": return viaMut("sin_titulos");
    case "titulos_en_ingles": return viaMut("titulos_ingles");
    case "cambiar_orden": t.orden = o.orden === "asc" || o.orden === "desc" ? o.orden : (t.orden ?? "asc") === "asc" ? "desc" : "asc"; return t;
    case "mas_basura_arriba": return viaMut("basura_extra");
    case "exportar_csv": return viaMut(o.separador === "," ? "csv_coma" : "csv_punto_y_coma");
    case "celdas_combinadas": return viaMut("celdas_combinadas");
    case "columna_indice": return viaMut("columna_indice");
    case "ceros_en_texto": return viaMut("ceros_en_texto");
    case "filas_vacias_intercaladas": return viaMut("filas_vacias_intercaladas");
    case "pocas_filas": return viaMut("pocas_filas");
    case "muchas_filas": return viaMut("muchas_filas");
    case "vacio_como_cero": return viaMut("vacio_como_cero");
    case "vacio_como_guion": return viaMut("vacio_como_guion");
    case "exportar_xls_antiguo": return viaMut("xls_antiguo");
  }
}

/** Lo que viaja a DeepSeek: solo estructura (títulos de columna del banco, roles, formatos, placeholders). */
function specParaIa(s: Spec) {
  return {
    familia: s.familia, hoja: s.hoja, filas_arriba: (s.arriba ?? []).length, titulos: s.titulos !== false,
    columnas: s.columnas.map((c) => ({ titulo: c.titulo, rol: c.rol, celda: c.celda ?? "s", formato_excel: c.z ?? null, formato_texto: c.fmt ?? null })),
    orden: s.orden ?? "asc", direcciones: s.direcciones ?? "ambas", filtrada: !!s.filtrada, pie: (s.pie ?? []).map((p) => p.tipo),
    resumen: /SALDO_INICIAL|SALDO_FINAL/.test(JSON.stringify([s.arriba, s.abajo, s.hojas_extra])), hojas_extra: (s.hojas_extra ?? []).map((h) => h.tipo),
    formato_archivo: s.formato ?? "xlsx",
  };
}

const SISTEMA =
  "Eres un tester adversarial de un lector de cartolas bancarias chilenas (Excel/CSV). Recibes la ESTRUCTURA de un formato real (sin datos). " +
  "Inventa variantes PLAUSIBLES —cosas que un banco chileno realmente hace al rediseñar su export, o que una pyme hace al editar la planilla antes de subirla— " +
  "que puedan confundir a un lector determinístico: títulos renombrados o abreviados, columnas movidas/agregadas/quitadas, otro formato de fecha o de monto, " +
  "resúmenes y totales, glosas partidas, hojas extra, export filtrado, CSV. Cada variante combina 1 a 4 operaciones del vocabulario. " +
  "No inventes operaciones fuera del enum. Usa '' / -1 en los campos que no aplican.";

async function pedir(spec: Spec, angulo: string, n: number): Promise<{ nombre: string; razon: string; ops: Op[] }[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(OPENCODE_GO_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENCODE_GO_API_KEY}`, "Content-Type": "application/json", "x-opencode-session": randomUUID(), "User-Agent": "massdte-corpus-cartolas/1.0" },
      body: JSON.stringify({
        model: MODELO_OPENCODE, temperature: 0.8, tools: [TOOL], tool_choice: { type: "function", function: { name: "variantes_formato" } },
        messages: [{ role: "system", content: SISTEMA }, { role: "user", content: `Ángulo: ${angulo}\nDevuelve ${n} variantes distintas.\nFormato:\n${JSON.stringify(specParaIa(spec), null, 1)}` }],
      }),
      signal: ctrl.signal,
    });
    const txt = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = JSON.parse(txt) as { choices?: { message?: { tool_calls?: { function?: { arguments?: string } }[] } }[] };
    const a = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!a) throw new Error("sin tool_call");
    return (JSON.parse(a) as { variantes: { nombre: string; razon: string; ops: Op[] }[] }).variantes ?? [];
  } finally { clearTimeout(timer); }
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  const specs = leerSpecs().filter((s) => !SOLO || s.id === SOLO);
  const angulos = [
    "el BANCO rediseña su export (nuevo sistema, nuevo proveedor de core bancario, versión para empresas vs personas)",
    "la CLIENTA edita la planilla antes de subirla (borra o agrega columnas, filtra, cambia formatos, agrega totales, copia a otra hoja)",
  ];
  let ok = 0, malas = 0, fallas = 0;
  await Promise.all(specs.map(async (s, si) => {
    const out: Spec[] = [];
    for (const [ai, ang] of angulos.entries()) {
      let vars: Awaited<ReturnType<typeof pedir>> = [];
      for (let intento = 0; intento < 2 && !vars.length; intento++) {
        try { vars = await pedir(s, ang, ai === 0 ? N : Math.max(4, N - 2)); } catch (e) { fallas++; process.stderr.write(`${s.id} [${ai}] ${(e as Error).message}\n`); }
      }
      vars.forEach((v, vi) => {
        const r = rngDe(31_000 + si * 100 + ai * 50 + vi);
        let t: Spec | null = s;
        for (const o of v.ops ?? []) { if (!t) break; t = aplicarOp(t, o, r) ?? t; }
        if (!t || t === s || !direccionDecidible(t) || !t.columnas.some((c) => c.rol === "fecha")) { malas++; return; }
        out.push({ ...t, id: `${s.id}~ds${ai}${String(vi).padStart(2, "0")}`, origen: "deepseek-mutacion", base: undefined, mutaciones: [`ds${ai}${String(vi).padStart(2, "0")}:${String(v.nombre).replace(/[|+\s]/g, "_").slice(0, 40)}`], ...({ ops_deepseek: v.ops, razon_deepseek: String(v.razon).slice(0, 200) } as object) } as Spec);
        ok++;
      });
    }
    // El spec_id de la familia es el del spec base (para las tablas por familia).
    writeFileSync(join(DIR, `${s.id}.json`), JSON.stringify(out.map((x) => ({ ...x, id: s.id, variante: (x as { id: string }).id })), null, 1));
    process.stderr.write(`${s.id}: ${out.length} variantes\n`);
  }));
  console.log(`variantes útiles ${ok} · descartadas (no aplican / verdad indecidible) ${malas} · llamadas fallidas ${fallas}`);
  console.log(reporteSoloOpenCode());
}
main().catch((e) => { console.error(e); process.exit(1); });
