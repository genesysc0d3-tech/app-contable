import { describe, expect, it } from "vitest";
import { MEDIOS_PAGO_SII, esMedioPagoValido } from "./medios-pago";

describe("medios de pago del SII", () => {
  it("incluye Transferencia (el caso de las cartolas bancarias)", () => {
    expect(MEDIOS_PAGO_SII).toContain("Transferencia");
    expect(esMedioPagoValido("Transferencia")).toBe(true);
  });

  it("rechaza rótulos inventados (el worker aborta si no existe en el portal)", () => {
    expect(esMedioPagoValido("Bitcoin")).toBe(false);
    expect(esMedioPagoValido("")).toBe(false);
  });

  it("NO se exporta desde un archivo 'use server' (rompería el cliente)", async () => {
    const fs = await import("node:fs");
    const actions = fs.readFileSync(new URL("../../app/(app)/subir/actions.ts", import.meta.url), "utf8");
    // Un "use server" solo puede exportar funciones async: exportar la constante
    // ahí la vuelve una referencia de servidor → "map is not a function" (500).
    expect(actions).not.toContain("export const MEDIOS_PAGO_SII");
  });
});
