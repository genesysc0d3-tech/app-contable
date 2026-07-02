import { describe, expect, it } from "vitest";
import { getSystemPrompt, getClassifyOnlySystemPrompt } from "./prompt";

// Blindaje del "cerebro": el prompt es sales-only y distingue compra de venta.
// Si alguien revierte/edita el prompt y rompe esa lógica, estos tests fallan.
describe("prompt del clasificador — sales-only / compra vs venta", () => {
  it("distingue COMPRA (salida) de VENTA (entrada) y deja claro que la compra NO emite boleta", () => {
    const low = getSystemPrompt().toLowerCase();
    expect(low).toContain("compra");
    expect(low).toContain("venta");
    expect(low).toContain("salida");
    expect(low).toContain("entrada");
    expect(low).toMatch(/no genera boleta|costo/); // compra = costo, no boleta
  });

  it("razona desde las pistas del propio comprobante (TÚ / tu cuenta / Comprar / Vender / enviada)", () => {
    const p = getSystemPrompt();
    expect(p).toMatch(/TÚ|tu cuenta/);
    expect(p).toContain("Comprar");
    expect(p).toContain("Vender");
    expect(p).toMatch(/enviada|enviaste/i);
  });

  it("NO trae el sesgo viejo de 'asume entrada' por defecto", () => {
    expect(getSystemPrompt()).not.toContain('asume "entrada"');
  });

  it("crypto: compraventa_crypto cubre ambas direcciones y es exento (SII 963)", () => {
    const p = getSystemPrompt();
    expect(p).toContain("compraventa_crypto");
    expect(p).toContain("963");
  });

  it("el classify-only también respeta la dirección (salida = compra = sin boleta)", () => {
    const low = getClassifyOnlySystemPrompt().toLowerCase();
    expect(low).toContain("salida");
    expect(low).toContain("compra");
    expect(low).toMatch(/no genera boleta|no emite|costo/);
  });
});
