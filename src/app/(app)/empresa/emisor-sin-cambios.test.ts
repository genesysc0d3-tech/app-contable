import { describe, it, expect } from "vitest";
import { emisorSinCambios, type SnapshotEmisor } from "./emisor-sin-cambios";

const base: SnapshotEmisor = {
  rut: "776323993", razon_social: "Lc Services Spa", giro: "", direccion: "", comuna: "",
  email_sii: "", tipo_contribuyente: "auto", boletas_tipo_default: "auto",
  facturas_tipo_default: "auto", operacion_hint_default: null, sociedad_profesionales: false,
};

describe("emisorSinCambios (Listo/cambio de paso solo guarda si algo cambió)", () => {
  it("sin tocar nada → sin cambios", () => {
    expect(emisorSinCambios({ ...base }, base)).toBe(true);
  });
  it("Boletas → Exento cuenta como cambio (incidente LC 2026-09-25)", () => {
    expect(emisorSinCambios({ ...base, boletas_tipo_default: "exento" }, base)).toBe(false);
  });
  it("Facturas → Exento cuenta como cambio", () => {
    expect(emisorSinCambios({ ...base, facturas_tipo_default: "exento" }, base)).toBe(false);
  });
  it("dirección nueva cuenta como cambio", () => {
    expect(emisorSinCambios({ ...base, direccion: "Av. Siempre Viva 123" }, base)).toBe(false);
  });
  it("hint null y undefined son lo mismo", () => {
    expect(emisorSinCambios({ ...base, operacion_hint_default: null }, { ...base, operacion_hint_default: undefined as unknown as null })).toBe(true);
  });
});
