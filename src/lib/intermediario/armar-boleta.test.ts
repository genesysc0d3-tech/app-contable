import { describe, it, expect } from "vitest";
import { resolverGlosa, armarBoletaPayload, GLOSA_FALLBACK } from "./armar-boleta";

describe("resolverGlosa — precedencia editado › común › banco", () => {
  it("el detalle editado (notas) manda sobre todo", () => {
    expect(resolverGlosa({
      notas: "Venta de USDT vía P2P",
      glosaComun: "Venta de criptomonedas",
      glosaComunActiva: true,
      glosaBanco: "Transf. de Fulano",
    })).toBe("Venta de USDT vía P2P");
  });

  it("sin notas, usa la glosa común SOLO si está activa", () => {
    expect(resolverGlosa({ glosaComun: "Venta de criptomonedas", glosaComunActiva: true, glosaBanco: "Transf. de Fulano" }))
      .toBe("Venta de criptomonedas");
    // glosa común presente pero desactivada → cae al banco
    expect(resolverGlosa({ glosaComun: "Venta de criptomonedas", glosaComunActiva: false, glosaBanco: "Transf. de Fulano" }))
      .toBe("Transf. de Fulano");
  });

  it("sin notas ni común activa, usa la glosa del banco", () => {
    expect(resolverGlosa({ glosaBanco: "Transf. de Fulano" })).toBe("Transf. de Fulano");
  });

  it("todo vacío → fallback, nunca glosa vacía", () => {
    expect(resolverGlosa({})).toBe(GLOSA_FALLBACK);
    expect(resolverGlosa({ notas: "   ", glosaComun: "  ", glosaComunActiva: true, glosaBanco: "" })).toBe(GLOSA_FALLBACK);
  });

  it("recorta a 80 caracteres (campo Detalle del SII)", () => {
    const larga = "x".repeat(200);
    expect(resolverGlosa({ notas: larga })).toHaveLength(80);
    expect(resolverGlosa({ glosaBanco: larga })).toHaveLength(80);
  });
});

describe("armarBoletaPayload — BoletaInput canónico", () => {
  const base = { tipoDte: 41 as const, total: 1_000_000 };

  it("arma detalles con la glosa resuelta y el monto redondeado", () => {
    const p = armarBoletaPayload({ ...base, total: 1_000_000.4, notas: "Venta USDT", glosaBanco: "Transf" });
    expect(p.detalles).toEqual([{ nombre: "Venta USDT", monto: 1_000_000 }]);
    expect(p.monto_total).toBe(1_000_000);
    expect(p.tipo_dte).toBe(41);
  });

  it("receptor: usa lo provisto, o undefined si viene vacío", () => {
    const con = armarBoletaPayload({ ...base, receptorRut: "17.234.567-0", receptorNombre: "Diego Fuentes" });
    expect(con.receptor_rut).toBe("17.234.567-0");
    expect(con.receptor_razon_social).toBe("Diego Fuentes");
    const sin = armarBoletaPayload({ ...base, receptorRut: "  ", receptorNombre: "" });
    expect(sin.receptor_rut).toBeUndefined();
    expect(sin.receptor_razon_social).toBeUndefined();
  });

  it("medio de pago: el de la propuesta manda sobre el default del carril", () => {
    expect(armarBoletaPayload({ ...base, medioPago: "Efectivo" }, { medioPagoDefault: "Transferencia Electrónica" }).medio_pago)
      .toBe("Efectivo");
    // sin medio en la propuesta → default del carril
    expect(armarBoletaPayload({ ...base }, { medioPagoDefault: "Transferencia Electrónica" }).medio_pago)
      .toBe("Transferencia Electrónica");
    // sin nada → undefined (validarBoleta decide si lo exige por monto)
    expect(armarBoletaPayload({ ...base }).medio_pago).toBeUndefined();
  });

  it("comportamiento histórico preservado: sin notas ni común, glosa = banco", () => {
    const p = armarBoletaPayload({ ...base, glosaBanco: "Transf. Juan Ignacio Manzor Miranda" }, { medioPagoDefault: "Transferencia Electrónica" });
    expect(p.detalles[0]!.nombre).toBe("Transf. Juan Ignacio Manzor Miranda");
  });
});
