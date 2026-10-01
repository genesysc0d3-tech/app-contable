/**
 * Boleta única — cableado de seguridad (2026-09-30). La decisión vive en
 * lib/emission/boleta-unica-lapida.ts (tests de comportamiento allá); la vista es un
 * componente de 2000 líneas sin arnés de React, así que acá se fija que lo USE:
 *  - punto 1: `emision_incierta` / `result_needs_review` → lápida, nunca `failed`
 *    (antes: EmitirDirectaView cerraba `failed` todo `error`, ~l.871-876).
 *  - punto 1: el 409 BOLETA_A_MEDIAS del server abre el panel de la lápida (no un toast suelto).
 *  - punto 3/5: el 409 LEASE_PERDIDO del latido detiene la ventana del SII de ESTE
 *    computador y lo explica.
 *  - "Cancelar y emitir de nuevo" sobre una lápida no la borra: muestra la lápida.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "EmitirDirectaView.tsx"), "utf8");

describe("EmitirDirectaView — seguridad de la boleta única", () => {
  it("el aviso de estado de la extensión se decide con cierreBoletaUnicaPorStatus (incierta → lápida)", () => {
    expect(src).toContain('from "@/lib/emission/boleta-unica-lapida"');
    const handler = src.indexOf('if (data.type !== "APP_CONTABLE_SII_JOB_STATUS") return;');
    const usa = src.indexOf("cierreBoletaUnicaPorStatus(data)", handler);
    expect(usa).toBeGreaterThan(handler);
    // Ya no existe el cierre ciego: error → failed sin mirar emision_incierta.
    expect(src).not.toContain('data.status === "cancelled" ? "cancelled" : "failed"');
    expect(src.slice(usa, usa + 2500)).toContain("closeEmissionJobEvent(data.job_id, cierre.cerrar)");
  });

  it("409 BOLETA_A_MEDIAS al pedir el job → panel de la lápida con su job_id", () => {
    const start = src.indexOf("async function startEmissionJob(");
    const cuerpo = src.slice(start, start + 3000);
    expect(cuerpo).toContain('json.error === "BOLETA_A_MEDIAS"');
    // Desde la revisión adversarial abre el panel «Boleta a medias» (mostrarLapida → result_needs_review).
    expect(cuerpo).toContain("mostrarLapida(");
    expect(src).toContain('setLocalWorker({ jobId: l.jobId, status: "result_needs_review"');
  });

  it("409 LEASE_PERDIDO en el latido → cierra la ventana SII de este computador y lo dice", () => {
    const hb = src.indexOf("async function heartbeatEmissionJob(");
    const cuerpo = src.slice(hb, hb + 4500);
    expect(cuerpo).toContain('"LEASE_PERDIDO"');
    expect(cuerpo).toContain("APP_CONTABLE_SII_JOB_CLOSE");
    expect(cuerpo).toContain('status: "lease_perdido"');
  });

  it("la lápida ofrece la salida humana «no salió» (declararNoSalio) en vez de cancelar a ciegas", () => {
    expect(src).toContain("declararNoSalio(");
    expect(src).toContain("Revisé el SII y no salió");
  });

  it("cancelStaleLock sobre una lápida no la suelta: muestra el panel", () => {
    const fn = src.indexOf("async function cancelStaleLock(");
    const cuerpo = src.slice(fn, fn + 1200);
    expect(cuerpo).toContain('=== "revision_pendiente"');
  });
});

// ── Revisión adversarial del fix (2026-09-30) ──
describe("EmitirDirectaView — cierres de la revisión adversarial", () => {
  it("A1: al quedar a medias se CIERRA la ventana del SII (sin «Reintentar» vivo), igual que el lote", () => {
    const i = src.indexOf('if (cierre.cerrar === "revision_pendiente"');
    const fin = src.indexOf("return;", i);
    expect(src.slice(i, fin)).toContain("APP_CONTABLE_SII_JOB_CLOSE");
  });
  it("A1: «Revisé el SII y no salió» también cierra la ventana, y pide confirmación en dos pasos", () => {
    const fn = src.indexOf("async function declararNoSalioUnica(");
    const cuerpo = src.slice(fn, fn + 2000);
    expect(cuerpo).toContain("APP_CONTABLE_SII_JOB_CLOSE");
    expect(src).toContain("confirmandoNoSalio");
    expect(src).toContain("¿Seguro? Revisé y no está");
  });
  it("el job manda el intento (monto/tipo/receptor) para poder buscar esa boleta después", () => {
    const start = src.indexOf("async function startEmissionJob(");
    expect(src.slice(start, start + 1500)).toContain("intento:");
  });
  it("el folio de una boleta a medias se registra con registrarFolioAMano (datos del intento), no con el borrador", () => {
    expect(src).toContain("registrarFolioAMano(");
    const fn = src.indexOf("async function persistVisibleSiiFolio(");
    expect(src.slice(fn, fn + 800)).toContain("lapidaBU");
  });
  it("rev 2 M2: con la factura única corriendo en el modal del lote, sus estados no pasan por esta vista", () => {
    const handler = src.indexOf('if (data.type !== "APP_CONTABLE_SII_JOB_STATUS") return;');
    expect(src.slice(handler, handler + 400)).toContain("facturaLoteActivaRef.current");
  });
  it("rev 2 B1: lease perdido DESPUÉS del clic sella la lápida (revision_pendiente)", () => {
    const hb = src.indexOf("async function heartbeatEmissionJob(");
    expect(src.slice(hb, hb + 3500)).toContain('"revision_pendiente"');
  });
});
