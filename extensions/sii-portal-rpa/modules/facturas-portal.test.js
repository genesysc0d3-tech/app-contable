import { describe, it, expect } from "vitest";
import { FACT_AUTO_EMIT_READY, FACT_CAPABILITIES, validateSiiFacturaJob } from "./facturas-portal.js";

const START_URL = "https://www1.sii.cl/cgi-bin/Portal001/mipeSelEmpresa.cgi";
const EMISOR = "78.448.088-7"; // DV válido (módulo 11)
const RECEPTOR = "77.155.156-4";

const jobBase = () => ({
  kind: "factura",
  job_id: "job-1",
  empresa_id: "emp-1",
  emisor_rut: EMISOR,
  tipo_dte: 34,
  fecha_emision: "2026-08-26",
  forma_pago: "contado",
  receptor: { rut: RECEPTOR, razon_social: "MV SpA", direccion: "Mendoza 0932", comuna: "San Bernardo", tipo_compra: "del_giro" },
  detalles: [{ nombre: "Servicio de asesoría", cantidad: 1, precio: 100000 }],
  totales: { monto_total: 100000, monto_neto: 0, iva: 0, monto_exento: 100000 },
  requires_cert_password: true,
  start_url: START_URL,
  learn_only: false,
  auto_emit: true,
  allow_final_emit: true,
  logout_after: true,
  expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
});

describe("validateSiiFacturaJob — fail-closed en el portal de facturas", () => {
  it("job completo válido pasa", () => {
    expect(validateSiiFacturaJob(jobBase())).toBe(null);
  });

  it("kind ausente o distinto de factura se rechaza (un job de boleta no entra acá)", () => {
    expect(validateSiiFacturaJob({ ...jobBase(), kind: undefined })).toBe("JOB_KIND_INVALID");
    expect(validateSiiFacturaJob({ ...jobBase(), kind: "boleta" })).toBe("JOB_KIND_INVALID");
  });

  it("tipo_dte solo 33/34", () => {
    expect(validateSiiFacturaJob({ ...jobBase(), tipo_dte: 39 })).toBe("TIPO_DTE_INVALID");
    expect(validateSiiFacturaJob({ ...jobBase(), tipo_dte: 33 })).toBe(null);
  });

  it("emisor_rut inválido se rechaza TAMBIÉN en learn_only", () => {
    const learn = { ...jobBase(), learn_only: true, auto_emit: false, emisor_rut: "12.345.678-0" };
    expect(validateSiiFacturaJob(learn)).toBe("EMISOR_RUT_INVALID");
    expect(validateSiiFacturaJob({ ...learn, emisor_rut: EMISOR })).toBe(null);
  });

  it("start_url solo puede apuntar a sii.cl por https", () => {
    expect(validateSiiFacturaJob({ ...jobBase(), start_url: "https://evil.example.com/sii" })).toBe("START_URL_INVALID");
    expect(validateSiiFacturaJob({ ...jobBase(), start_url: "http://www1.sii.cl/x" })).toBe("START_URL_INVALID");
    expect(validateSiiFacturaJob({ ...jobBase(), start_url: "https://falso-sii.cl.evil.com/" })).toBe("START_URL_INVALID");
  });

  it("auto_emit exige forma de pago explícita (espec Matías: sin default)", () => {
    expect(validateSiiFacturaJob({ ...jobBase(), forma_pago: undefined })).toBe("FORMA_PAGO_INVALID");
    expect(validateSiiFacturaJob({ ...jobBase(), forma_pago: "efectivo" })).toBe("FORMA_PAGO_INVALID");
    expect(validateSiiFacturaJob({ ...jobBase(), forma_pago: "credito" })).toBe(null);
  });

  it("auto_emit exige receptor con RUT válido, total y detalle con precio", () => {
    expect(validateSiiFacturaJob({ ...jobBase(), receptor: undefined })).toBe("RECEPTOR_MISSING");
    expect(validateSiiFacturaJob({ ...jobBase(), receptor: { rut: "1-1" } })).toBe("RECEPTOR_RUT_INVALID");
    expect(validateSiiFacturaJob({ ...jobBase(), totales: { monto_total: 0 } })).toBe("MONTO_TOTAL_INVALID");
    expect(validateSiiFacturaJob({ ...jobBase(), detalles: [] })).toBe("DETALLE_MISSING");
    expect(validateSiiFacturaJob({ ...jobBase(), detalles: [{ nombre: "x", precio: 0 }] })).toBe("PRECIO_INVALID");
  });

  it("job vencido no abre ventana", () => {
    expect(validateSiiFacturaJob({ ...jobBase(), expires_at: new Date(Date.now() - 1000).toISOString() })).toBe("JOB_EXPIRED");
  });

  it("learn_only NO exige receptor ni forma de pago (solo navega y mapea)", () => {
    const learn = { ...jobBase(), learn_only: true, auto_emit: false, receptor: undefined, forma_pago: undefined, detalles: undefined, totales: undefined };
    expect(validateSiiFacturaJob(learn)).toBe(null);
  });
});

describe("compuerta de fase", () => {
  it("las capabilities del carril existen pero auto_emit está cerrado hasta la fase 3", () => {
    expect(FACT_CAPABILITIES).toEqual(["sii_portal_factura_33", "sii_portal_factura_34"]);
    expect(FACT_AUTO_EMIT_READY).toBe(false);
  });
});
