import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Test de FUENTE (plan-costo-vercel §5): la frescura de la mesa vive en UNA sola
// suscripción Realtime (MesaController). Si alguien vuelve a abrir un canal por
// componente, cada boleta vuelve a costar N recargas completas de /api/mesa.
const leer = (f: string) => readFileSync(join(__dirname, f), "utf8");

describe("una sola suscripción Realtime para la mesa", () => {
  it("MesaController abre exactamente un canal", () => {
    expect(leer("MesaController.tsx").match(/\.channel\(/g)?.length).toBe(1);
  });
  it("EmitirTabContent no abre canales propios", () => {
    expect(leer("EmitirTabContent.tsx")).not.toMatch(/supabase\s*\.channel\(/);
  });
  it("DocCardList solo abre canal y sondeo FUERA de la mesa (sin contexto de recarga)", () => {
    const src = leer("DocCardList.tsx");
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(ctxReload\) return;\s*const channel = supabase/);
    expect(src).toMatch(/if \(ctxReload \|\| !hasProcessing\) return;/);
  });
  it("la precarga de vistas depende del RANGO, no de cada recarga de la mesa", () => {
    expect(leer("MesaController.tsx")).toMatch(/\}, \[rangoActual\]\);/);
  });
});
