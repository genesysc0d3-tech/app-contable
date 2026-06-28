import { describe, it, expect } from "vitest";
import { evaluarEmision, type EmisionInput, type EmisionCtx } from "./emision-decision";

// Base reutilizable: una venta afecta clara, aprobada, monto chico válido.
const baseInput = (over: Partial<EmisionInput> = {}): EmisionInput => ({
  estado: "aprobado",
  yaEmitida: false,
  total: 18000,
  descripcion: "Servicio de asesoría",
  fecha: "2026-06-13",
  receptorRut: null,
  receptorNombre: null,
  ...over,
});

const empresaAfecta: EmisionCtx = { empresa: { giro: "Servicios", tipo_contribuyente: "afecto" } };
const empresaExenta: EmisionCtx = { empresa: { giro: null, tipo_contribuyente: "exento" } };

describe("evaluarEmision — motor de reglas", () => {
  it("venta afecta clara y aprobada → LISTAS, emitible, con IVA > 0", () => {
    const v = evaluarEmision(baseInput(), empresaAfecta);
    expect(v.balde).toBe("listas");
    expect(v.puedeEmitir).toBe(true);
    expect(v.tipoDte).toBe(39);
    expect(v.bloqueos).toHaveLength(0);
    expect(v.totales?.iva).toBeGreaterThan(0);
  });

  it("cripto/P2P → EXENTA (41) listas, sin IVA (Of. 963/2018)", () => {
    const v = evaluarEmision(baseInput({ descripcion: "Compra USDT Binance P2P" }), empresaExenta);
    expect(v.tipoDte).toBe(41);
    expect(v.balde).toBe("listas");
    expect(v.totales?.iva).toBe(0);
  });

  it("sueldo / remuneración → BLOQUEADAS por no ser venta (Art. 2 DL 825)", () => {
    const v = evaluarEmision(baseInput({ descripcion: "Pago de sueldo mensual" }), empresaAfecta);
    expect(v.balde).toBe("bloqueadas");
    expect(v.puedeEmitir).toBe(false);
    expect(v.bloqueos.map((b) => b.code)).toContain("NO_BOLETAR");
    expect(v.tipoDte).toBeNull();
  });

  it("monto 0 → BLOQUEADAS (monto inválido)", () => {
    const v = evaluarEmision(baseInput({ total: 0 }), empresaAfecta);
    expect(v.balde).toBe("bloqueadas");
    expect(v.bloqueos.map((b) => b.code)).toContain("MONTO_TOTAL_INVALIDO");
  });

  it("afecta con IVA $0 → BLOQUEADAS (AFECTA_IVA_CERO, Art. 14 DL 825)", () => {
    const v = evaluarEmision(baseInput({ total: 1, tipoDtePersistido: 39 }), empresaAfecta);
    expect(v.balde).toBe("bloqueadas");
    expect(v.bloqueos.map((b) => b.code)).toContain("AFECTA_IVA_CERO");
  });

  it("sobre 135 UF sin receptor → BLOQUEADAS (Res. 44/2025)", () => {
    const v = evaluarEmision(baseInput({ total: 6_000_000, tipoDtePersistido: 41 }), empresaExenta);
    expect(v.balde).toBe("bloqueadas");
    expect(v.bloqueos.map((b) => b.code)).toContain("RECEPTOR_RUT_OBLIGATORIO");
  });

  it("ya emitida → BLOQUEADAS (YA_EMITIDA)", () => {
    const v = evaluarEmision(baseInput({ yaEmitida: true }), empresaAfecta);
    expect(v.balde).toBe("bloqueadas");
    expect(v.bloqueos.map((b) => b.code)).toContain("YA_EMITIDA");
  });

  it("transferencia pelada (baja confianza) → POR_REVISAR, no emitible", () => {
    const v = evaluarEmision(baseInput({ descripcion: "Transferencia recibida" }), empresaExenta);
    expect(v.confianzaTipo).toBeLessThan(0.8);
    expect(v.balde).toBe("por_revisar");
    expect(v.puedeEmitir).toBe(false);
    expect(v.advertencias.map((a) => a.code)).toContain("BAJA_CONFIANZA");
  });

  it("decisión humana desbloquea baja confianza → LISTAS", () => {
    const v = evaluarEmision(
      baseInput({ descripcion: "Transferencia recibida", tipoDtePersistido: 39 }),
      empresaAfecta,
    );
    expect(v.balde).toBe("listas");
    expect(v.puedeEmitir).toBe(true);
    expect(v.tipoDte).toBe(39);
  });

  it("estado pendiente (no aprobado) → BLOQUEADAS", () => {
    const v = evaluarEmision(baseInput({ estado: "pendiente" }), empresaAfecta);
    expect(v.balde).toBe("bloqueadas");
    expect(v.bloqueos.map((b) => b.code)).toContain("ESTADO_NO_APROBADO");
  });

  // Regresión: el bias de "empresa afecta" no debe ocultar una glosa vaga.
  it("transferencia pelada con empresa AFECTA → POR_REVISAR (el bias no tapa la duda)", () => {
    const v = evaluarEmision(baseInput({ descripcion: "Transferencia recibida" }), empresaAfecta);
    expect(v.balde).toBe("por_revisar");
    expect(v.puedeEmitir).toBe(false);
  });

  it("glosa vacía → BLOQUEADAS (DETALLE_VACIO, no fallback silencioso)", () => {
    const v = evaluarEmision(baseInput({ descripcion: "   " }), empresaAfecta);
    expect(v.balde).toBe("bloqueadas");
    expect(v.bloqueos.map((b) => b.code)).toContain("DETALLE_VACIO");
  });
});
