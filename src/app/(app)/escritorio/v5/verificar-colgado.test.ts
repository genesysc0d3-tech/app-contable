import { describe, expect, it } from "vitest";
import { desenlaceDeMensaje } from "./verificar-colgado";

const base = { source: "app-contable-extension", job_id: "v1" };

describe("desenlaceDeMensaje — qué contestó la extensión a la verificación", () => {
  it("folio alto y guardado → emitida", () => {
    expect(desenlaceDeMensaje({ ...base, type: "APP_CONTABLE_SII_JOB_RESULT", result: { folio: "24531", folio_confidence: "high", persisted: { ok: true, boleta_id: "b1" } } }))
      .toEqual({ d: "emitida", folio: 24531, boletaId: "b1" });
  });
  it("folio sin guardar o sin evidencia → revisar (a medias)", () => {
    expect(desenlaceDeMensaje({ ...base, type: "APP_CONTABLE_SII_JOB_RESULT", result: { folio: 5, folio_confidence: "low", persisted: { ok: true } } })?.d).toBe("revisar");
    expect(desenlaceDeMensaje({ ...base, type: "APP_CONTABLE_SII_JOB_RESULT", result: { folio: 5, folio_confidence: "high", persisted: { ok: false } } })?.d).toBe("revisar");
  });
  it("solo 'tabla completa y no está' es no salió", () => {
    expect(desenlaceDeMensaje({ ...base, type: "APP_CONTABLE_SII_JOB_STATUS", status: "error", verificado_sin_folio: true })?.d).toBe("no_salio");
  });
  it("cerrar la ventana, error sin veredicto, needs_review, extensión recargada → revisar", () => {
    for (const status of ["error", "closed", "cancelled", "result_needs_review", "extension_recargada"]) {
      expect(desenlaceDeMensaje({ ...base, type: "APP_CONTABLE_SII_JOB_STATUS", status })?.d).toBe("revisar");
    }
  });
  it("subestado (capturando…) → no terminal", () => {
    expect(desenlaceDeMensaje({ ...base, type: "APP_CONTABLE_SII_JOB_STATUS", status: "capturing_result" })).toBeNull();
  });
});

describe("desenlaceDeMensaje — solo respaldo no es 'salió' (revisión final I1)", () => {
  it("persisted ok pero pendiente_verificacion_sesion → revisar", () => {
    const r = desenlaceDeMensaje({ type: "APP_CONTABLE_SII_JOB_RESULT", result: { folio: 24531, folio_confidence: "high", persisted: { ok: true, pendiente_verificacion_sesion: "MFA_REQUERIDO" } } } as never);
    expect(r?.d).toBe("revisar");
  });
});
