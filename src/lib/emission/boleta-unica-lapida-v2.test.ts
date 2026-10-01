/**
 * Revisión adversarial, vuelta 2 (2026-09-30). V2-M1: sin la migración del `intento`,
 * la lápida recién sellada en la misma sesión tiene el intento SOLO en memoria: el
 * recuadro no pedía monto/tipo y el server respondía "falta el monto" → sin salida
 * hasta recargar. V2-B1/B2/B3: fricción y cobertura.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { declaradoParaFolio } from "./boleta-unica-lapida";

const leer = (rel: string) => readFileSync(join(__dirname, rel), "utf8");

describe("declaradoParaFolio — qué monto/tipo manda el folio a mano de la lápida", () => {
  it("V2-M1: con el intento en memoria lo manda como declarado (el server prefiere el guardado si existe)", () => {
    const intento = { monto: 10000, tipo_dte: 41 as const, receptor_rut: null, receptor_nombre: null, detalle: null };
    expect(declaradoParaFolio(intento, "", 39)).toEqual({ ok: true, declarado: { monto: 10000, tipoDte: 41 } });
  });
  it("sin intento: lo que la persona escribió; vacío → error", () => {
    expect(declaradoParaFolio(null, "5.000", 39)).toEqual({ ok: true, declarado: { monto: 5000, tipoDte: 39 } });
    expect(declaradoParaFolio(null, "", 39)).toMatchObject({ ok: false });
  });
});

describe("cableado", () => {
  it("la vista usa declaradoParaFolio para el folio de la lápida", () => {
    const v = leer("../../app/(app)/escritorio/v5/EmitirDirectaView.tsx");
    const fn = v.indexOf("async function registrarFolioLapida(");
    expect(v.slice(fn, fn + 1500)).toContain("declaradoParaFolio(");
  });
  it("V2-B1: el DELETE sobre una lápida de boleta única devuelve su intento, y «liberar» lo muestra", () => {
    const r = leer("../../app/api/emision/jobs/route.ts");
    const i = r.indexOf("if (yaProtegido || (permisivoTerminal");
    expect(r.slice(i - 1500, i + 600)).toContain("intento:");
    const v = leer("../../app/(app)/escritorio/v5/EmitirDirectaView.tsx");
    const fn = v.indexOf("async function cancelStaleLock(");
    expect(v.slice(fn, fn + 1500)).toContain("cierre.intento");
  });
  it("V2-B2: un folio tardío DÉBIL de un intento declarado «no salió» también alerta", () => {
    const r = leer("../../app/api/sii-local/result/route.ts");
    const stash = r.indexOf('status: "job_gate_failed",');
    const ret = r.indexOf("return NextResponse.json({ ok: false, error: jobGate.error", stash);
    expect(r.slice(stash, ret)).toContain("folio_tras_no_salio_declarado");
  });
  it("V2-B3: el lote (cliente) no arrastra el motor de decisión (datosParaJob vive aparte)", () => {
    const hook = leer("../../app/(app)/escritorio/v5/useEmisionLote.ts");
    expect(hook).toContain('from "@/lib/emission/datos-job-cliente"');
    expect(hook).not.toContain('from "@/lib/emission/datos-job"');
    expect(leer("datos-job-cliente.ts")).not.toContain("emision-decision");
  });
});
