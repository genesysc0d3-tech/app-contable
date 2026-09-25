import { describe, it, expect } from "vitest";
import { normalizarTipoPorEmisor, esVentaExentaEmisor, normalizarHonorariosPorEmisor, esRutPersonaNatural, esSociedadLimitada } from "./tipo-emisor";

describe("normalizarTipoPorEmisor", () => {
  it("empresa exenta: boleta afecta -> exenta genérica", () => {
    expect(normalizarTipoPorEmisor("boleta", { tipo_contribuyente: "exento" })).toBe("exenta");
  });

  it("empresa exenta: factura / factura_afecta -> factura_exenta", () => {
    expect(normalizarTipoPorEmisor("factura", { tipo_contribuyente: "exento" })).toBe("factura_exenta");
    expect(normalizarTipoPorEmisor("factura_afecta", { tipo_contribuyente: "exento" })).toBe("factura_exenta");
  });

  it("empresa afecta: NO cambia (default histórico afecto)", () => {
    expect(normalizarTipoPorEmisor("boleta", { tipo_contribuyente: "afecto" })).toBe("boleta");
    expect(normalizarTipoPorEmisor("factura", { tipo_contribuyente: "afecto" })).toBe("factura");
  });

  it("empresa null / auto / desconocida: NO cambia (fallback seguro)", () => {
    expect(normalizarTipoPorEmisor("boleta", null)).toBe("boleta");
    expect(normalizarTipoPorEmisor("boleta", null)).toBe("boleta");
    expect(normalizarTipoPorEmisor("boleta", { tipo_contribuyente: "auto" })).toBe("boleta");
  });

  it("empresa exenta: NO toca no-ventas ni tipos ya exentos", () => {
    expect(normalizarTipoPorEmisor("gasto_egreso", { tipo_contribuyente: "exento" })).toBe("gasto_egreso");
    expect(normalizarTipoPorEmisor("no_comercial", { tipo_contribuyente: "exento" })).toBe("no_comercial");
    expect(normalizarTipoPorEmisor("boleta_honorarios", { tipo_contribuyente: "exento" })).toBe("boleta_honorarios");
    expect(normalizarTipoPorEmisor("compraventa_crypto", { tipo_contribuyente: "exento" })).toBe("compraventa_crypto");
    expect(normalizarTipoPorEmisor("operacion_forex", { tipo_contribuyente: "exento" })).toBe("operacion_forex");
    expect(normalizarTipoPorEmisor("exenta", { tipo_contribuyente: "exento" })).toBe("exenta");
  });
});

describe("esVentaExentaEmisor", () => {
  it("true solo para venta afecta de un emisor exento (fuerza iva=0)", () => {
    expect(esVentaExentaEmisor("boleta", { tipo_contribuyente: "exento" })).toBe(true);
    expect(esVentaExentaEmisor("factura", { tipo_contribuyente: "exento" })).toBe(true);
    expect(esVentaExentaEmisor("factura_afecta", { tipo_contribuyente: "exento" })).toBe(true);
  });

  it("false para no-ventas, ya-exentos, o empresa no exenta", () => {
    expect(esVentaExentaEmisor("gasto_egreso", { tipo_contribuyente: "exento" })).toBe(false);
    expect(esVentaExentaEmisor("compraventa_crypto", { tipo_contribuyente: "exento" })).toBe(false);
    expect(esVentaExentaEmisor("boleta", { tipo_contribuyente: "afecto" })).toBe(false);
    expect(esVentaExentaEmisor("boleta", null)).toBe(false);
  });
});

/**
 * Defaults POR CARRIL (2026-09-04): la empresa mixta —boletas exentas por un
 * lado, facturas afectas por otro— ya no tiene que elegir una sola verdad.
 * Estos casos MUERDEN: si alguien vuelve a juzgar los dos mundos con
 * `tipo_contribuyente`, fallan.
 */
describe("defaults por carril", () => {
  const mixta = { tipo_contribuyente: "afecto", boletas_tipo_default: "exento", facturas_tipo_default: "afecto" };

  it("la boleta sigue su carril aunque el general diga afecto", () => {
    expect(normalizarTipoPorEmisor("boleta", mixta)).toBe("exenta");
    expect(esVentaExentaEmisor("boleta", mixta)).toBe(true);
  });

  it("la factura NO se contagia del carril de boletas", () => {
    expect(normalizarTipoPorEmisor("factura", mixta)).toBe("factura");
    expect(esVentaExentaEmisor("factura", mixta)).toBe(false);
  });

  it("y al revés: facturas exentas no vuelven exenta la boleta", () => {
    const alReves = { tipo_contribuyente: "afecto", boletas_tipo_default: "afecto", facturas_tipo_default: "exento" };
    expect(normalizarTipoPorEmisor("boleta", alReves)).toBe("boleta");
    expect(normalizarTipoPorEmisor("factura", alReves)).toBe("factura_exenta");
    expect(normalizarTipoPorEmisor("factura_afecta", alReves)).toBe("factura_exenta");
  });

  it("carril sin valor propio hereda el general (nada cambia para quien no lo tocó)", () => {
    const soloGeneral = { tipo_contribuyente: "exento", boletas_tipo_default: null, facturas_tipo_default: null };
    expect(normalizarTipoPorEmisor("boleta", soloGeneral)).toBe("exenta");
    expect(normalizarTipoPorEmisor("factura", soloGeneral)).toBe("factura_exenta");
  });
});

// 2026-09-25: "todo el drama era una regla mal implementada" — la regla global 91
// mandaba cualquier entrada con "asesoría/honorarios" a boleta_honorarios sin mirar
// si el contribuyente es persona natural. Una sociedad no emite BHE.
describe("normalizarHonorariosPorEmisor (BHE solo para personas naturales)", () => {
  const spaExenta = { rut: "77.155.156-4", tipo_contribuyente: "exento" };
  const spaAfecta = { rut: "77.002.244-4", tipo_contribuyente: "afecto" };
  const natural = { rut: "19.427.394-0", tipo_contribuyente: "exento" };
  it("persona natural: la BHE se queda como está", () => {
    expect(normalizarHonorariosPorEmisor("boleta_honorarios", natural, "PAGO ASESORIA PER_3", "regla_global")).toBe("boleta_honorarios");
  });
  it("sociedad: asesoría recibida es una VENTA → boleta (afecta base); la exenta la deja exenta el paso siguiente", () => {
    expect(normalizarHonorariosPorEmisor("boleta_honorarios", spaAfecta, "TRANSF ASESORIA TRIBUTARIA PER_3", "regla_global")).toBe("boleta");
    const base = normalizarHonorariosPorEmisor("boleta_honorarios", spaExenta, "TRANSF ASESORIA TRIBUTARIA PER_3", "regla_global");
    expect(base).toBe("boleta");
    expect(normalizarTipoPorEmisor(base, spaExenta)).toBe("exenta");
    expect(normalizarTipoPorEmisor(normalizarHonorariosPorEmisor("boleta_honorarios", spaAfecta, "x asesoria", null), spaAfecta)).toBe("boleta");
  });
  it("sociedad y la glosa dice FACTURA → pago de una factura ya emitida: no_comercial (no duplicar el débito)", () => {
    expect(normalizarHonorariosPorEmisor("boleta_honorarios", spaExenta, "PAGO FACTURA 221 ASESORIA PER_3", "regla_global")).toBe("no_comercial");
    expect(normalizarHonorariosPorEmisor("boleta_honorarios", spaAfecta, "Pago fact. 88 consultoria", "ia_opencode")).toBe("no_comercial");
  });
  it("regla de USUARIO (decisión humana) no se toca, ni sin RUT, ni otros tipos", () => {
    expect(normalizarHonorariosPorEmisor("boleta_honorarios", spaExenta, "asesoria", "regla_usuario")).toBe("boleta_honorarios");
    expect(normalizarHonorariosPorEmisor("boleta_honorarios", { tipo_contribuyente: "exento" }, "asesoria", "regla_global")).toBe("boleta_honorarios");
    expect(normalizarHonorariosPorEmisor("transferencia_p2p", spaExenta, "asesoria", "regla_global")).toBe("transferencia_p2p");
  });
  it("sociedad de profesionales (Ltda. en 2ª categoría, marcada por la empresa) → BHE se queda", () => {
    const ltdaProf = { rut: "76.111.222-3", tipo_contribuyente: "exento", sociedad_profesionales: true };
    expect(normalizarHonorariosPorEmisor("boleta_honorarios", ltdaProf, "PAGO ASESORIA PER_3", "regla_global")).toBe("boleta_honorarios");
    // Sin la marca, la misma Ltda. es una venta.
    expect(normalizarHonorariosPorEmisor("boleta_honorarios", { ...ltdaProf, sociedad_profesionales: false }, "PAGO ASESORIA PER_3", "regla_global")).toBe("boleta");
  });
  it("esSociedadLimitada: solo Ltda./Limitada muestran la pregunta", () => {
    expect(esSociedadLimitada("Estudio Contable Pérez Ltda.")).toBe(true);
    expect(esSociedadLimitada("ASESORIAS LEGALES LIMITADA")).toBe(true);
    expect(esSociedadLimitada("MV INVERSIONES SPA")).toBe(false);
    expect(esSociedadLimitada("Juan Pérez EIRL")).toBe(false);
    expect(esSociedadLimitada("")).toBe(false);
  });
  it("esRutPersonaNatural: bajo 50 millones = natural; sociedades desde 50 millones", () => {
    expect(esRutPersonaNatural("19427394-0")).toBe(true);
    expect(esRutPersonaNatural("18.662.087-9")).toBe(true);
    expect(esRutPersonaNatural("77.155.156-4")).toBe(false);
    expect(esRutPersonaNatural("50.000.000-7")).toBe(false);
    expect(esRutPersonaNatural("")).toBe(false);
    expect(esRutPersonaNatural(null)).toBe(false);
  });
});
