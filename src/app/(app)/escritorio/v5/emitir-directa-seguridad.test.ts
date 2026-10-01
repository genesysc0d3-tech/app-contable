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
    expect(cuerpo).toContain('status: "result_needs_review"');
  });

  it("409 LEASE_PERDIDO en el latido → cierra la ventana SII de este computador y lo dice", () => {
    const hb = src.indexOf("async function heartbeatEmissionJob(");
    const cuerpo = src.slice(hb, hb + 2500);
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
