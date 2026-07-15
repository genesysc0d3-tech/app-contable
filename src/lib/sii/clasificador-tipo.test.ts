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

describe("clasificarBoleta — hint afecta cede ante exención por ley / exento (auditoría #9)", () => {
  it("empresa EXENTA + hint servicios + glosa neutral → EXENTA 41 (no puede emitir DTE 39)", () => {
    const r = clasificarBoleta(mov("pago cliente"), { ...empresaAuto, tipo_contribuyente: "exento" }, undefined, "servicios");
    expect(r.tipo_dte).toBe(41);
    expect(r.sugerencia).toBe("exenta");
  });

  it("empresa afecta + hint ventas + glosa cripto por ley → EXENTA 41 (la ley gana al hint)", () => {
    const r = clasificarBoleta(mov("venta USDT Binance P2P"), { ...empresaAuto, tipo_contribuyente: "afecto" }, undefined, "ventas");
    expect(r.tipo_dte).toBe(41);
    expect(r.sugerencia).toBe("exenta");
  });

  it("sanity: empresa afecta + hint servicios + glosa neutral SIGUE AFECTA 39 (hint autoritativo sin conflicto)", () => {
    const r = clasificarBoleta(mov("pago cliente"), { ...empresaAuto, tipo_contribuyente: "afecto" }, undefined, "servicios");
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

  it("una exención POR LEY (cripto) gana aunque la empresa esté mal configurada como afecto", () => {
    // Caso del contador: trader P2P registrado por error como "afecto". La glosa cripto
    // (exenta 0.85, Of. 963/2018) NO debe quedar tapada por el default afecto → DTE 41.
    const r = clasificarBoleta(mov("venta USDT Binance P2P"), { ...empresaAuto, tipo_contribuyente: "afecto" });
    expect(r.tipo_dte).toBe(41);

    // Pero una glosa afecta-por-naturaleza (servicio) con empresa afecta sí queda afecta.
    const r2 = clasificarBoleta(mov("servicio de asesoría"), { ...empresaAuto, tipo_contribuyente: "afecto" });
    expect(r2.tipo_dte).toBe(39);
  });
});

// Guardarraíl del CABLE de auto-clasificación (processor.ts): el cable persiste
// tipo_dte al vuelo para que la cartola no nazca 100% pendiente, PERO nunca sobre
// un no_boletar. Estos tests fijan que el clasificador caza los no-ventas claros
// (aunque venga un hint fuerte) y que sí resuelve la transferencia muda del P2P.
describe("clasificarBoleta — guardarraíl del cable de auto-clasificación", () => {
  it("caza los no-ventas CLAROS como no_boletar aunque venga hint fuerte", () => {
    // El cable nunca persiste tipo sobre estos → nunca se emiten, ni con hint.
    for (const g of [
      "PRESTAMO DE JUAN",
      "transferencia entre cuentas propias",
      "CAPITAL ACCIONISTA 2025",
      "APORTE INTEGRACION CAPITAL",
      "aporte de capital socio",
      "DEPOSITO A PLAZO 90 dias",
      "sueldo liquidacion de remuneraciones",
    ]) {
      const r = clasificarBoleta(mov(g), empresaAuto, undefined, "p2p_cripto");
      expect(r.sugerencia, g).toBe("no_boletar");
      expect(r.tipo_dte, g).toBeNull();
    }
  });

  it("el hint SÍ clasifica la transferencia P2P muda como venta exenta (caso del fundador)", () => {
    // "TRANSF DE JUAN PEREZ" no tiene señal cripto en la glosa, pero el hint
    // p2p_cripto la lleva a 41 — es exactamente lo que el cable persiste.
    const r = clasificarBoleta(mov("TRANSFERENCIA DE JUAN PEREZ"), empresaAuto, undefined, "p2p_cripto");
    expect(r.sugerencia).not.toBe("no_boletar");
    expect(r.tipo_dte).toBe(41);
  });
});
