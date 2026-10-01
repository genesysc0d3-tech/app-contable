import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Test estático (mismo estilo que folio-ajeno.test.ts: la ruta no tiene arnés de
// Supabase). La lógica vive en lib/emission/boleta-unica-lapida.ts (tests de
// comportamiento allá); acá se fija que la ruta la USE (seguridad 2026-09-30, punto 1):
//  - un folio registrado para una boleta única a medias levanta SU lápida (si no, el
//    server la bloquearía para siempre aunque el folio ya esté en los libros);
//  - "Revisé el SII y no salió" funciona también para la boleta única (antes: JOB_SIN_LAPIDA).
const src = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("result/route.ts — lápida de boleta única", () => {
  it("liftRevisionTombstone delega en levantarLapidaBoletaUnica cuando no hay propuesta", () => {
    const fn = src.indexOf("async function liftRevisionTombstone(");
    expect(fn).toBeGreaterThan(0);
    const cuerpo = src.slice(fn, fn + 600);
    expect(cuerpo).toContain("levantarLapidaBoletaUnica(sb, jobIdBoletaUnica)");
  });

  it("el registro NUEVO de un folio levanta la lápida de su job; un folio ya existente solo si la boleta es de ese job", () => {
    const fn = src.indexOf("async function backfillFolioSinJobVivo(");
    const fin = src.indexOf("export async function POST(", fn);
    const cuerpo = src.slice(fn, fin);
    expect(cuerpo).toContain("await liftRevisionTombstone(sb, args.propuestaId, args.jobId);");
    expect(cuerpo).toContain("await liftRevisionTombstone(sb, args.propuestaId, await jobSiLaBoletaEsSuya(sb, existing.id, args.jobId));");
    expect(cuerpo).toContain("await liftRevisionTombstone(sb, args.propuestaId, await jobSiLaBoletaEsSuya(sb, raced.id, args.jobId));");
  });

  it("declarar_no_salio atiende la boleta única ANTES del rechazo JOB_SIN_LAPIDA del lote", () => {
    const decl = src.indexOf("if (payload.declarar_no_salio === true) {");
    const unica = src.indexOf("declararNoSalioBoletaUnica(sb, jobDecl)", decl);
    const acceso = src.indexOf("const accesoDecl = await accesoDeclaracion(sb, user.id, jobDecl);", decl);
    const rechazoLote = src.indexOf('if (!jobDecl.propuesta_id || esLapidaEfectiva(jobDecl) === null) {', decl);
    expect(unica).toBeGreaterThan(acceso);
    expect(unica).toBeLessThan(rechazoLote);
  });
});

// ── Revisión adversarial del fix (2026-09-30) ──
describe("result/route.ts — salida real de la boleta única a medias", () => {
  it("registrar_folio_manual atiende la boleta única ANTES del rechazo JOB_SIN_PROPUESTA, con los datos del intento", () => {
    const manual = src.indexOf("if (payload.registrar_folio_manual != null) {");
    const unica = src.indexOf("datosFolioBoletaUnica(", manual);
    const acceso = src.indexOf("const accesoManual = await accesoDeclaracion(sb, user.id, jobManual);", manual);
    const sinProp = src.indexOf('error: "JOB_SIN_PROPUESTA"', manual);
    expect(unica).toBeGreaterThan(acceso);
    expect(unica).toBeLessThan(sinProp);
  });
  it("un folio que llega para un intento declarado «no salió» dispara alerta crítica", () => {
    expect(src).toContain("fueDeclaradoNoSalio(");
    expect(src).toContain('eventName: "folio_tras_no_salio_declarado"');
  });
});
