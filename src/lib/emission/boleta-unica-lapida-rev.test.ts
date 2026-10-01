/**
 * Revisión adversarial del fix de seguridad (2026-09-30, rev 1 M1/M2/M3/B1 y rev 2
 * A1/M4): la boleta única a medias necesita una salida REAL (saber QUÉ boleta buscar
 * y registrar su folio con los datos del intento, no del borrador nuevo), y «no
 * salió» no puede aceptarse con el job o la ventana todavía vivos.
 */
import { describe, expect, it } from "vitest";
import {
  buscarLapidaBoletaUnica,
  datosFolioBoletaUnica,
  declararNoSalioBoletaUnica,
  describirIntento,
  fueDeclaradoNoSalio,
  leerIntento,
  plazoDeclararBoletaUnica,
} from "./boleta-unica-lapida";

type Resp = { data?: unknown; error: { message: string } | null };
type Llamada = { tabla: string; op: string; filtros: Record<string, unknown> };

function fakeSb(resp: (l: Llamada) => Resp) {
  const llamadas: Llamada[] = [];
  const sb = {
    from(tabla: string) {
      const l: Llamada = { tabla, op: "select", filtros: {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      q.select = () => q;
      q.update = () => { l.op = "update"; return q; };
      q.delete = () => { l.op = "delete"; return q; };
      for (const m of ["eq", "neq", "in", "is", "gte", "gt", "lt", "not", "order", "limit"]) {
        q[m] = (c: string, v: unknown) => { l.filtros[`${m}:${c}`] = v; return q; };
      }
      q.then = (ok: (v: Resp) => unknown) => { llamadas.push(l); return Promise.resolve(resp(l)).then(ok); };
      return q;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: sb as any, llamadas };
}

const intento = { monto: 10000, tipo_dte: 41 as const, receptor_rut: null, receptor_nombre: "Ana Pérez", detalle: "Clase" };

describe("intento de la boleta única", () => {
  it("leerIntento valida y recorta; basura → null", () => {
    expect(leerIntento({ ...intento, receptor_rut: "1-9" })).toEqual({ ...intento, receptor_rut: "1-9" });
    expect(leerIntento({ monto: -1, tipo_dte: 41 })).toBeNull();
    expect(leerIntento({ monto: 100, tipo_dte: 50 })).toBeNull();
    expect(leerIntento(null)).toBeNull();
  });
  it("describirIntento dice qué buscar en el SII: tipo, monto, receptor, día y hora de Chile", () => {
    const t = describirIntento(intento, "2026-09-30T17:05:00Z");
    expect(t).toContain("boleta exenta");
    expect(t).toContain("$10.000");
    expect(t).toContain("Ana Pérez");
    expect(t).toContain("30/09");
    expect(t).toContain("14:05");
    expect(describirIntento(null, "2026-09-30T17:05:00Z")).toContain("30/09");
  });
  it("el folio a mano usa los datos del INTENTO, nunca los del borrador nuevo", () => {
    expect(datosFolioBoletaUnica({ intento }, { monto: 999, tipo_dte: 39 })).toMatchObject({ ok: true, monto: 10000, tipo_dte: 41 });
  });
  it("sin intento guardado (migración sin aplicar) exige monto y tipo DECLARADOS de esa boleta", () => {
    expect(datosFolioBoletaUnica({}, null)).toMatchObject({ ok: false, error: "FALTA_MONTO_INTENTO" });
    expect(datosFolioBoletaUnica({}, { monto: 5000, tipo_dte: 39 })).toMatchObject({ ok: true, monto: 5000, tipo_dte: 39 });
  });
});

describe("«Revisé el SII y no salió» — no al tiro", () => {
  const base = { job_id: "J1", cuenta_id: "C1", estado: "revision_pendiente", propuesta_id: null, created_at: "2026-09-30T12:00:00Z" };
  it("plazo = máx(expires_at, updated_at + 10 min)", () => {
    expect(new Date(plazoDeclararBoletaUnica({ ...base, expires_at: "2026-09-30T12:15:00Z", updated_at: "2026-09-30T12:01:00Z" })).toISOString()).toBe("2026-09-30T12:15:00.000Z");
    expect(new Date(plazoDeclararBoletaUnica({ ...base, expires_at: "2026-09-30T12:05:00Z", updated_at: "2026-09-30T12:01:00Z" })).toISOString()).toBe("2026-09-30T12:11:00.000Z");
  });
  it("antes del plazo → 409 MUY_PRONTO sin tocar nada", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: [], error: null }));
    const job = { ...base, expires_at: "2026-09-30T12:15:00Z", updated_at: "2026-09-30T12:01:00Z" };
    const r = await declararNoSalioBoletaUnica(sb, job, new Date("2026-09-30T12:10:00Z"));
    expect(r).toMatchObject({ ok: false, status: 409, error: "MUY_PRONTO" });
    expect(llamadas).toHaveLength(0);
  });
  it("después del plazo procede", async () => {
    const { sb } = fakeSb((l) => (l.op === "update" ? { data: [{ job_id: "J1" }], error: null } : { data: [], error: null }));
    const job = { ...base, expires_at: "2026-09-30T12:15:00Z", updated_at: "2026-09-30T12:01:00Z" };
    expect(await declararNoSalioBoletaUnica(sb, job, new Date("2026-09-30T12:16:00Z"))).toEqual({ ok: true });
  });
  it("fueDeclaradoNoSalio reconoce el sello (para alertar si después llega un folio)", () => {
    expect(fueDeclaradoNoSalio({ estado: "failed", status_message: "Declarado por la persona: revisó el SII y la boleta no salió" })).toBe(true);
    expect(fueDeclaradoNoSalio({ estado: "failed", status_message: "error pre-emit" })).toBe(false);
  });
});

describe("buscarLapidaBoletaUnica — solo boletas únicas de verdad, con lo que hay que buscar", () => {
  it("filtra por origin emision_directa (una lápida de lote huérfana no bloquea a la empresa)", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: [], error: null }));
    await buscarLapidaBoletaUnica(sb, "E1");
    expect(llamadas[0].filtros["eq:origin"]).toBe("emision_directa");
  });
  it("devuelve el intento y cuándo/quién la lanzó", async () => {
    const { sb } = fakeSb(() => ({ data: [{ job_id: "J1", estado: "revision_pendiente", propuesta_id: null, created_at: "2026-09-30T17:05:00Z", usuario_id: "U2", intento }], error: null }));
    const r = await buscarLapidaBoletaUnica(sb, "E1");
    expect(r).toMatchObject({ ok: false, jobId: "J1", intento, creadaAt: "2026-09-30T17:05:00Z", usuarioId: "U2" });
    if (!r.ok && r.error === "BOLETA_A_MEDIAS") expect(r.detalle).toContain("$10.000");
  });
});
