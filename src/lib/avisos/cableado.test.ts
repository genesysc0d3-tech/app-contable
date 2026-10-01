import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Cableado de los avisos: viajan en pedidos que la app YA hace (cero sondeo),
// se montan en el layout de la app, y sus overlays respetan el inventario de la
// actualización invisible (el popup urgente bloquea la recarga; toast y tarjeta
// no guardan nada y se declaran libres).

const fuente = (p: string) => readFileSync(p, "utf8");
const APP = "src/components/AvisosApp.tsx";
const VISTA = "src/components/AvisoVista.tsx";

describe("entrega sin gasto extra", () => {
  it("el layout de la app trae los avisos en su render y monta <AvisosApp>", () => {
    const src = fuente("src/app/(app)/layout.tsx");
    expect(src).toMatch(/avisosPendientes\(/);
    expect(src).toMatch(/<AvisosApp [^>]*iniciales=\{avisos\}/);
    // en modo soporte el operador NO consume (ni marca) avisos de la clienta
    expect(src).toMatch(/supportMode \? null : \(\s*<Suspense/);
  });

  it("/api/mesa los suma a su respuesta normal (en paralelo, sin modo soporte) y la mesa los publica", () => {
    // /api/mesa devuelve tal cual lo que arma cargarMesa
    expect(fuente("src/app/api/mesa/route.ts")).toMatch(/NextResponse\.json\(res,/);
    expect(fuente("src/app/(app)/escritorio/v5/actions.ts")).toMatch(/ctx\.supportMode \? Promise\.resolve\(\[\] as AvisoApp\[\]\) : avisosPendientes\(ctx\.sb, \{ userId: ctx\.userId, empresaId: ctx\.empresaId \}\)/);
    expect(fuente("src/app/(app)/escritorio/v5/MesaController.tsx")).toMatch(/publicarAvisos\(/);
  });

  it("el componente no sondea (sin setInterval) y marca visto directo en Supabase (sin Vercel)", () => {
    const src = fuente(APP);
    expect(src).not.toMatch(/setInterval/);
    expect(src).not.toMatch(/fetch\(/);
    expect(src).toMatch(/from\("avisos_vistos"\)\.upsert\(/);
    expect(src).toMatch(/ignoreDuplicates: true/);
  });
});

describe("momento seguro (reusa la actualización invisible)", () => {
  it("decide con motivoOcupado + bloqueos y reintenta al liberarse un bloqueo", () => {
    const src = fuente(APP);
    expect(src).toMatch(/motivoOcupado\(\{/);
    expect(src).toMatch(/bloqueos: bloqueosActivos\(\)/);
    expect(src).toMatch(/alLiberarBloqueo\(/);
    // no aparece mientras la página se está restaurando tras una recarga invisible
    expect(src).toMatch(/ATRIBUTO_RESTAURANDO/);
  });
});

describe("inventario de overlays", () => {
  it("el popup urgente es modal marcado (bloquea la recarga mientras está abierto)", () => {
    const src = fuente(VISTA);
    expect(src).toMatch(/role="dialog"[^>]*aria-modal="true"[^>]*data-actualizacion-espera/);
  });
  it("toast y tarjeta se declaran libres con motivo", () => {
    const src = fuente(VISTA);
    const libres = src.match(/actualizacion-libre: \S.*/g) ?? [];
    expect(libres.length).toBeGreaterThanOrEqual(2);
  });
});
