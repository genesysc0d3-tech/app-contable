import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Test estático (mismo estilo que api/pagos/cancelacion.test.ts): la ruta no tiene
// arnés de Supabase; acá se fija el ORDEN y la presencia de los guards que impiden
// que un folio de OTRA propuesta cierre este job (adversarial 0.2.8, F1/F8).
const src = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("result/route.ts — folio de otro documento nunca cierra el job", () => {
  it("la rama `existing` lee propuesta_id y el guard va ANTES de sellar 'completed'", () => {
    const sel = src.indexOf('.select("id, folio, estado, proveedor_respuesta, propuesta_id, monto_total, track_id")');
    expect(sel).toBeGreaterThan(0);
    // Auditoría oct-2026 #1: la decisión (huérfana → enlazar o ajena) va por el helper.
    const decision = src.indexOf("await resolverFolioExistente(sb, { existing, propuestaId: job.propuesta_id ?? null, tipoDte })", sel);
    expect(decision).toBeGreaterThan(sel);
    const guard = src.indexOf('const folioAjeno = decisionFolio?.tipo === "ajeno"', decision);
    expect(guard).toBeGreaterThan(decision);
    const completed = src.indexOf('await releaseCuentaEmissionLock({ sb, cuentaId: job.cuenta_id, jobId: job.job_id, estado: "completed" });', sel);
    expect(completed).toBeGreaterThan(guard);
    // El guard sella lápida, no completed, y responde 409.
    const lapida = src.indexOf('estado: "revision_pendiente" });', guard);
    expect(lapida).toBeGreaterThan(guard);
    expect(lapida).toBeLessThan(completed);
    expect(src.slice(guard, completed)).toContain("FOLIO_DE_OTRO_DOCUMENTO");
    expect(src.slice(guard, completed)).toContain("status: 409");
    // Error al decidir → lápida + 500 (reintentable), ANTES del completed.
    const err = src.indexOf('if (decisionFolio?.tipo === "error")', decision);
    expect(err).toBeGreaterThan(decision);
    expect(src.slice(err, guard)).toContain('estado: "revision_pendiente"');
  });

  it("el backfill (job cerrado) y su carrera NO levantan la lápida con folio ajeno ni huérfano que no calza", () => {
    const fn = src.indexOf("async function backfillFolioSinJobVivo(");
    const dedup = src.indexOf('.from("boletas_emitidas").select("id, propuesta_id, monto_total, estado, track_id, proveedor_respuesta")', fn);
    expect(dedup).toBeGreaterThan(fn);
    const guard1 = src.indexOf("if (!folioCierraLaPropuesta(decision)) return { ok: false, error: \"FOLIO_DE_OTRO_DOCUMENTO\"", dedup);
    const lift1 = src.indexOf("await liftRevisionTombstone(sb, args.propuestaId, ", dedup);
    expect(guard1).toBeGreaterThan(dedup);
    expect(guard1).toBeLessThan(lift1);
    const raced = src.indexOf("if (!folioCierraLaPropuesta(decisionRaced)) return { ok: false, error: \"FOLIO_DE_OTRO_DOCUMENTO\"", lift1);
    const lift2 = src.indexOf("await liftRevisionTombstone(sb, args.propuestaId, ", lift1 + 10);
    expect(raced).toBeGreaterThan(lift1);
    expect(raced).toBeLessThan(lift2);
  });

  it("la carrera del camino vivo (raceWinner) tampoco cierra con un folio que no es de esta propuesta", () => {
    const race = src.indexOf("if (raceWinner) {");
    expect(race).toBeGreaterThan(0);
    const decision = src.indexOf("await resolverFolioExistente(sb, { existing: raceWinner,", race);
    const completed = src.indexOf('estado: "completed" });', race);
    expect(decision).toBeGreaterThan(race);
    expect(decision).toBeLessThan(completed);
    expect(src.slice(decision, completed)).toContain('estado: "revision_pendiente"');
  });

  it("folio a mano del lote: una huérfana que no calza responde 409, no 500", () => {
    const manual = src.indexOf("const respaldoManual = await backfillFolioSinJobVivo(");
    const r409 = src.indexOf('if (respaldoManual.error === "FOLIO_DE_OTRO_DOCUMENTO")', manual);
    expect(r409).toBeGreaterThan(manual);
    expect(src.slice(r409, r409 + 500)).toContain("status: 409");
  });

  it("folio a mano del lote usa la fecha Chile del JOB, no la de la propuesta (auditoría oct-2026 #6)", () => {
    const manual = src.indexOf("const respaldoManual = await backfillFolioSinJobVivo(");
    const fin = src.indexOf("});", manual);
    const llamada = src.slice(manual, fin);
    expect(llamada).toContain("fechaEmision: chileDateString(new Date(jobManual.created_at))");
    expect(src).not.toContain("propManual?.created_at");
  });

  it("el veto del calce usa el inicio del día Chile con su offset real (auditoría oct-2026 #7)", () => {
    const fn = src.indexOf("async function calceReportesVetado(");
    const cuerpo = src.slice(fn, fn + 1500);
    expect(cuerpo).toContain("const desde = chileDayStartUtc(args.fechaEmision);");
    expect(cuerpo).not.toContain("T00:00:00-04:00");
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

  it("las selects que alimentan resolverFolioExistente traen track_id/proveedor_respuesta (sin eso NINGUNA huérfana sería RCV)", () => {
    const n = src.split("track_id, proveedor_respuesta").length - 1;
    expect(n).toBeGreaterThanOrEqual(3); // backfill, su carrera y la carrera del camino vivo
    expect(src).toContain('.select("id, folio, estado, proveedor_respuesta, propuesta_id, monto_total, track_id")');
  });

  it("«no salió» del lote ignora folios rechazados por ajenos (rev. adversarial #7)", () => {
    expect(src).toContain("const folioQueBloquea = folioQueBloqueaNoSalio(conFolio ?? []);");
  });

  it("solo el folio a mano acepta una huérfana RCV sin monto", () => {
    expect(src.split("aceptarMontoDesconocido: true").length - 1).toBe(1);
    const manual = src.indexOf("const respaldoManual = await backfillFolioSinJobVivo(");
    expect(src.indexOf("aceptarMontoDesconocido: true", manual)).toBeGreaterThan(manual);
  });
});
