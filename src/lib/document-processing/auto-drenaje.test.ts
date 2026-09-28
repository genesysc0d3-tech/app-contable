import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Test de FUENTE (plan-costo-vercel §6, PR 2): /api/mesa corre en CADA carga de la
// mesa. Si vuelve a importar la cola (./queue → processor, parsers, OCR, IA) la
// función de la mesa vuelve a cargar todo eso en memoria para hacer dos COUNT.
const raiz = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const importsEstaticos = (src: string) => [...src.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)].map((m) => m[1]);

describe("auto-drenaje liviano", () => {
  it("auto-drenaje.ts no importa estáticamente la cola ni el drenaje", () => {
    const imps = importsEstaticos(leer("src/lib/document-processing/auto-drenaje.ts"));
    expect(imps.some((i) => /queue|\/drain$|\.\/drain$|processor|parsers|\/ai\//.test(i))).toBe(false);
  });
  it("/api/mesa toma el auto-drenaje del archivo liviano, no de drain", () => {
    const imps = importsEstaticos(leer("src/app/api/mesa/route.ts"));
    expect(imps).toContain("@/lib/document-processing/auto-drenaje");
    expect(imps).not.toContain("@/lib/document-processing/drain");
  });
});
