import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { destino, esAfectoPorTipo, TODOS_LOS_TIPOS, type Destino } from "./destino";
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
];
const TIPO = `"(?:${TODOS_LOS_TIPOS.join("|")})"`;
const LISTA_LITERAL = new RegExp(`\\[\\s*${TIPO}\\s*,\\s*${TIPO}`);
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
