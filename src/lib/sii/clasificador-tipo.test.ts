import { describe, it, expect } from "vitest";
import { clasificarBoleta } from "./clasificador-tipo";

const empresaAuto = { giro: null, razon_social: "Test SpA", tipo_contribuyente: "auto" };
const mov = (descripcion: string, monto = 50_000) => ({ descripcion, monto, fecha: "2026-06-11", receptor_nombre: null });

describe("clasificarBoleta — precedencia de reglas", () => {
  it("transferencia entre cuentas propias NO se boletea (gana a todo)", () => {
    const r = clasificarBoleta(mov("Transferencia a cuenta propia"), empresaAuto);
    expect(r.sugerencia).toBe("no_boletar");
    expect(r.tipo_dte).toBeNull();
  });

  it("no_boletar fuerte por glosa prevalece INCLUSO sobre hint del usuario", () => {
    const r = clasificarBoleta(mov("Préstamo bancario cuota"), empresaAuto, undefined, "p2p_cripto");
    expect(r.sugerencia).toBe("no_boletar");
    expect(r.tipo_dte).toBeNull();
  });

  it("hint p2p_cripto es autoritativo → EXENTA 41 (Of. SII 963/2018)", () => {
    const r = clasificarBoleta(mov("abono recibido xyz"), empresaAuto, undefined, "p2p_cripto");
    expect(r.tipo_dte).toBe(41);
    expect(r.sugerencia).toBe("exenta");
  });

  it("hint forex_divisas → EXENTA 41", () => {
    const r = clasificarBoleta(mov("pago cliente"), empresaAuto, undefined, "forex_divisas");
    expect(r.tipo_dte).toBe(41);
  });

  it("hint servicios → AFECTA 39", () => {
    const r = clasificarBoleta(mov("pago cliente"), empresaAuto, undefined, "servicios");
    expect(r.tipo_dte).toBe(39);
    expect(r.sugerencia).toBe("afecta");
  });
});

describe("clasificarBoleta — ángulos heurísticos", () => {
  it("glosa cripto sin hint → exenta (activo incorporal, sin IVA)", () => {
    const r = clasificarBoleta(mov("compra USDT binance p2p"), empresaAuto);
    expect(r.tipo_dte).toBe(41);
    expect(r.confianza).toBeGreaterThan(0.8);
  });

  it("glosa de salud → exenta (Art. 12 letra E N°7)", () => {
    const r = clasificarBoleta(mov("consulta médica"), empresaAuto);
    expect(r.tipo_dte).toBe(41);
  });

  it("devolución/reverso → no_boletar", () => {
    const r = clasificarBoleta(mov("devolución compra"), empresaAuto);
    expect(r.sugerencia).toBe("no_boletar");
  });

  it("glosa neutra sin señales → default AFECTA con confianza baja (revisión humana)", () => {
    const r = clasificarBoleta(mov("zzz qqq"), empresaAuto);
    expect(r.tipo_dte).toBe(39);
    expect(r.confianza).toBeLessThanOrEqual(0.5);
  });

  it("tipo_contribuyente de la empresa domina sobre keyword aislada", () => {
    // Empresa declarada EXENTA + glosa de servicio (afecta 0.8): gana el default empresa (0.9)
    const r = clasificarBoleta(mov("servicio de asesoría"), { ...empresaAuto, tipo_contribuyente: "exento" });
    expect(r.tipo_dte).toBe(41);

    // Empresa AFECTA + glosa neutra → afecta
    const r2 = clasificarBoleta(mov("zzz qqq"), { ...empresaAuto, tipo_contribuyente: "afecto" });
    expect(r2.tipo_dte).toBe(39);
  });
});
