import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { emisorCompleto, faltanDelEmisor, mensajeEmisorIncompleto } from "./emisor-completo";

/**
 * Emisor incompleto (fundador 2026-09-08): sin RUT/razón social/giro la
 * extensión no anda, así que Emitir no abre la confirmación — manda al
 * wizard, paso Emisor, en la empresa de la mesa.
 */
describe("qué falta del emisor", () => {
  it("RUT, razón social y giro son el mínimo; dirección y comuna no bloquean", () => {
    expect(faltanDelEmisor({ rut: "77.155.156-4", razon_social: "MV SpA", giro: "Contabilidad" })).toEqual([]);
    expect(faltanDelEmisor({ rut: "77.155.156-4", razon_social: "MV SpA", giro: "  " })).toEqual(["giro"]);
    expect(faltanDelEmisor({ rut: null, razon_social: "", giro: null })).toEqual(["RUT", "razón social", "giro"]);
    expect(faltanDelEmisor(null)).toEqual(["RUT", "razón social", "giro"]);
    expect(emisorCompleto({ rut: "1-9", razon_social: "Juan", giro: "Servicios", direccion: null, comuna: null } as never)).toBe(true);
  });

  it("copy humano", () => {
    expect(mensajeEmisorIncompleto(["giro"])).toBe("Falta el giro del emisor. Configúralo antes de emitir.");
    expect(mensajeEmisorIncompleto(["RUT", "giro"])).toBe("Faltan el RUT y giro del emisor. Configúralo antes de emitir.");
    expect(mensajeEmisorIncompleto([])).toBe("");
  });
});

describe("cableado: Emitir → wizard en la empresa de la mesa", () => {
  const V5 = "src/app/(app)/escritorio/v5/";
  it("page calcula lo que falta y llega hasta el botón Emitir", () => {
    expect(readFileSync(V5 + "page.tsx", "utf8")).toMatch(/emisorFaltan=\{faltanDelEmisor\(usuario\.empresas\)\}/);
    expect(readFileSync(V5 + "MesaController.tsx", "utf8")).toMatch(/emisorFaltan=\{emisorFaltan\}/);
    expect(readFileSync(V5 + "Mesa.tsx", "utf8")).toMatch(/<EmitirTabContent [^>]*emisorFaltan=\{emisorFaltan\}/);
  });

  it("con algo faltante: toast + abrir-empresa, y NO se abre la confirmación ni el lote", () => {
    const src = readFileSync(V5 + "EmitirTabContent.tsx", "utf8");
    const i = src.indexOf("if (emisorFaltan.length > 0) {");
    expect(i).toBeGreaterThan(0);
    const bloque = src.slice(i, i + 400);
    expect(bloque).toMatch(/toast\(mensajeEmisorIncompleto\(emisorFaltan as CampoEmisor\[\]\), "error"\);/);
    expect(bloque).toMatch(/window\.dispatchEvent\(new CustomEvent\("abrir-empresa"\)\);\s*return;/);
    expect(i).toBeLessThan(src.indexOf("if (proveedorReal && !esFacturas) setLoteOpen(true); else setConfirmOpen(true);"));
    // El wizard abre (no toggle) y arranca en el paso 0 = Emisor de la empresa activa.
    const root = readFileSync(V5 + "V5Root.tsx", "utf8");
    expect(root).toMatch(/window\.addEventListener\("abrir-empresa", abrir\)/);
    expect(readFileSync(V5 + "EmpresaPopup.tsx", "utf8")).toMatch(/const \[step, setStep\] = useState\(0\);/);
  });
});
