import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * El certificado digital delegado lo exige UN SOLO carril: SimpleAPI.
 * `sii_local` firma con la clave del propio cliente en su navegador y `mock`
 * no emite. El 2026-09-04 un cliente con la extensión recibió "el contribuyente
 * aún no cargó su certificado digital SII" y quedó con 3 facturas detenidas,
 * porque el gate preguntaba `!== "mock"` y trataba "no es mock" como "es
 * SimpleAPI".
 *
 * La regla que dejó la auditoría: con más de un carril no-mock, el único
 * chequeo seguro es `=== <proveedor>`. Este test la sostiene sobre el código.
 */
const RUTAS_QUE_EXIGEN_CERTIFICADO = [
  "src/app/api/intermediaria/emitir-lote/route.ts",
  "src/app/api/intermediaria/emitir-boleta/route.ts",
];

describe("carril del certificado — solo SimpleAPI lo pide", () => {
  for (const ruta of RUTAS_QUE_EXIGEN_CERTIFICADO) {
    it(`${ruta}: el gate del certificado pregunta por el proveedor EXACTO`, () => {
      const src = readFileSync(ruta, "utf8");
      const lineas = src.split("\n");
      const iCert = lineas.findIndex((l) => l.includes("verificarCertificado("));
      expect(iCert).toBeGreaterThan(-1);

      // Las 12 líneas anteriores son la condición que decide si se pide.
      const guardia = lineas.slice(Math.max(0, iCert - 12), iCert).join("\n");
      expect(guardia).toMatch(/===\s*"simpleapi"/);
      // Si alguien vuelve al atajo, este test cae.
      const condicionQueDecide = guardia.split("\n").filter((l) => l.trim().startsWith("if ("));
      for (const cond of condicionQueDecide) {
        expect(cond).not.toMatch(/!==\s*"mock"[\s\S]*verificarCertificado/);
      }
    });
  }

  it("el lote de FACTURAS se juzga con el proveedor de facturas, no con el de boletas", () => {
    const src = readFileSync("src/app/api/intermediaria/emitir-lote/route.ts", "utf8");
    // El proveedor que decide tiene que depender del contenido del lote.
    expect(src).toMatch(/hayFacturas\s*\?\s*emisionConfig\.facturasProveedor\s*:\s*emisionConfig\.boletasProveedor/);
    // Y esa decisión debe venir DESPUÉS de saber qué trae el lote.
    const iHayFacturas = src.indexOf("const hayFacturas");
    const iProveedorLote = src.indexOf("const proveedorDelLote");
    expect(iHayFacturas).toBeGreaterThan(-1);
    expect(iProveedorLote).toBeGreaterThan(iHayFacturas);
  });

  it("ningún mensaje del certificado manda a buscar un .pfx sin decir que es de SimpleAPI", () => {
    const src = readFileSync("src/lib/intermediario/client.ts", "utf8");
    const linea = src.split("\n").find((l) => l.includes("certificado digital del SII")) ?? "";
    expect(linea).toMatch(/SimpleAPI/);
  });
});
