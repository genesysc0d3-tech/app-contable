import { describe, it, expect } from "vitest";
import { jsPDF } from "jspdf";
import { PDFParse } from "pdf-parse";
import { PdfProtegidoError, MENSAJE_PDF_PROTEGIDO, variantesClaveDesdeRut, esErrorDeClavePdf } from "./pdf-protegido";

/** PDF sintético (sin datos reales). Con clave si se pasa `pass`. */
function pdfSintetico(pass?: string): Uint8Array {
  const doc = new jsPDF(pass ? { encryption: { userPassword: pass, ownerPassword: pass + "o", userPermissions: ["print"] } } : {});
  doc.text("CARTOLA SINTETICA", 10, 10);
  doc.text("01/08/2026 TRANSFER DE CLIENTE UNO 150000", 10, 20);
  return new Uint8Array(doc.output("arraybuffer"));
}

async function leer(src: Uint8Array, password?: string) {
  // copia por intento: pdf.js transfiere el buffer al worker y lo deja desprendido
  const data = new Uint8Array(src);
  const p = new PDFParse(password ? { data, password } : { data });
  try { return (await p.getText()).text; } finally { await p.destroy().catch(() => {}); }
}

describe("variantesClaveDesdeRut", () => {
  it("genera RUT completo, sin DV, y prefijos, sin duplicados", () => {
    expect(variantesClaveDesdeRut("76.448.088-7")).toEqual(["764480887", "76448088", "7644", "764480"]);
  });
  it("maneja DV K (mayúscula y minúscula)", () => {
    const v = variantesClaveDesdeRut("12.345.678-K");
    expect(v[0]).toBe("12345678K");
    expect(v).toContain("12345678k");
    expect(v).toContain("12345678");
  });
  it("vacío/null/inválido → sin variantes", () => {
    expect(variantesClaveDesdeRut(null)).toEqual([]);
    expect(variantesClaveDesdeRut("")).toEqual([]);
    expect(variantesClaveDesdeRut("x")).toEqual([]);
  });
  it("RUT corto no revienta (no hay prefijo si no alcanza)", () => {
    expect(variantesClaveDesdeRut("1-9")).toEqual(["19", "1"]);
  });
});

describe("esErrorDeClavePdf", () => {
  it("reconoce PasswordException por nombre y por mensaje", () => {
    expect(esErrorDeClavePdf({ name: "PasswordException", message: "x" })).toBe(true);
    expect(esErrorDeClavePdf(new Error("No password given"))).toBe(true);
    expect(esErrorDeClavePdf(new Error("Incorrect Password"))).toBe(true);
  });
  it("NO confunde otros errores (corrupto, red) con clave", () => {
    expect(esErrorDeClavePdf(new Error("Invalid PDF structure"))).toBe(false);
    expect(esErrorDeClavePdf(null)).toBe(false);
    expect(esErrorDeClavePdf("string")).toBe(false);
  });
});

describe("PdfProtegidoError", () => {
  it("es definitivo y trae el mensaje humano por defecto", () => {
    const e = new PdfProtegidoError();
    expect(e.definitivo).toBe(true);
    expect(e.name).toBe("PdfProtegidoError");
    expect(e.message).toBe(MENSAJE_PDF_PROTEGIDO);
    expect(e.message).toMatch(/RUT sin puntos ni guion/);
  });
});

describe("integración real con pdf-parse (PDF cifrado sintético)", () => {
  it("PDF sin clave se lee normal", async () => {
    const t = await leer(pdfSintetico());
    expect(t).toContain("CARTOLA SINTETICA");
  });
  it("PDF con clave sin password → PasswordException detectable", async () => {
    let err: unknown = null;
    try { await leer(pdfSintetico("12345678")); } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(esErrorDeClavePdf(err)).toBe(true);
  });
  it("PDF con clave + password incorrecta → también detectable (no se confunde con corrupto)", async () => {
    let err: unknown = null;
    try { await leer(pdfSintetico("12345678"), "99999999"); } catch (e) { err = e; }
    expect(esErrorDeClavePdf(err)).toBe(true);
  });
  it("el RUT de la empresa (sin puntos/guion) abre una cartola cifrada con esa clave", async () => {
    // Banco típico chileno: clave = RUT del titular sin puntos ni guion.
    const rutEmpresa = "76.448.088-7";
    const data = pdfSintetico("764480887");
    let texto: string | null = null;
    for (const clave of variantesClaveDesdeRut(rutEmpresa)) {
      try { texto = await leer(data, clave); break; } catch (e) { if (!esErrorDeClavePdf(e)) throw e; }
    }
    expect(texto).toContain("CARTOLA SINTETICA");
  });
  it("si la clave NO es el RUT, ninguna variante abre → se debe lanzar PdfProtegidoError", async () => {
    const data = pdfSintetico("otra-clave-2024");
    let abierto = false;
    for (const clave of variantesClaveDesdeRut("76.448.088-7")) {
      try { await leer(data, clave); abierto = true; break; } catch (e) { if (!esErrorDeClavePdf(e)) throw e; }
    }
    expect(abierto).toBe(false);
  });
});
