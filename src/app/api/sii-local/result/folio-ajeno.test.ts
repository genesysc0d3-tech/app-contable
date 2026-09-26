import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Test estático (mismo estilo que api/pagos/cancelacion.test.ts): la ruta no tiene
// arnés de Supabase; acá se fija el ORDEN y la presencia de los guards que impiden
// que un folio de OTRA propuesta cierre este job (adversarial 0.2.8, F1/F8).
const src = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("result/route.ts — folio de otro documento nunca cierra el job", () => {
  it("la rama `existing` lee propuesta_id y el guard va ANTES de sellar 'completed'", () => {
    const sel = src.indexOf('.select("id, folio, estado, proveedor_respuesta, propuesta_id")');
    expect(sel).toBeGreaterThan(0);
    const guard = src.indexOf("const folioAjeno = Boolean(existing.propuesta_id && job.propuesta_id && existing.propuesta_id !== job.propuesta_id)", sel);
    expect(guard).toBeGreaterThan(sel);
    const completed = src.indexOf('await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "completed" });', sel);
    expect(completed).toBeGreaterThan(guard);
    // El guard sella lápida, no completed, y responde 409.
    const lapida = src.indexOf('estado: "revision_pendiente" });', guard);
    expect(lapida).toBeGreaterThan(guard);
    expect(lapida).toBeLessThan(completed);
    expect(src.slice(guard, completed)).toContain("FOLIO_DE_OTRO_DOCUMENTO");
    expect(src.slice(guard, completed)).toContain("status: 409");
  });

  it("el backfill (job cerrado) y su carrera NO levantan la lápida con folio ajeno", () => {
    const fn = src.indexOf("async function backfillFolioSinJobVivo(");
    const dedup = src.indexOf('.from("boletas_emitidas").select("id, propuesta_id")', fn);
    expect(dedup).toBeGreaterThan(fn);
    const guard1 = src.indexOf("existing.propuesta_id !== args.propuestaId", dedup);
    const lift1 = src.indexOf("await liftRevisionTombstone(sb, args.propuestaId);", dedup);
    expect(guard1).toBeGreaterThan(dedup);
    expect(guard1).toBeLessThan(lift1);
    const raced = src.indexOf("raced.propuesta_id !== args.propuestaId", lift1);
    const lift2 = src.indexOf("await liftRevisionTombstone(sb, args.propuestaId);", lift1 + 10);
    expect(raced).toBeGreaterThan(lift1);
    expect(raced).toBeLessThan(lift2);
  });

  it("la red de seguridad responde 409 FOLIO_DE_OTRO_DOCUMENTO (error permanente para el stash)", () => {
    const red = src.indexOf("const jobCerrado = jobGate.job;");
    const r409 = src.indexOf('error: "FOLIO_DE_OTRO_DOCUMENTO", detalle:', red);
    expect(r409).toBeGreaterThan(red);
    expect(src.slice(r409, r409 + 400)).toContain("status: 409");
  });

  it("el emisor cruzado se evalúa ANTES de la rama `existing`", () => {
    const mismatch = src.indexOf("const emisorMismatch = Boolean(emisorActivo");
    const existing = src.indexOf("if (existing) {", mismatch);
    expect(mismatch).toBeGreaterThan(0);
    expect(existing).toBeGreaterThan(mismatch);
  });

  it("un calce único en /reportes se veta si hoy hay otra boleta a medias del mismo monto", () => {
    expect(src).toContain("async function calceReportesVetado(");
    const veto = src.indexOf("const vetoCalce = Boolean(esCalceReportes(result)");
    const strong = src.indexOf("const hasStrongEvidence = (result?.folio_confidence === \"high\" && !vetoCalce)");
    expect(veto).toBeGreaterThan(0);
    expect(strong).toBeGreaterThan(veto);
  });
});
