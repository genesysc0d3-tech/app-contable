// Los CUATRO puntos de versión de la extensión deben ir parejos (si no, la
// publicación muerde: manifest, manifest.prod, core.js y src/lib/extension.ts).
// Antes solo dos tenían test. Se leen como TEXTO (sin importar módulos).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const leer = (ruta) => readFileSync(join(__dirname, ruta), "utf8");

function versionDe(texto, regex, etiqueta) {
  const m = texto.match(regex);
  if (!m) throw new Error(`No encontré la versión en ${etiqueta}`);
  return m[1];
}

describe("versión de la extensión — 4 puntos sincronizados", () => {
  const manifest = JSON.parse(leer("manifest.json")).version;
  const manifestProd = JSON.parse(leer("manifest.prod.json")).version;
  const core = versionDe(leer("modules/core.js"), /export const EXTENSION_VERSION = "([^"]+)"/, "modules/core.js");
  const app = versionDe(leer("../../src/lib/extension.ts"), /export const EXTENSION_VERSION_ACTUAL = "([^"]+)"/, "src/lib/extension.ts");

  it("tienen forma X.Y.Z", () => {
    for (const v of [manifest, manifestProd, core, app]) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("manifest.json == manifest.prod.json == core.js == extension.ts", () => {
    expect(manifestProd).toBe(manifest);
    expect(core).toBe(manifest);
    expect(app).toBe(manifest);
  });
});
