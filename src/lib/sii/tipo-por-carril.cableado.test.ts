import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * CENSO DE PUNTOS DE DECISIÓN del tipo tributario (2026-09-04).
 *
 * La configuración "afecta/exenta por carril" no vale nada si quien decide
 * sigue leyendo `tipo_contribuyente` a secas: el cliente configura y no pasa
 * nada. Este test no prueba un caso — prueba la PROPIEDAD de que ningún punto
 * de emisión vuelva a juzgar los dos mundos con una sola verdad.
 *
 * Si un archivo nuevo empieza a decidir el tipo, se agrega acá.
 */
const PUNTOS_DE_DECISION = [
  "src/app/api/intermediaria/emitir-lote/route.ts",
  "src/app/api/intermediaria/factura-unica/route.ts",
  "src/app/api/emision/jobs/route.ts",
  "src/lib/sii/clasificador-tipo.ts",
  "src/lib/ai/tipo-emisor.ts",
];

/** Comparar `tipo_contribuyente` contra un tipo literal ES la decisión. */
const COMPARACION_DIRECTA = /tipo_contribuyente\s*[!=]==\s*"(exento|afecto)"/;

describe("el tipo tributario se decide POR CARRIL, no por tipo_contribuyente", () => {
  for (const ruta of PUNTOS_DE_DECISION) {
    it(`${ruta}: no juzga con tipo_contribuyente directo`, () => {
      const src = readFileSync(ruta, "utf8");
      const ofensivas = src
        .split("\n")
        .map((l, i) => ({ n: i + 1, l }))
        .filter(({ l }) => COMPARACION_DIRECTA.test(l) && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"));
      expect(ofensivas.map((o) => `${o.n}: ${o.l.trim()}`)).toEqual([]);
    });

    it(`${ruta}: usa el punto único (tipoDelCarril / carrilEsExento)`, () => {
      const src = readFileSync(ruta, "utf8");
      expect(src).toMatch(/tipoDelCarril|carrilEsExento/);
    });
  }

  it("los selects de esos endpoints traen las columnas del carril", () => {
    for (const ruta of [
      "src/app/api/intermediaria/emitir-lote/route.ts",
      "src/app/api/emision/jobs/route.ts",
    ]) {
      const src = readFileSync(ruta, "utf8");
      expect(src, ruta).toContain("boletas_tipo_default");
      expect(src, ruta).toContain("facturas_tipo_default");
    }
    // La factura única solo necesita su propio carril.
    expect(readFileSync("src/app/api/intermediaria/factura-unica/route.ts", "utf8")).toContain("facturas_tipo_default");
  });
});
