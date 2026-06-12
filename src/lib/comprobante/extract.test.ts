import { describe, it, expect } from "vitest";
import { parseComprobanteTexto } from "./extract";

// Fecha fija para los casos donde el comprobante no trae año.
const HOY = new Date("2026-06-15T12:00:00Z");

describe("parseComprobanteTexto — comprobantes chilenos reales", () => {
  it("BancoEstado: monto con keyword, fecha dd/mm/yyyy, pagador 'De:' y glosa, ignorando N° de operación largo", () => {
    const texto = [
      "BancoEstado",
      "Comprobante de Transferencia",
      "Fecha: 13/06/2026 14:32",
      "Monto transferido: $45.000",
      "De: Juan Andrés Pérez Soto",
      "Cuenta origen: CuentaRUT ****1234",
      "N° de operación: 2026061312345678",
      "Comentario: Pago consulta médica",
    ].join("\n");

    const r = parseComprobanteTexto(texto, { hoy: HOY });
    expect(r.monto).toBe(45000);
    expect(r.confianza.monto).toBeGreaterThanOrEqual(0.9);
    expect(r.fecha).toBe("2026-06-13");
    expect(r.confianza.fecha).toBeGreaterThanOrEqual(0.85);
    expect(r.pagador).toBe("Juan Andrés Pérez Soto");
    expect(r.confianza.pagador).toBeGreaterThanOrEqual(0.85);
    expect(r.glosa).toBe("Pago consulta médica");
  });

  it("Santander: el RUT presente NO se confunde con el monto, ni la cuenta destino", () => {
    const texto = [
      "Banco Santander",
      "Comprobante transferencia de fondos",
      "Realizada el 02-01-2026 a las 16:05 hrs",
      "Desde: María José González Rojas",
      "RUT: 12.345.678-5",
      "Cuenta destino: 0-000-7654321-0",
      "Banco destino: Banco de Chile",
      "Monto: $ 1.250.000",
      "Estado: Exitosa",
    ].join("\n");

    const r = parseComprobanteTexto(texto, { hoy: HOY });
    expect(r.monto).toBe(1250000); // ni 12345678 (RUT) ni 7654321 (cuenta)
    expect(r.confianza.monto).toBeGreaterThanOrEqual(0.9);
    expect(r.fecha).toBe("2026-01-02");
    expect(r.confianza.fecha).toBeGreaterThanOrEqual(0.85); // "Realizada el" = keyword
    expect(r.pagador).toBe("María José González Rojas");
    expect(r.glosa).toBeNull();
  });

  it("Global66: 'CLP 89.990' como prefijo, fecha '13 jun 2026' y SIN confundir destinatario con pagador", () => {
    const texto = [
      "Global66",
      "¡Transferencia exitosa!",
      "Enviaste CLP 89.990 a Pedro Pablo Muñoz",
      "13 jun 2026 - 09:15",
      "Código de operación: G66-998877665544",
      "Mensaje: Asesoría contable junio",
    ].join("\n");

    const r = parseComprobanteTexto(texto, { hoy: HOY });
    expect(r.monto).toBe(89990);
    expect(r.confianza.monto).toBeGreaterThanOrEqual(0.9);
    expect(r.fecha).toBe("2026-06-13");
    expect(r.confianza.fecha).toBeGreaterThanOrEqual(0.7);
    // "Enviaste ... a Pedro" es el destinatario, no quien pagó.
    expect(r.pagador).toBeNull();
    expect(r.confianza.pagador).toBe(0);
    expect(r.glosa).toBe("Asesoría contable junio");
  });

  it("Mercado Pago: pagador inferido de 'transferencia de', fecha dd/mm/yy y operación de 11 dígitos ignorada", () => {
    const texto = [
      "Mercado Pago",
      "¡Listo! Recibiste una transferencia de Camila Fernanda Reyes",
      "Total: $ 25.500",
      "22/12/25 18:40 hs",
      "Número de operación: 91234567890",
    ].join("\n");

    const r = parseComprobanteTexto(texto, { hoy: HOY });
    expect(r.monto).toBe(25500);
    expect(r.confianza.monto).toBeGreaterThanOrEqual(0.9);
    expect(r.fecha).toBe("2025-12-22"); // año de 2 dígitos → 20yy
    expect(r.confianza.fecha).toBeLessThan(0.75); // sin keyword, año corto
    expect(r.pagador).toBe("Camila Fernanda Reyes");
    expect(r.confianza.pagador).toBeGreaterThanOrEqual(0.6); // inferido = media
    expect(r.confianza.pagador).toBeLessThan(0.9);
    expect(r.glosa).toBeNull();
  });

  it("Banco de Chile: monto con decimales ',00' y pagador tras 'Origen:'", () => {
    const texto = [
      "Banco de Chile",
      "Transferencia a terceros",
      "Fecha 05-03-2026",
      "Origen: Rodrigo Salas Vidal",
      "Monto transferido: $310.000,00",
    ].join("\n");

    const r = parseComprobanteTexto(texto, { hoy: HOY });
    expect(r.monto).toBe(310000);
    expect(r.confianza.monto).toBeGreaterThanOrEqual(0.9);
    expect(r.fecha).toBe("2026-03-05");
    expect(r.pagador).toBe("Rodrigo Salas Vidal");
    expect(r.confianza.pagador).toBeGreaterThanOrEqual(0.85);
    expect(r.glosa).toBeNull();
  });

  it("ambiguo: 'saldo disponible' no es transferencia → monto null o confianza baja", () => {
    const texto = [
      "foto borrosa del voucher",
      "saldo disponible 1.000.000",
      "gracias por su compra 999",
    ].join("\n");

    const r = parseComprobanteTexto(texto, { hoy: HOY });
    expect(r.monto === null || r.confianza.monto < 0.5).toBe(true);
    expect(r.fecha).toBeNull();
    expect(r.pagador).toBeNull();
    expect(r.glosa).toBeNull();
  });

  it("BCI: '99.990 CLP' como sufijo y fecha sin año ('24 de diciembre') usa el año actual con confianza media", () => {
    const texto = [
      "BCI Transferencias",
      "Pago recibido",
      "Total 99.990 CLP",
      "Transferencia realizada el 24 de diciembre",
      "De: Ana Soto Pérez",
    ].join("\n");

    const r = parseComprobanteTexto(texto, { hoy: HOY });
    expect(r.monto).toBe(99990);
    expect(r.confianza.monto).toBeGreaterThanOrEqual(0.9);
    expect(r.fecha).toBe("2026-12-24"); // año tomado de HOY (2026)
    expect(r.confianza.fecha).toBeGreaterThanOrEqual(0.5);
    expect(r.confianza.fecha).toBeLessThan(0.75); // año inferido = media
    expect(r.pagador).toBe("Ana Soto Pérez");
  });

  it("texto vacío o sin datos → todo null con confianza 0", () => {
    const r = parseComprobanteTexto("");
    expect(r).toEqual({
      monto: null,
      fecha: null,
      glosa: null,
      pagador: null,
      confianza: { monto: 0, fecha: 0, pagador: 0 },
    });
  });

  it("el monto repetido gana prominencia frente a otra cifra suelta", () => {
    const texto = [
      "Transferencia exitosa",
      "$78.500",
      "Detalle de la operación",
      "Monto transferido: $78.500",
      "Costo de la operación: $300",
    ].join("\n");

    const r = parseComprobanteTexto(texto, { hoy: HOY });
    expect(r.monto).toBe(78500); // repetido + keyword; el "costo" queda fuera
    expect(r.confianza.monto).toBeGreaterThanOrEqual(0.8);
  });

  it("nombres en MAYÚSCULAS (formato bancario) se aceptan y se corta en stopwords", () => {
    const texto = [
      "Nombre: JUAN PABLO ROJAS CUENTA CORRIENTE 123",
      "Monto: $15.000",
    ].join("\n");

    const r = parseComprobanteTexto(texto, { hoy: HOY });
    expect(r.pagador).toBe("JUAN PABLO ROJAS");
    expect(r.monto).toBe(15000);
  });
});
