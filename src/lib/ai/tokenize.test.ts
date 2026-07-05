import { describe, it, expect } from "vitest";
import { createVault, tokenizeForAI, rehydrateReceptor } from "./tokenize";

const RUT_RE = /\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]/;

describe("tokenizeForAI — la identidad de persona se aparta, la señal sobrevive", () => {
  it("(a) conserva plataforma, activo y dirección; tapa nombre + RUT", () => {
    const v = createVault();
    const out = tokenizeForAI(
      "Transferencia recibida de Nataly Flores 12.345.678-9 por venta USDT en Binance, TÚ enviaste",
      v,
    );
    // señal intacta
    expect(out).toContain("USDT");
    expect(out).toContain("Binance");
    expect(out).toContain("TÚ enviaste");
    expect(out).toContain("por venta");
    // identidad tapada
    expect(out).toContain("PER_1");
  });

  it("(b) no queda ningún RUT ni el nombre en el texto que ve la IA", () => {
    const v = createVault();
    const out = tokenizeForAI("Pago a Diego Soto 9.876.543-2 por asesoría", v);
    expect(out).not.toMatch(RUT_RE);
    expect(out.toLowerCase()).not.toContain("diego");
    expect(out.toLowerCase()).not.toContain("soto");
  });

  it("(c) la misma persona → el mismo token; personas distintas → tokens distintos", () => {
    const v = createVault();
    const out = tokenizeForAI(
      "Abono de Nataly Flores 12.345.678-9 y reverso a Nataly Flores; aparte de Diego Soto 9.876.543-2",
      v,
    );
    // Nataly (con RUT y luego sin RUT) mapea al mismo token por nombre
    expect(out.match(/PER_1/g)?.length).toBe(2);
    // Diego es otra persona
    expect(out).toContain("PER_2");
    expect(v.seq.n).toBe(2);
  });

  it("(c bis) agrupa por RUT aunque el nombre venga distinto", () => {
    const v = createVault();
    const out = tokenizeForAI("de Juan Perez 11.111.111-1 y a Juan P Perez 11.111.111-1", v);
    expect(out.match(/PER_1/g)?.length).toBe(2);
    expect(out).not.toContain("PER_2");
  });

  it("(d) el re-pegado devuelve la identidad exacta desde la bóveda", () => {
    const v = createVault();
    tokenizeForAI("Venta a María González 7.654.321-0", v);
    const real = rehydrateReceptor({ receptor_nombre: "PER_1", receptor_rut: null }, v);
    expect(real.receptor_nombre).toBe("María González");
    expect(real.receptor_rut).toBe("7.654.321-0");
  });
});

describe("tokenizeForAI — bordes", () => {
  it("conserva nombres de plataforma multi-palabra (no son personas)", () => {
    const v = createVault();
    const out = tokenizeForAI("Compra a Mercado Pago por recarga", v);
    expect(out).toContain("Mercado Pago");
    expect(out).not.toContain("PER_");
    expect(v.seq.n).toBe(0);
  });

  it("tokeniza un RUT suelto sin nombre delante", () => {
    const v = createVault();
    const out = tokenizeForAI("Abono 11.222.333-4 sin glosa", v);
    expect(out).not.toMatch(RUT_RE);
    expect(out).toContain("PER_1");
    expect(v.toReal.get("PER_1")).toEqual({ rut: "11.222.333-4", nombre: null });
  });

  it("los números de cuenta largos se enmascaran a [NUM]", () => {
    const v = createVault();
    const out = tokenizeForAI("Transferencia cuenta 001234567890 a Pedro Ramírez", v);
    expect(out).toContain("[NUM]");
    expect(out).not.toContain("001234567890");
    expect(out).toContain("PER_1");
  });

  it("monto y fecha NUNCA se tocan", () => {
    const v = createVault();
    const out = tokenizeForAI("Venta $1.500.000 el 2026-04-16 a Ana Díaz 5.555.555-5", v);
    expect(out).toContain("$1.500.000");
    expect(out).toContain("2026-04-16");
  });
});

describe("rehydrateReceptor — nunca deja pasar un token literal", () => {
  it("token inventado por el modelo → null (aguas abajo se usa la glosa cruda)", () => {
    const v = createVault();
    const real = rehydrateReceptor({ receptor_nombre: "PER_99", receptor_rut: null }, v);
    expect(real.receptor_nombre).toBeNull();
    expect(real.receptor_rut).toBeNull();
  });

  it("un valor que no es token se deja igual (ruta consentida del usuario)", () => {
    const v = createVault();
    const real = rehydrateReceptor({ receptor_nombre: "Servicios SpA", receptor_rut: "76.000.000-0" }, v);
    expect(real.receptor_nombre).toBe("Servicios SpA");
    expect(real.receptor_rut).toBe("76.000.000-0");
  });
});
