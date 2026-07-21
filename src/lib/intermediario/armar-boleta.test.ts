import { describe, it, expect } from "vitest";
import { resolverGlosa, armarBoletaPayload, GLOSA_FALLBACK, GLOSA_FALLBACK_EXENTA } from "./armar-boleta";

describe("resolverGlosa — precedencia editado › común › genérico (NUNCA banco)", () => {
  it("el detalle editado (notas) manda sobre todo", () => {
    expect(resolverGlosa({
      notas: "Venta de USDT vía P2P",
      glosaComun: "Venta de criptomonedas",
      glosaComunActiva: true,
    }, 41)).toBe("Venta de USDT vía P2P");
  });

  it("sin notas, usa la glosa común SOLO si está activa", () => {
    expect(resolverGlosa({ glosaComun: "Venta de criptomonedas", glosaComunActiva: true }, 41))
      .toBe("Venta de criptomonedas");
    // común presente pero DESACTIVADA → genérico por tipo (nunca el banco)
    expect(resolverGlosa({ glosaComun: "Venta de criptomonedas", glosaComunActiva: false }, 41))
      .toBe(GLOSA_FALLBACK_EXENTA);
  });

  it("sin notas ni común activa → genérico por tipo (41 exenta, 39 afecta)", () => {
    expect(resolverGlosa({}, 41)).toBe(GLOSA_FALLBACK_EXENTA);
    expect(resolverGlosa({}, 39)).toBe(GLOSA_FALLBACK);
    expect(resolverGlosa({})).toBe(GLOSA_FALLBACK); // sin tipo → neutro
  });

  it("todo vacío/espacios → genérico, nunca glosa vacía", () => {
    expect(resolverGlosa({ notas: "   ", glosaComun: "  ", glosaComunActiva: true }, 39)).toBe(GLOSA_FALLBACK);
  });

  it("recorta a 80 caracteres (campo Detalle del SII)", () => {
    expect(resolverGlosa({ notas: "x".repeat(200) })).toHaveLength(80);
  });
});

describe("PROTECCIÓN DE DATOS: la glosa NUNCA expone datos de terceros", () => {
  it("la descripción cruda del banco (nombre/RUT de quien pagó) no puede llegar a la boleta", () => {
    // Antes existía un fallback a la glosa del banco. Se eliminó: la única forma de
    // describir es `notas` (que el usuario escribe) o la glosa común (que el usuario
    // fija). Sin ninguna, sale un genérico — jamás "TRANSFERENCIA DE JUAN PEREZ ...".
    const nombre = armarBoletaPayload({ tipoDte: 41, total: 1_000_000 }).detalles[0]!.nombre;
    expect(nombre).toBe(GLOSA_FALLBACK_EXENTA);
    expect(nombre).not.toMatch(/\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]/); // sin RUT de tercero
    expect(nombre.toUpperCase()).not.toContain("TRANSFER");
  });
});

describe("armarBoletaPayload — BoletaInput canónico", () => {
  const base = { tipoDte: 41 as const, total: 1_000_000 };

  it("arma detalles con la glosa resuelta y el monto redondeado", () => {
    const p = armarBoletaPayload({ ...base, total: 1_000_000.4, notas: "Venta USDT" });
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
    expect(armarBoletaPayload({ ...base }, { medioPagoDefault: "Transferencia Electrónica" }).medio_pago)
      .toBe("Transferencia Electrónica");
    expect(armarBoletaPayload({ ...base }).medio_pago).toBeUndefined();
  });

  it("genérico por tipo: 41 → exenta, 39 → servicio", () => {
    expect(armarBoletaPayload({ tipoDte: 41, total: 100 }).detalles[0]!.nombre).toBe(GLOSA_FALLBACK_EXENTA);
    expect(armarBoletaPayload({ tipoDte: 39, total: 100 }).detalles[0]!.nombre).toBe(GLOSA_FALLBACK);
  });
});
