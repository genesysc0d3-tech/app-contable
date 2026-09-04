import { describe, expect, it } from "vitest";
import { derivarMontosFactura, esPlantillaFacturas, parsePlantillaFacturas, type FilaCruda } from "./plantilla";

const HEADER = ["RUT Receptor", "Detalle", "Valor Total", "Razón Social", "Giro", "Dirección", "Comuna", "Email"];

// RUTs sintéticos válidos (DV calculado): jamás datos reales en el repo.
const RUT_OK = "76.086.428-5";
const RUT_OK2 = "12345678-5";

describe("esPlantillaFacturas — detección del encabezado", () => {
  it("detecta el encabezado en la primera fila", () => {
    const det = esPlantillaFacturas([HEADER, [RUT_OK, "Servicio", 100000]]);
    expect(det).not.toBeNull();
    expect(det!.headerRow).toBe(0);
  });

  it("detecta el encabezado aunque haya filas de título antes", () => {
    const det = esPlantillaFacturas([["Mi empresa"], [""], HEADER]);
    expect(det!.headerRow).toBe(2);
  });

  it("una cartola bancaria NO es plantilla de facturas", () => {
    expect(esPlantillaFacturas([["Fecha", "Descripción", "Cargo", "Abono", "Saldo"]])).toBeNull();
  });

  it("la plantilla de BOLETAS (Fecha/Glosa/Monto) NO es plantilla de facturas", () => {
    expect(esPlantillaFacturas([["Fecha", "Glosa", "Monto"]])).toBeNull();
  });
});

describe("parsePlantillaFacturas — filas buenas siguen, filas malas se reportan", () => {
  const filas = (...data: FilaCruda[]) => [HEADER, ...data];

  it("parsea una fila completa con todos los opcionales", () => {
    const { facturas, errores } = parsePlantillaFacturas(filas(
      [RUT_OK, "Asesoría mensual", "1.971.031", "Empresa Ficticia SpA", "Servicios", "Calle Falsa 123", "Santiago", "pago@ficticia.cl"],
    ));
    expect(errores).toEqual([]);
    expect(facturas).toHaveLength(1);
    const f = facturas[0];
    expect(f.receptorRut).toBe("76.086.428-5");
    expect(f.totalClp).toBe(1_971_031);
    expect(f.receptorComuna).toBe("Santiago");
  });

  it("persona natural SIN GIRO entra igual, con aviso (no se bota)", () => {
    // Espec firmada de Matías: persona natural es facturable con giro manual —
    // advertir, nunca bloquear. Además el portal del SII autocompleta el giro al
    // digitar el RUT, y si no lo trae el worker lo pide (GIRO_RECEPTOR_REQUERIDO).
    const { facturas, errores } = parsePlantillaFacturas(filas(
      [RUT_OK2, "Clases particulares", 80000, "Juan Pérez", "", "Calle 1", "Santiago"],
    ));
    expect(errores).toEqual([]);
    expect(facturas).toHaveLength(1);
    expect(facturas[0].receptorGiro).toBe("");
    expect(facturas[0].advertencias[0]).toContain("Sin giro");
  });

  it("receptor incompleto NO pasa: la factura individualiza a su receptor", () => {
    // Decisión del fundador 2026-08-25: razón social, dirección y comuna son
    // obligatorios — sin ellos el documento no existe. El giro es la excepción
    // (ver el test de persona natural, arriba).
    const { facturas, errores } = parsePlantillaFacturas(filas([RUT_OK2, "Venta", 50000]));
    expect(facturas).toEqual([]);
    expect(errores[0].error).toContain("Faltan datos del receptor");
    expect(errores[0].error).toContain("Razón Social");
  });

  it("reporta EXACTAMENTE qué campo del receptor falta", () => {
    const { errores } = parsePlantillaFacturas(filas(
      [RUT_OK2, "Venta", 50000, "Empresa X SpA", "Servicios", "Calle 1", ""],
    ));
    expect(errores[0].error).toBe("Faltan datos del receptor: Comuna");
  });

  it("una fila mala NO mata el lote: se reporta con su número y las demás siguen", () => {
    const R = ["Empresa X SpA", "Servicios", "Calle 1", "Santiago"];
    const { facturas, errores } = parsePlantillaFacturas(filas(
      [RUT_OK, "Servicio A", 100000, ...R],
      ["11111111-9", "RUT con DV malo", 50000, ...R],
      [RUT_OK2, "", 70000, ...R],
      [RUT_OK2, "Sin monto", "no es plata", ...R],
      [RUT_OK2, "Servicio B", 200000, ...R],
    ));
    expect(facturas.map((f) => f.fila)).toEqual([2, 6]);
    expect(errores).toHaveLength(3);
    expect(errores[0]).toEqual({ fila: 3, error: "RUT inválido: 11111111-9" });
    expect(errores[1].error).toContain("detalle");
    expect(errores[2].error).toContain("inválido");
  });

  it("filas vacías y la fila de ejemplo de la plantilla se saltan sin error", () => {
    const R = ["Empresa X SpA", "Servicios", "Calle 1", "Santiago"];
    const { facturas, errores } = parsePlantillaFacturas(filas(
      ["", "", ""],
      ["Ej: 12.345.678-5", "Ejemplo de detalle", 100000, ...R],
      [RUT_OK, "Real", 100000, ...R],
    ));
    expect(errores).toEqual([]);
    expect(facturas).toHaveLength(1);
  });

  it("montos chilenos con puntos, con $ y numéricos dan lo mismo", () => {
    const R = ["Empresa X SpA", "Servicios", "Calle 1", "Santiago"];
    const { facturas } = parsePlantillaFacturas(filas(
      [RUT_OK, "A", "1.971.031", ...R],
      [RUT_OK, "B", "$1.971.031", ...R],
      [RUT_OK, "C", 1971031, ...R],
    ));
    expect(facturas.map((f) => f.totalClp)).toEqual([1_971_031, 1_971_031, 1_971_031]);
  });

  it("sin encabezado reconocible devuelve el error general", () => {
    const { errores } = parsePlantillaFacturas([["cualquier", "cosa"], [1, 2]]);
    expect(errores[0].fila).toBe(0);
  });
});

describe("derivarMontosFactura — la matemática del documento (criterio 4 + audio)", () => {
  it("emisor EXENTO → DTE 34, el total ES el total (bruto al portal)", () => {
    expect(derivarMontosFactura(1_971_031, true)).toEqual({
      tipoDte: 34, neto: 0, iva: 0, exento: 1_971_031, advertencia: null,
    });
  });

  it("emisor AFECTO → DTE 33, neto derivado del total (el portal recibe el neto)", () => {
    // 119.000 / 1,19 = 100.000 exacto → sin advertencia
    const m = derivarMontosFactura(119_000, false);
    expect(m).toEqual({ tipoDte: 33, neto: 100_000, iva: 19_000, exento: 0, advertencia: null });
  });

  it("total NO representable con IVA 19% → advertencia, jamás bloqueo", () => {
    const m = derivarMontosFactura(100_001, false);
    expect(m.neto + m.iva).not.toBe(100_001);
    expect(m.advertencia).toContain("no es representable");
  });

  it("neto + iva del derivado siempre cuadra consigo mismo (lo que el SII va a emitir)", () => {
    for (const total of [1000, 119_000, 100_001, 1_971_031, 24_314]) {
      const m = derivarMontosFactura(total, false);
      expect(m.iva).toBe(Math.round(m.neto * 0.19));
    }
  });
});
