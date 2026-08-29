/**
 * EL RESUMEN DE UN EVENTO NO PUEDE LLEVAR DATOS DE NADIE.
 *
 * `ops_events.summary` es lo que el panel del operador imprime SIEMPRE, y
 * además sale al webhook externo y a Telegram. Durante meses pasó solo por un
 * recorte de largo mientras la metadata sí se saneaba: el enmascarado de
 * correos y RUTs se saltaba entero por ese camino.
 *
 * Y hay emisores que meten texto del CLIENTE adentro: la extensión RPA manda
 * un `status_message` raspado del portal del SII —donde vive el RUT y el
 * nombre del receptor— y entraba crudo al resumen.
 *
 * Estos tests son sobre `sanitizeString`, que es por donde pasa ahora. Van
 * casos REALES, no inventados: si alguien los relaja, que sea a sabiendas.
 */
import { describe, expect, it } from "vitest";
import { sanitizeString } from "./sanitize";

describe("el resumen no filtra identidad", () => {
  it("enmascara el RUT que la extensión raspa del portal", () => {
    const salida = sanitizeString("No pude emitir a 12.345.678-9 (Juan Pérez)");
    expect(salida).not.toContain("12.345.678-9");
    expect(salida).not.toContain("12345678");
  });

  it("enmascara correos", () => {
    expect(sanitizeString("rebotó el correo a angelica.marcano@gmail.com")).not.toContain("angelica.marcano@");
  });

  it("el RUT sin puntos también cae", () => {
    expect(sanitizeString("emisor 78042981-K rechazado")).not.toContain("78042981");
  });
});

describe("el resumen no filtra ubicación ni credenciales", () => {
  it("una URL entera se reemplaza, no se recorta", () => {
    const salida = sanitizeString("falló GET https://abc.r2.cloudflarestorage.com/bucket/x.sql.gz?X-Amz-Signature=deadbeef");
    expect(salida).not.toContain("cloudflarestorage");
    expect(salida).not.toContain("Signature");
    expect(salida).toContain("[url]");
  });

  it("la ruta de un archivo del cliente no llega al panel", () => {
    const salida = sanitizeString("no pude leer 3b5ee4d8-0b4c/9f2a1c77-aa/cartola-santander-marzo.xlsx");
    expect(salida).not.toContain("cartola-santander");
    expect(salida).toContain("[ruta]");
  });

  it("un token EN MEDIO de la frase se redacta (antes solo caía si venía solo)", () => {
    const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${"a".repeat(80)}.firma`;
    const salida = sanitizeString(`Invalid JWT: ${jwt} al abrir la bóveda`);
    expect(salida).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(salida).toContain("al abrir la bóveda");
  });

  it("pero deja legible lo que sí sirve para operar", () => {
    const salida = sanitizeString("connect ETIMEDOUT al proveedor de almacenamiento");
    expect(salida).toBe("connect ETIMEDOUT al proveedor de almacenamiento");
  });
});

describe("el que escribe eventos usa el saneador", () => {
  it("recordOpsEvent pasa el summary por sanitizeString, no solo por cleanText", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync("src/lib/ops/events.ts", "utf8");
    expect(fuente).toContain("summary: sanitizeString(");
    // El bug original: `summary: cleanText(input.summary)` a secas.
    expect(fuente).not.toMatch(/summary:\s*cleanText\(input\.summary\)\s*,/);
  });
});
