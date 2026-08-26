import { describe, expect, it } from "vitest";
import {
  buildFacturaJob,
  FACTURA_NOMBRE_PRODUCTO_MAX,
  facturaPortalStartUrl,
  type FacturaJobInput,
} from "./factura-job-payload";

const base = (): FacturaJobInput => ({
  empresaId: "emp-1",
  emisorRut: "78.448.088-7",
  tipoDte: 34,
  totalClp: 100_000,
  fechaEmision: "2026-08-26",
  formaPago: "contado",
  receptor: {
    rut: "77.155.156-4",
    razonSocial: "MV Inversiones SpA",
    giro: "Asesorías",
    direccion: "Mendoza 0932",
    comuna: "San Bernardo",
  },
  detalle: "Servicio de asesoría mensual",
  logoutAfter: true,
});

describe("buildFacturaJob", () => {
  it("34 exenta: el precio es el bruto y todo va exento", () => {
    const job = buildFacturaJob(base());
    expect(job.kind).toBe("factura");
    expect(job.tipo_dte).toBe(34);
    expect(job.detalles[0].precio).toBe(100_000);
    expect(job.totales).toEqual({ monto_total: 100_000, monto_neto: 0, iva: 0, monto_exento: 100_000 });
    expect(job.requires_cert_password).toBe(true);
    expect(job.start_url).toBe("https://www1.sii.cl/cgi-bin/Portal001/mipeLaunchPage.cgi?OPCION=34&TIPO=4");
    expect(job.auto_emit).toBe(true);
    expect(job.allow_final_emit).toBe(true);
  });

  it("33 afecta: el precio es el NETO derivado y los totales calzan con la misma matemática de la revisión", () => {
    const job = buildFacturaJob({ ...base(), tipoDte: 33, totalClp: 119_000 });
    expect(job.detalles[0].precio).toBe(100_000);
    expect(job.totales).toEqual({ monto_total: 119_000, monto_neto: 100_000, iva: 19_000, monto_exento: 0 });
  });

  it("33 con total no representable: los totales reflejan lo que el SII va a emitir (neto+iva), no el total pedido", () => {
    const job = buildFacturaJob({ ...base(), tipoDte: 33, totalClp: 100_001 });
    expect(job.totales.monto_total).toBe(job.totales.monto_neto + job.totales.iva);
  });

  it("recorta Nombre Producto a 40 y manda el detalle completo a Descrip.", () => {
    const largo = "Servicio integral de contabilidad y asesoría tributaria agosto 2026";
    const job = buildFacturaJob({ ...base(), detalle: largo });
    expect(job.detalles[0].nombre).toBe(largo.slice(0, FACTURA_NOMBRE_PRODUCTO_MAX));
    expect(job.detalles[0].descripcion).toBe(largo);
  });

  it("detalle corto: sin descripcion (no se abre el checkbox Descrip.)", () => {
    const job = buildFacturaJob(base());
    expect(job.detalles[0].descripcion).toBeUndefined();
  });

  it("tipo_compra fijo del_giro y receptor opcionales limpios", () => {
    const job = buildFacturaJob({ ...base(), receptor: { ...base().receptor, email: "  ", ciudad: "Santiago " } });
    expect(job.receptor.tipo_compra).toBe("del_giro");
    expect(job.receptor.email).toBeUndefined();
    expect(job.receptor.ciudad).toBe("Santiago");
  });

  it("ciudad ausente cae a la comuna (el portal la exige y el autocomplete no la llena)", () => {
    const job = buildFacturaJob(base());
    expect(job.receptor.ciudad).toBe("San Bernardo");
  });

  it("la start_url lleva el tipo DTE (33 y 34 entran por su propia OPCION)", () => {
    expect(facturaPortalStartUrl(33)).toContain("OPCION=33");
    expect(buildFacturaJob({ ...base(), tipoDte: 33, totalClp: 119_000 }).start_url).toContain("OPCION=33");
  });

  it("learn_only apaga auto_emit y allow_final_emit", () => {
    const job = buildFacturaJob({ ...base(), learnOnly: true });
    expect(job.learn_only).toBe(true);
    expect(job.auto_emit).toBe(false);
    expect(job.allow_final_emit).toBe(false);
  });

  it("fail-closed: sin forma de pago no hay job", () => {
    // @ts-expect-error — forma de pago inválida a propósito
    expect(() => buildFacturaJob({ ...base(), formaPago: "" })).toThrow("FACTURA_SIN_FORMA_PAGO");
  });

  it("fail-closed: sin emisor_rut no hay job (ni en learn)", () => {
    expect(() => buildFacturaJob({ ...base(), emisorRut: "  ", learnOnly: true })).toThrow("FACTURA_SIN_EMISOR_RUT");
  });

  it("fail-closed: receptor incompleto no sale", () => {
    expect(() => buildFacturaJob({ ...base(), receptor: { ...base().receptor, razonSocial: "" } }))
      .toThrow("FACTURA_RECEPTOR_SIN_RAZON_SOCIAL");
    expect(() => buildFacturaJob({ ...base(), receptor: { ...base().receptor, comuna: " " } }))
      .toThrow("FACTURA_RECEPTOR_SIN_COMUNA");
  });

  it("fail-closed: total inválido", () => {
    expect(() => buildFacturaJob({ ...base(), totalClp: 0 })).toThrow("FACTURA_TOTAL_INVALIDO");
    expect(() => buildFacturaJob({ ...base(), totalClp: Number.NaN })).toThrow("FACTURA_TOTAL_INVALIDO");
  });
});
