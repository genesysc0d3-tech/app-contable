import { describe, it, expect } from "vitest";
import { FACT_AUTO_EMIT_READY, FACT_CAPABILITIES, validateSiiFacturaJob, validateLibreto } from "./facturas-portal.js";
import { FACTURA_LIBRETO } from "../../../src/lib/emission/sii-libreto.ts";

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
  it("las capabilities del carril existen y auto_emit quedó abierto (fase 3 construida)", () => {
    expect(FACT_CAPABILITIES).toEqual(["sii_portal_factura_33", "sii_portal_factura_34"]);
    expect(FACT_AUTO_EMIT_READY).toBe(true);
  });
});

describe("splitRutCuerpoDv (las dos cajas del portal)", () => {
  it("acepta puntos, guion y K minúscula", async () => {
    const { splitRutCuerpoDv } = await import("./facturas-portal.js");
    expect(splitRutCuerpoDv("78.448.088-7")).toEqual({ cuerpo: "78448088", dv: "7" });
    expect(splitRutCuerpoDv("78029972-k")).toEqual({ cuerpo: "78029972", dv: "K" });
    expect(splitRutCuerpoDv("78448088-7")).toEqual({ cuerpo: "78448088", dv: "7" });
  });
  it("basura → null (el worker aborta, no adivina)", async () => {
    const { splitRutCuerpoDv } = await import("./facturas-portal.js");
    expect(splitRutCuerpoDv("")).toBe(null);
    expect(splitRutCuerpoDv("sin-rut")).toBe(null);
    expect(splitRutCuerpoDv("123456789012-3")).toBe(null);
  });
});

describe("extractFolioFromText (evidencia fuerte post-Firmar)", () => {
  it("matchea las formas reales de folio", async () => {
    const { extractFolioFromText } = await import("./facturas-portal.js");
    expect(extractFolioFromText("Se ha generado el documento Folio N° 635").folio).toBe(635);
    expect(extractFolioFromText("FOLIO: 1234")).toMatchObject({ folio: 1234 });
    expect(extractFolioFromText("folio nro. 88 emitido").folio).toBe(88);
  });
  it("sin la palabra folio NO hay match (nunca un número suelto)", async () => {
    const { extractFolioFromText } = await import("./facturas-portal.js");
    expect(extractFolioFromText("documento 635 generado por $100.000")).toBe(null);
    expect(extractFolioFromText("")).toBe(null);
  });
});

describe("validateLibreto — fail-closed del catálogo de nombres del portal", () => {
  const clon = () => JSON.parse(JSON.stringify(FACTURA_LIBRETO));

  it("ausente = válido (el worker usa su fallback hardcodeado, byte-idéntico)", () => {
    expect(validateLibreto(undefined)).toBe(null);
    expect(validateLibreto(null)).toBe(null);
  });
  it("el libreto real de producción pasa", () => {
    expect(validateLibreto(FACTURA_LIBRETO)).toBe(null);
  });
  it("no-objeto se rechaza", () => {
    expect(validateLibreto("PreViewDTE")).toBe("LIBRETO_INVALID");
  });
  it("schema_version desconocido se rechaza (compat: extensión vieja no adivina)", () => {
    expect(validateLibreto({ ...clon(), libreto_version: 99 })).toBe("LIBRETO_SCHEMA_UNKNOWN");
  });
  it("portal ajeno se rechaza", () => {
    expect(validateLibreto({ ...clon(), portal: "otro_portal" })).toBe("LIBRETO_PORTAL_INVALID");
  });
  it("falta un form ancla se rechaza", () => {
    const l = clon(); l.forms.preview = "";
    expect(validateLibreto(l)).toBe("LIBRETO_FORM_MISSING");
  });
  it("falta un detector de página se rechaza", () => {
    const l = clon(); delete l.detectores.firma;
    expect(validateLibreto(l)).toBe("LIBRETO_DETECTOR_MISSING");
  });
  it("falta un campo obligatorio se rechaza", () => {
    const l = clon(); delete l.campos.rut_recep;
    expect(validateLibreto(l)).toBe("LIBRETO_CAMPO_MISSING");
  });
  it("un campo fuera del vocabulario cerrado se rechaza (no puede apuntar a un selector arbitrario)", () => {
    const l = clon(); l.campos.rut_recep = "password";
    expect(validateLibreto(l)).toBe("LIBRETO_CAMPO_NO_PERMITIDO");
  });
  it("falta un código de forma de pago se rechaza", () => {
    const l = clon(); delete l.codigos.forma_pago.credito;
    expect(validateLibreto(l)).toBe("LIBRETO_CODIGO_MISSING");
  });
});
