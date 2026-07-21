import { describe, expect, it } from "vitest";
import { esTipoPropuestoExento, TIPOS_PROPUESTA_EXENTOS } from "./tipos-propuesta";

// Regresión de la divergencia (auditoría 2026-07-04): VeredictoCartola omitía
// factura_exenta y transferencia_p2p y los contaba como afectos. La fuente única
// debe reconocer los 5 tipos exentos por igual en toda la app.
describe("esTipoPropuestoExento — fuente única de tipos exentos", () => {
  it("reconoce los 5 tipos exentos (incluidos los que VeredictoCartola omitía)", () => {
    for (const t of ["exenta", "factura_exenta", "compraventa_crypto", "transferencia_p2p", "operacion_forex"]) {
      expect(esTipoPropuestoExento(t)).toBe(true);
    }
  });

  it("no marca como exentos los tipos afectos ni desconocidos", () => {
    for (const t of ["boleta", "factura", "factura_afecta", "no_comercial", "", null, undefined]) {
      expect(esTipoPropuestoExento(t)).toBe(false);
    }
  });

  it("la lista canónica tiene exactamente esos 5 tipos", () => {
    expect([...TIPOS_PROPUESTA_EXENTOS].sort()).toEqual(
      ["compraventa_crypto", "exenta", "factura_exenta", "operacion_forex", "transferencia_p2p"],
    );
  });
});
