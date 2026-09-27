import { describe, expect, it } from "vitest";
import { enmascararCuenta, enmascararRut, iniciales, minimizarTexto } from "./minimizar";

describe("minimizar lo que el bot muestra en Telegram", () => {
  it("nombres a iniciales, sin conectores y conservando la forma jurídica", () => {
    expect(iniciales("Pedro Rojas Soto")).toBe("P. R. S.");
    expect(iniciales("María de los Ángeles Pérez")).toBe("M. Á. P.");
    expect(iniciales("PEDRO ROJAS E.I.R.L.")).toBe("P. R. E.I.R.L.");
    expect(iniciales("Comercial Andes SpA")).toBe("C. A. SpA");
    expect(iniciales("")).toBe("");
  });

  it("RUT y cuenta enmascarados pero reconocibles", () => {
    expect(enmascararRut("12.345.678-9")).toBe("••.•••.678-9");
    expect(enmascararRut("7.654.321-k")).toBe("••.•••.321-K");
    expect(enmascararCuenta("00-123-45678-09")).toBe("••••7809");
  });

  it("glosa: el nombre y el RUT del tercero no salen; monto y tipo sí", () => {
    const out = minimizarTexto("Transf. a PEDRO ROJAS 12.345.678-9 $80.000 pedro.rojas@gmail.com");
    expect(out).not.toMatch(/PEDRO|ROJAS|12\.345|pedro\.rojas/i);
    expect(out).toContain("P. R.");
    expect(out).toContain("$80.000");
    expect(out).toContain("(correo)");
  });

  it("no inventa nada en un texto sin personas", () => {
    expect(minimizarTexto("Pago Mercado Pago comisión")).toBe("Pago Mercado Pago comisión");
  });
});

describe("la dirección de la glosa sobrevive a la seudonimización", () => {
  it("'recibida de' no pierde el 'recibida' (señal de entrada para la IA)", () => {
    expect(minimizarTexto("Transferencia recibida de CAMILA TORRES")).toBe("Transferencia recibida de C. T.");
  });
});

describe("los mensajes reales del bot no llevan la identidad completa de terceros", async () => {
  const { mensajeLeiEsto, mensajeBoleta, mensajeMovimientoSinBoleta } = await import("./propuestas");

  it("'Comprobante leído': iniciales, RUT y cuenta enmascarados, sin correo", () => {
    const ocr = [
      "Transferencia realizada con éxito", "Monto $80.000", "Fecha 20/09/2026",
      "Datos del destinatario", "Nombre: Pedro Rojas Soto", "RUT: 12.345.678-9",
      "Cuenta: 00-123-45678-09", "Banco: Banco Estado",
      "Copia enviada a pedro.rojas@gmail.com",
    ].join("\n");
    const txt = mensajeLeiEsto(ocr);
    expect(txt).not.toMatch(/Pedro|Rojas|12\.345\.678|45678|pedro\.rojas/);
    expect(txt).toContain("P. R. S.");
    expect(txt).toContain("678-9");
    expect(txt).toContain("Banco Estado");
  });

  it("boleta: el cliente se reconoce por iniciales y final del RUT", () => {
    const { text } = mensajeBoleta({
      id: "p", documento_id: "d", tipo_propuesto: "boleta_exenta", total: 80000, monto_neto: null, iva: null,
      receptor_nombre: "Pedro Rojas", receptor_rut: "12.345.678-9", moneda_origen: null, monto_moneda_origen: null,
      confianza: 0.9, estado: "pendiente", descripcion: "Transferencia de Pedro Rojas", fecha: "2026-09-20",
    }, "exenta");
    expect(text).not.toMatch(/Pedro|Rojas|12\.345/);
    expect(text).toContain("P. R.");
    expect(text).toContain("678-9");
  });

  it("detalle del movimiento con iniciales", () => {
    const { text } = mensajeMovimientoSinBoleta({
      id: "m", monto: 80000, fecha: "2026-09-20", tipo_flujo: "salida", descripcion: "Transferencia a Pedro Rojas por $80.000",
    } as Parameters<typeof mensajeMovimientoSinBoleta>[0]);
    expect(text).not.toMatch(/Pedro|Rojas/);
    expect(text).toContain("P. R.");
  });
});
