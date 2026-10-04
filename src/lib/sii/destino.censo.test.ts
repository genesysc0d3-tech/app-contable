import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { destino, esAfectoPorTipo, FUENTE_CONFLICTO_MARCA, TODOS_LOS_TIPOS, type Destino } from "./destino";
import { tipoMeta } from "@/app/(app)/escritorio/v5/tipo-meta";

// CENSO del destino único (plan cirujano, Fase 2). Antes había 7 listas de "qué es
// venta" que no coincidían (limbo arriendo/comisión). Este test se pone rojo si:
//  - un tipo queda sin destino o el destino deja de cubrir el tipo del modelo;
//  - Check pinta algo distinto del destino (p. ej. una no-venta como "EXE");
//  - uno de los consumidores vuelve a escribir una lista literal de tipos.
const RAIZ = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const DESTINOS: Destino[] = ["boleta", "factura", "no_es_venta", "preguntar"];

describe("censo: cada tipo tiene exactamente un destino", () => {
  it("todos los tipos válidos tienen un destino conocido", () => {
    for (const t of TODOS_LOS_TIPOS) expect(DESTINOS).toContain(destino(t));
  });

  it("los tipos del modelo (PropuestaExtraida.tipo_propuesto) = TODOS_LOS_TIPOS", () => {
    const src = leer("src/lib/ai/types.ts");
    const m = src.match(/tipo_propuesto:\s*((?:"[a-z0-9_]+"\s*\|?\s*)+);/);
    expect(m, "no encontré la unión tipo_propuesto en types.ts").toBeTruthy();
    const delModelo = [...m![1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]).sort();
    expect([...TODOS_LOS_TIPOS].sort()).toEqual(delModelo);
  });
});

describe("censo: Check pinta igual que el destino", () => {
  for (const t of TODOS_LOS_TIPOS) {
    it(`${t} → ${destino(t)}`, () => {
      const tm = tipoMeta(t);
      expect(tm.destino).toBe(destino(t));
      if (destino(t) === "preguntar") expect(tm.sigla).toBe("¿?");
      if (destino(t) === "no_es_venta" || destino(t) === "preguntar") {
        expect(["EXE", "AFE"]).not.toContain(tm.sigla);
      } else {
        expect(tm.sigla).toBe(esAfectoPorTipo(t) ? "AFE" : "EXE");
      }
    });
  }
  it("por decidir dice «¿Es venta? · decide tú»", () => {
    expect(tipoMeta("arriendo").label).toBe("¿Es venta? · decide tú");
  });
  it("la fila en conflicto regla↔marca se pinta «¿?», no AFE", () => {
    expect(tipoMeta({ tipo_propuesto: "boleta", tipo_dte: null, fuente_clasificacion: FUENTE_CONFLICTO_MARCA }).sigla).toBe("¿?");
    expect(tipoMeta({ tipo_propuesto: "boleta", tipo_dte: 39, fuente_clasificacion: FUENTE_CONFLICTO_MARCA }).sigla).toBe("AFE");
  });
});

// Consumidores que antes tenían su propia lista. Deben importar el destino único y
// NO tener listas literales de tipos (arreglo/Set con ≥2 tipos, o una cadena
// `x === "tipo" || x === "tipo"`).
const CONSUMIDORES = [
  "src/lib/ai/processor.ts",
  "src/lib/ai/tipo-dte-persistido.ts",
  "src/lib/sii/tipos-propuesta.ts",
  "src/lib/intermediario/pendientes-emision.ts",
  "src/lib/intermediario/emision-decision.ts",
  "src/app/api/intermediaria/emitir-lote/route.ts",
  "src/app/(app)/escritorio/v5/revisar-shared.tsx",
  "src/app/(app)/escritorio/v5/tipo-meta.ts",
  "src/app/(app)/escritorio/v5/mesa-data.ts",
  "src/app/(app)/escritorio/v5/EditorAmpliado.tsx",
  "src/app/(app)/escritorio/v5/VeredictoCard.tsx",
  "src/app/(app)/escritorio/v5/CartolaEditor.tsx",
  "src/app/(app)/escritorio/v5/actions.ts",
  "src/lib/telegram/propuestas.ts",
  "src/app/(app)/revisar/actions.ts",
  "src/app/api/mcp/route.ts",
  "src/app/api/emision/jobs/route.ts",
  "src/app/(app)/escritorio/v5/preguntas-grupo.ts",
  "src/lib/clasificacion/responder-grupo.ts",
];
const TIPO = `"(?:${TODOS_LOS_TIPOS.join("|")})"`;
// (Un `enum: ["boleta", "factura"]` de MESA en un schema no es una lista de tipos.)
const LISTA_LITERAL = new RegExp(`(?<!enum:\\s*)\\[\\s*${TIPO}\\s*,\\s*${TIPO}`);
const CADENA_OR = new RegExp(`===\\s*${TIPO}\\s*\\|\\|[^\\n]*===\\s*${TIPO}`);

describe("censo: los consumidores importan el destino y no tienen listas propias", () => {
  for (const f of CONSUMIDORES) {
    it(f, () => {
      const src = leer(f);
      expect(src, `${f} no importa el destino único`).toMatch(/from\s+"(?:@\/lib\/sii\/destino|\.\.?\/(?:\.\.\/)*(?:sii\/)?destino)"/);
      expect(src.match(LISTA_LITERAL)?.[0] ?? null, `${f}: lista literal de tipos`).toBeNull();
      expect(src.match(CADENA_OR)?.[0] ?? null, `${f}: cadena === || === de tipos`).toBeNull();
    });
  }
});

// Toda puerta que APRUEBA / STAGEA en SQL excluye los «¿?» con el mismo par de filtros
// (destinoPropuesta en PostgREST). Y los carriles de emisión preguntan motivoNoEmitible
// o destinoPropuesta antes de emitir.
describe("censo: ninguna puerta aprueba ni emite un «¿?»", () => {
  const FILTRO = /\.not\("tipo_propuesto", "in", PG_TIPOS_POR_DECIDIR\)\s*(?:\/\/[^\n]*\s*)*\.or\(PG_OR_SIN_CONFLICTO_MARCA\)/g;
  it("revisar/actions: aprobarPropuesta, aprobarTodas, ponerListo y aprobarCartola", () => {
    expect(leer("src/app/(app)/revisar/actions.ts").match(FILTRO)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
  it("MCP dejar_en_emitir y aprobar de Telegram", () => {
    expect(leer("src/app/api/mcp/route.ts")).toMatch(FILTRO);
    expect(leer("src/lib/telegram/propuestas.ts")).toMatch(FILTRO);
  });
  it("jobs de la extensión: motivoNoEmitible ANTES del candado; lote: destinoPropuesta por mesa", () => {
    const jobs = leer("src/app/api/emision/jobs/route.ts");
    const iGuard = jobs.indexOf("motivoNoEmitible({");
    expect(iGuard).toBeGreaterThan(0);
    expect(iGuard).toBeLessThan(jobs.indexOf("acquireCuentaEmissionLock("));
    expect(leer("src/lib/emission/datos-job.ts")).toMatch(/SELECT_PROPUESTA_DATOS =[^;]*fuente_clasificacion/);
    const lote = leer("src/app/api/intermediaria/emitir-lote/route.ts");
    expect(lote).toMatch(/destinoPropuesta\(p as PropuestaParaDestino\)/);
    expect(lote).toMatch(/p\.mesa === "factura" \? destinoFila !== "factura" : !TIPOS_EMITIBLES\.includes/);
  });
});
