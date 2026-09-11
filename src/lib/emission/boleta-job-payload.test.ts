import { describe, it, expect } from "vitest";
import { buildBoletaJob } from "./boleta-job-payload";

const base = {
  empresaId: "emp-1",
  emisorRut: "77.002.244-4",
  fechaEmision: "2026-07-12",
  receptor: {},
  detalle: "Servicio",
  logoutAfter: false,
} as const;

describe("buildBoletaJob — totales por tipo", () => {
  it("exenta (41): todo exento, neto/iva en 0", () => {
    const j = buildBoletaJob({ ...base, tipoDte: 41, monto: 100000 });
    expect(j.totales).toEqual({ monto_total: 100000, monto_neto: 0, iva: 0, monto_exento: 100000 });
    expect(j.tipo_dte).toBe(41);
  });

  it("afecta (39): desarma el IVA del total bruto", () => {
    const j = buildBoletaJob({ ...base, tipoDte: 39, monto: 11900 });
    // neto = round(11900/1.19)=10000; iva = 11900-10000 = 1900; exento 0
    expect(j.totales).toEqual({ monto_total: 11900, monto_neto: 10000, iva: 1900, monto_exento: 0 });
  });

  it("redondea el monto a entero", () => {
    const j = buildBoletaJob({ ...base, tipoDte: 41, monto: 999.7 });
    expect(j.totales.monto_total).toBe(1000);
  });
});

describe("buildBoletaJob — contrato de la extensión", () => {
  it("flags fijos correctos + logout_after inyectado", () => {
    const j = buildBoletaJob({ ...base, tipoDte: 41, monto: 5000, logoutAfter: true });
    expect(j.learn_only).toBe(false);
    expect(j.auto_emit).toBe(true);
    expect(j.allow_final_emit).toBe(true);
    expect(j.confirmation_required).toBe(false);
    expect(j.logout_after).toBe(true);
  });

  it("glosa se recorta a 80 y va también en detalles[0].nombre", () => {
    const larga = "x".repeat(120);
    const j = buildBoletaJob({ ...base, tipoDte: 41, monto: 5000, detalle: larga });
    expect(j.glosa.length).toBe(80);
    expect(j.detalles[0].nombre).toBe(j.glosa);
    expect(j.detalles[0].monto_total).toBe(5000);
  });

  it("campos vacíos del receptor se omiten (no van como cadena vacía)", () => {
    const j = buildBoletaJob({ ...base, tipoDte: 41, monto: 5000, receptor: { rut: "  ", razonSocial: "Osvaldo", direccion: "" } });
    expect(j.receptor.rut).toBeUndefined();
    expect(j.receptor.direccion).toBeUndefined();
    expect(j.receptor.razon_social).toBe("Osvaldo");
  });

  it("medio de pago vacío se omite; presente se limpia", () => {
    expect(buildBoletaJob({ ...base, tipoDte: 41, monto: 5000, medioPago: "  " }).payment_method).toBeUndefined();
    expect(buildBoletaJob({ ...base, tipoDte: 41, monto: 5000, medioPago: " Efectivo " }).payment_method).toBe("Efectivo");
  });

  it("job_id / expires_at solo aparecen si se pasan", () => {
    const sin = buildBoletaJob({ ...base, tipoDte: 41, monto: 5000 });
    expect("job_id" in sin).toBe(false);
    const con = buildBoletaJob({ ...base, tipoDte: 41, monto: 5000, jobId: "j1", expiresAt: "2026-07-12T12:00:00Z" });
    expect(con.job_id).toBe("j1");
    expect(con.expires_at).toBe("2026-07-12T12:00:00Z");
  });
});

describe("buildBoletaJob — libreto (tanda 1, 2026-09-10)", () => {
  it("el job lleva el libreto de producción con los bloques nuevos (glosa/modal/emisor/monto_alto)", () => {
    const j = buildBoletaJob({ ...base, tipoDte: 39, monto: 1000 });
    expect(j.libreto.libreto_version).toBe(1);
    expect(j.libreto.portal).toBe("eboleta_vuetify");
    expect(j.libreto.glosa.ancla_contador).toBe("\\/\\s*80");
    expect(j.libreto.glosa.ancla_label).toBe("DETALLE");
    expect(j.libreto.modal.titulo).toBe("EMITIR\\s+E-BOLETA");
    expect(j.libreto.emisor.cargando).toBe("CARGANDO EMISORES|CARGANDO"); // F6: superconjunto worker+background
    expect(j.libreto.monto_alto.texto).toBe("DESEA CONTINUAR|ESTA A PUNTO DE EMITIR");
    // Las claves que la flota vieja EXIGE siguen ahí.
    for (const k of ["selectores", "botones", "slots", "toggles", "receptor_campos", "esperas"]) {
      expect(j.libreto).toHaveProperty(k);
    }
  });

  it("la glosa se recorta a 80 y se usa también como nombre del detalle", () => {
    const larga = "x".repeat(120);
    const j = buildBoletaJob({ ...base, tipoDte: 41, monto: 1000, detalle: `  ${larga}  ` });
    expect(j.glosa).toHaveLength(80);
    expect(j.detalles[0].nombre).toBe(j.glosa);
  });

  it("boleta única: misma semántica que el armado a mano de antes (logout, emisor, job_id, expires_at)", () => {
    const j = buildBoletaJob({
      ...base, tipoDte: 39, monto: 11900, logoutAfter: true, jobId: "job-1", expiresAt: "2026-09-10T20:00:00Z",
      receptor: { rut: " 12.345.678-5 ", razonSocial: "", direccion: undefined, comuna: null, email: "a@b.cl", telefono: "  " },
      medioPago: "Efectivo",
    });
    expect(j.logout_after).toBe(true);
    expect(j.emisor_rut).toBe("77.002.244-4");
    expect(j.job_id).toBe("job-1");
    expect(j.expires_at).toBe("2026-09-10T20:00:00Z");
    expect(j.payment_method).toBe("Efectivo");
    // Vacíos → undefined (igual que `x.trim() || undefined` del armado a mano).
    expect(j.receptor).toEqual({ rut: "12.345.678-5", email: "a@b.cl" });
    expect(j.allow_final_emit).toBe(true); // la perilla de ensayo lo apaga DESPUÉS, en la vista
  });
});
