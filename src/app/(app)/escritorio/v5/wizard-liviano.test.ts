import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Wizard liviano (fundador 2026-09-07: "Team, Emisor y MCP se demoran caleta").
 * Causa: los 9 pasos se montaban al abrir y disparaban ~7 server actions que
 * Next corre EN FILA. Reglas que este censo sostiene:
 * (1) cada paso se monta recién al visitarlo y queda montado;
 * (2) Team y Empresas arrancan con la semilla que la página ya trajo (cero fetch);
 * (3) MCP se precarga en segundo plano y cachea 60 s.
 */
const V5 = "src/app/(app)/escritorio/v5/";
const leer = (p: string) => readFileSync(p, "utf8");

describe("1. pasos perezosos", () => {
  const popup = leer(V5 + "EmpresaPopup.tsx");
  it("solo el paso 0 monta al abrir; los demás al visitarlos, y no se desmontan", () => {
    expect(popup).toMatch(/useState<Set<number>>\(\(\) => new Set\(\[0\]\)\)/);
    expect(popup).toMatch(/setVisitados\(\(prev\) => \(prev\.has\(i\) \? prev : new Set\(prev\)\.add\(i\)\)\);\s*setStep\(i\);/);
    expect(popup).toMatch(/\{visitados\.has\(i\) \? s\.content : null\}/);
    expect(popup).toMatch(/display: i === step \? "block" : "none"/);
  });
});

describe("2. semilla desde la página", () => {
  it("page → V5Root → EmpresaPopup → Team y Emisor", () => {
    expect(leer(V5 + "page.tsx")).toMatch(/wizardSemilla=\{\{ team, empresasSelector \}\}/);
    expect(leer(V5 + "V5Root.tsx")).toMatch(/semilla=\{wizardSemilla\}/);
    const popup = leer(V5 + "EmpresaPopup.tsx");
    expect(popup).toMatch(/<TeamConfigPanel semilla=\{semilla \?\? null\} \/>/);
    expect(popup).toMatch(/semillaEmpresas=\{semilla\?\.empresasSelector \?\? null\}/);
  });

  it("con semilla, Team y Empresas NO piden nada al montar", () => {
    const team = leer(V5 + "TeamConfigPanel.tsx");
    expect(team).toMatch(/useState<TeamEstado \| null>\(semilla\?\.team \?\? null\)/);
    expect(team).toMatch(/if \(semilla\) \{[\s\S]*?return \(\) => window\.clearTimeout\(t\);\s*\}\s*let vivo = true;\s*void Promise\.all\(\[estadoTeam\(\), listarEmpresasSelector\(\)\]\)/);
    const panel = leer(V5 + "EmpresasCuentaPanel.tsx");
    expect(panel).toMatch(/useState<Estado>\(\(\) => \(semilla \? estadoDe\(semilla\) : \{ fase: "cargando" \}\)\)/);
    expect(panel).toMatch(/if \(semilla && refreshKey === 0\) return;/);
  });
});

describe("3. MCP precargado y cacheado", () => {
  it("el wizard precarga en segundo plano; el paso lee la caché; conectar/cortar la invalida", () => {
    expect(leer(V5 + "EmpresaPopup.tsx")).toMatch(/window\.setTimeout\(\(\) => \{ void precargarConectoresMcp\(\); \}, 1500\)/);
    const mcp = leer("src/app/(app)/empresa/ConectorMcpConfig.tsx");
    expect(mcp).toMatch(/const CACHE_MS = 60_000;/);
    expect(mcp).toMatch(/if \(conectoresCache && Date\.now\(\) - conectoresCache\.at < CACHE_MS\) return Promise\.resolve\(conectoresCache\.res\);/);
    expect(mcp).toMatch(/if \(fresco\) conectoresCache = null;/);
    expect(mcp).toMatch(/if \(res\.ok\) cargar\(true\);/);
    // Un error no se cachea: el reintento vuelve a pedir.
    expect(mcp).toMatch(/if \(res\.ok\) conectoresCache = \{ at: Date\.now\(\), res \};/);
  });
});
