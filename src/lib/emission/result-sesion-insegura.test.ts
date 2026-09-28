import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATUS_SESION_INSEGURA, elegirResultadoRecuperable, politicaResultSesionInsegura } from "./result-sesion-insegura";

describe("politicaResultSesionInsegura — sesión aal1 no escribe libros, el folio no se pierde", () => {
  it("captura del RPA → solo al stash del servidor", () => {
    expect(politicaResultSesionInsegura({ job_id: "j", result: { folio: 123, folio_confidence: "high" } } as never)).toBe("solo_stash");
  });
  it("recover_latest → bloquea (promover el stash ES escribir la boleta)", () => {
    expect(politicaResultSesionInsegura({ recover_latest: true })).toBe("bloquear");
  });
  it("formulario humano (folio visible, monto tecleado) → bloquea", () => {
    expect(politicaResultSesionInsegura({
      result: { folio: 9, folio_confidence: "high", folio_evidence: { source: "manual_visible_receipt" }, monto_total: 1000 },
    })).toBe("bloquear");
  });
  it("declaraciones humanas → bloquea (aunque traigan result)", () => {
    expect(politicaResultSesionInsegura({ registrar_folio_manual: 55 })).toBe("bloquear");
    expect(politicaResultSesionInsegura({ declarar_no_salio: true, result: {} })).toBe("bloquear");
  });
  it("body sin resultado → bloquea", () => {
    expect(politicaResultSesionInsegura({})).toBe("bloquear");
    expect(politicaResultSesionInsegura({ result: null })).toBe("bloquear");
  });
});

describe("elegirResultadoRecuperable — el stash de sesión insegura se puede promover, pero no gana", () => {
  const seguro = { status: "persisted", result: { folio: 1 } };
  const inseguro = { status: STATUS_SESION_INSEGURA, result: { folio: 2 } };
  it("solo hay fila de sesión insegura → se usa (tras el MFA el folio se rescata)", () => {
    expect(elegirResultadoRecuperable([inseguro])).toBe(inseguro);
  });
  it("una fila insegura MÁS NUEVA no le gana a la captura con sesión segura", () => {
    expect(elegirResultadoRecuperable([inseguro, seguro])).toBe(seguro);
  });
  it("sin filas con result → nada", () => {
    expect(elegirResultadoRecuperable([{ status: "x", result: null }])).toBeUndefined();
    expect(elegirResultadoRecuperable(null)).toBeUndefined();
  });
});

describe("la ruta /api/sii-local/result aplica la política", () => {
  const src = readFileSync("src/app/api/sii-local/result/route.ts", "utf8");
  const inicio = src.indexOf("if (!guard.ok) {");
  const rama = src.slice(inicio, src.indexOf("// Telemetría de flota", inicio));

  it("la rama de sesión insegura existe, decide con la política y solo toca el stash", () => {
    expect(inicio).toBeGreaterThan(0);
    expect(rama).toContain("politicaResultSesionInsegura(payload)");
    expect(rama).toContain("rememberResult(");
    expect(rama).toContain("STATUS_SESION_INSEGURA");
    expect(rama).not.toMatch(/boletas_emitidas|backfillFolioSinJobVivo|requireEmisionJob/);
  });

  it("si el stash falla NO responde ok (la extensión conserva su copia)", () => {
    expect(rama).toMatch(/if \(!guardado\)[\s\S]*status: 503/);
  });

  it("recover_latest no filtra por status y elige con elegirResultadoRecuperable", () => {
    const rec = src.slice(src.indexOf("if (payload.recover_latest) {"), src.indexOf("const pdfInfoCrudo"));
    expect(rec).not.toMatch(/\.eq\("status"/);
    expect(rec).toContain("elegirResultadoRecuperable(");
  });
});

describe("elegirResultadoRecuperable — sin job_id no cruza jobs (revisión final I2)", () => {
  it("la más reciente es insegura del job X y hay una segura vieja del job W → elige X, no W", () => {
    const filas = [
      { job_id: "X", status: STATUS_SESION_INSEGURA, result: { folio: 2 } },
      { job_id: "W", status: "persisted", result: { folio: 1 } },
    ];
    expect(elegirResultadoRecuperable(filas)?.job_id).toBe("X");
  });
  it("dentro del mismo job sigue prefiriendo la segura", () => {
    const filas = [
      { job_id: "X", status: STATUS_SESION_INSEGURA, result: { folio: 2 } },
      { job_id: "X", status: "persisted", result: { folio: 2 } },
    ];
    expect(elegirResultadoRecuperable(filas)?.status).toBe("persisted");
  });
  it("veredicto_verificacion con sesión insegura → bloquear", () => {
    expect(politicaResultSesionInsegura({ veredicto_verificacion: "no_salio" })).toBe("bloquear");
  });
});
