/**
 * Seguridad de emisión 2026-09-30 (adversarial H1): la boleta ÚNICA con emisión
 * incierta se cerraba `failed`, el server soltaba el candado y el botón Emitir
 * volvía → re-emisión a ciegas, posible doble boleta. Ahora queda como lápida
 * `revision_pendiente` y el server no abre otra boleta única de la empresa hasta
 * resolverla (folio o "no salió").
 */
import { describe, expect, it } from "vitest";
import {
  BOLETA_UNICA_LAPIDA_DESDE,
  buscarLapidaBoletaUnica,
  cierreBoletaUnicaPorStatus,
  declararNoSalioBoletaUnica,
  esLapidaBoletaUnica,
  levantarLapidaBoletaUnica,
} from "./boleta-unica-lapida";

type Resp = { data?: unknown; error: { message: string } | null };
type Llamada = { tabla: string; op: "select" | "update" | "delete"; filtros: Record<string, unknown>; valores?: unknown };

function fakeSb(resp: (l: Llamada) => Resp) {
  const llamadas: Llamada[] = [];
  const sb = {
    from(tabla: string) {
      const l: Llamada = { tabla, op: "select", filtros: {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      q.select = () => q;
      q.update = (v: unknown) => { l.op = "update"; l.valores = v; return q; };
      q.delete = () => { l.op = "delete"; return q; };
      for (const m of ["eq", "neq", "in", "is", "gte", "gt", "lt", "lte", "not", "order", "limit"]) {
        q[m] = (c: string, v: unknown) => { l.filtros[`${m}:${c}`] = v; return q; };
      }
      q.maybeSingle = () => q;
      q.then = (ok: (v: Resp) => unknown, ko: (e: unknown) => unknown) => {
        llamadas.push(l);
        return Promise.resolve(resp(l)).then(ok, ko);
      };
      return q;
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: sb as any, llamadas };
}

const nuevo = "2026-09-30T12:00:00Z";

describe("cierreBoletaUnicaPorStatus — qué hace la boleta única con cada aviso de la extensión", () => {
  it("error con emision_incierta → LÁPIDA, nunca failed (H1)", () => {
    const r = cierreBoletaUnicaPorStatus({ status: "error", emision_incierta: true, message: "puerto muerto" });
    expect(r.cerrar).toBe("revision_pendiente");
    expect(r.estadoUi).toBe("result_needs_review");
    expect(r.mensaje).toContain("no vuelvas a emitir");
  });
  it("result_needs_review (pudo emitir, sin folio confirmado) → lápida", () => {
    expect(cierreBoletaUnicaPorStatus({ status: "result_needs_review" }).cerrar).toBe("revision_pendiente");
  });
  it("error pre-emit seguro → failed (se puede reintentar)", () => {
    expect(cierreBoletaUnicaPorStatus({ status: "error", emision_incierta: false })).toMatchObject({ cerrar: "failed", estadoUi: "error" });
    expect(cierreBoletaUnicaPorStatus({ status: "error" }).cerrar).toBe("failed");
  });
  it("cancelado → cancelled; estados en curso → no se cierra nada", () => {
    expect(cierreBoletaUnicaPorStatus({ status: "cancelled" }).cerrar).toBe("cancelled");
    expect(cierreBoletaUnicaPorStatus({ status: "capturing_result" }).cerrar).toBeNull();
    expect(cierreBoletaUnicaPorStatus({ status: "opening_sii" }).cerrar).toBeNull();
  });
});

describe("esLapidaBoletaUnica", () => {
  it("solo boleta única (sin propuesta), en revision_pendiente y posterior al corte", () => {
    expect(esLapidaBoletaUnica({ estado: "revision_pendiente", propuesta_id: null, created_at: nuevo })).toBe(true);
    expect(esLapidaBoletaUnica({ estado: "revision_pendiente", propuesta_id: "p1", created_at: nuevo })).toBe(false);
    expect(esLapidaBoletaUnica({ estado: "failed", propuesta_id: null, created_at: nuevo })).toBe(false);
    expect(esLapidaBoletaUnica({ estado: "revision_pendiente", propuesta_id: null, created_at: "2026-09-01T00:00:00Z" })).toBe(false);
    expect(Date.parse(BOLETA_UNICA_LAPIDA_DESDE)).toBeGreaterThan(0);
  });
});

describe("buscarLapidaBoletaUnica — el server no abre otra boleta única con una a medias", () => {
  it("con una lápida viva → 409 BOLETA_A_MEDIAS con su job_id", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: [{ job_id: "J1", estado: "revision_pendiente", propuesta_id: null, created_at: nuevo }], error: null }));
    const r = await buscarLapidaBoletaUnica(sb, "E1");
    expect(r).toMatchObject({ ok: false, status: 409, error: "BOLETA_A_MEDIAS", jobId: "J1" });
    const q = llamadas[0];
    expect(q.tabla).toBe("emision_jobs");
    expect(q.filtros["eq:empresa_id"]).toBe("E1");
    expect(q.filtros["is:propuesta_id"]).toBeNull();
    expect(q.filtros["in:estado"]).toEqual(["revision_pendiente", "created", "running"]);
  });
  it("sin lápida → ok", async () => {
    const { sb } = fakeSb(() => ({ data: [], error: null }));
    expect(await buscarLapidaBoletaUnica(sb, "E1")).toEqual({ ok: true });
  });
  it("si la consulta falla → fail-closed (500), nunca deja emitir a ciegas", async () => {
    const { sb } = fakeSb(() => ({ data: null, error: { message: "boom" } }));
    expect(await buscarLapidaBoletaUnica(sb, "E1")).toMatchObject({ ok: false, status: 500 });
  });
});

describe("buscarLapidaBoletaUnica — boleta única SIN RESPUESTA (auditoría oct-2026 #2)", () => {
  const ahora = new Date("2026-10-01T12:30:00Z");
  const colgado = { job_id: "J9", estado: "running", propuesta_id: null, created_at: "2026-10-01T12:00:00Z", expires_at: "2026-10-01T12:15:00Z" };
  it("running vencido tras apretar EMITIR (pestaña muerta) → se SELLA a medias y bloquea", async () => {
    const { sb, llamadas } = fakeSb((l) => (l.op === "update"
      ? { data: [{ job_id: "J9" }], error: null }
      : { data: [{ ...colgado, estado_visible: "submitting" }], error: null }));
    const r = await buscarLapidaBoletaUnica(sb, "E1", ahora);
    expect(r).toMatchObject({ ok: false, status: 409, error: "BOLETA_A_MEDIAS", jobId: "J9" });
    const upd = llamadas.find((l) => l.op === "update");
    expect(upd?.valores).toMatchObject({ estado: "revision_pendiente" });
    expect(upd?.filtros["eq:job_id"]).toBe("J9");
    expect(upd?.filtros["in:estado"]).toEqual(["created", "running"]);
    expect(upd?.filtros["lte:expires_at"]).toBe(ahora.toISOString());
  });
  it("running vencido que nunca llegó al clic → no bloquea ni se toca", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: [{ ...colgado, estado_visible: "sii_page_ready" }], error: null }));
    expect(await buscarLapidaBoletaUnica(sb, "E1", ahora)).toEqual({ ok: true });
    expect(llamadas.some((l) => l.op === "update")).toBe(false);
  });
  it("running con posible clic pero AÚN vivo (no vencido) → no bloquea (el candado lo cubre)", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: [{ ...colgado, estado_visible: "submitting", expires_at: "2026-10-01T12:45:00Z" }], error: null }));
    expect(await buscarLapidaBoletaUnica(sb, "E1", ahora)).toEqual({ ok: true });
    expect(llamadas.some((l) => l.op === "update")).toBe(false);
  });
  it("el sello no aplica (llegó su folio o un latido lo renovó entre medio) → no bloquea", async () => {
    const { sb } = fakeSb((l) => (l.op === "update" ? { data: [], error: null } : { data: [{ ...colgado, estado_visible: "submitting" }], error: null }));
    expect(await buscarLapidaBoletaUnica(sb, "E1", ahora)).toEqual({ ok: true });
  });
  it("el sello falla → fail-closed 500", async () => {
    const { sb } = fakeSb((l) => (l.op === "update" ? { data: null, error: { message: "boom" } } : { data: [{ ...colgado, estado_visible: "submitting" }], error: null }));
    expect(await buscarLapidaBoletaUnica(sb, "E1", ahora)).toMatchObject({ ok: false, status: 500 });
  });
});

describe("levantarLapidaBoletaUnica — un folio registrado cierra la lápida y suelta el candado", () => {
  it("revision_pendiente → completed (solo boleta única) + borra el candado de ese job", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: null, error: null }));
    await levantarLapidaBoletaUnica(sb, "J1");
    const upd = llamadas.find((l) => l.tabla === "emision_jobs" && l.op === "update");
    expect(upd?.valores).toMatchObject({ estado: "completed" });
    expect(upd?.filtros["eq:job_id"]).toBe("J1");
    expect(upd?.filtros["eq:estado"]).toBe("revision_pendiente");
    expect(upd?.filtros["is:propuesta_id"]).toBeNull();
    const del = llamadas.find((l) => l.tabla === "emision_locks" && l.op === "delete");
    expect(del?.filtros["eq:job_id"]).toBe("J1");
  });
  it("sin job_id no toca nada", async () => {
    const { sb, llamadas } = fakeSb(() => ({ data: null, error: null }));
    await levantarLapidaBoletaUnica(sb, null);
    expect(llamadas).toHaveLength(0);
  });
});

describe("declararNoSalioBoletaUnica — la salida humana de la lápida de boleta única", () => {
  const job = { job_id: "J1", cuenta_id: "C1", estado: "revision_pendiente", propuesta_id: null, created_at: nuevo };
  it("sin folio capturado → failed + suelta el candado", async () => {
    const { sb, llamadas } = fakeSb((l) => {
      if (l.tabla === "sii_local_resultados") return { data: [], error: null };
      if (l.tabla === "emision_jobs" && l.op === "update") return { data: [{ job_id: "J1" }], error: null };
      return { data: null, error: null };
    });
    expect(await declararNoSalioBoletaUnica(sb, job)).toEqual({ ok: true });
    const upd = llamadas.find((l) => l.tabla === "emision_jobs" && l.op === "update");
    expect(upd?.valores).toMatchObject({ estado: "failed" });
    expect(upd?.filtros["eq:estado"]).toBe("revision_pendiente");
    expect(llamadas.some((l) => l.tabla === "emision_locks" && l.op === "delete" && l.filtros["eq:job_id"] === "J1")).toBe(true);
  });
  it("con folio capturado por la extensión → 409 FOLIO_CAPTURADO (salió: no se baja)", async () => {
    const { sb, llamadas } = fakeSb((l) => (l.tabla === "sii_local_resultados" ? { data: [{ folio: 77 }], error: null } : { data: null, error: null }));
    expect(await declararNoSalioBoletaUnica(sb, job)).toMatchObject({ ok: false, status: 409, error: "FOLIO_CAPTURADO" });
    expect(llamadas.some((l) => l.op === "update")).toBe(false);
  });
  it("un job que no es lápida de boleta única → 409 JOB_SIN_LAPIDA", async () => {
    const { sb } = fakeSb(() => ({ data: [], error: null }));
    expect(await declararNoSalioBoletaUnica(sb, { ...job, estado: "failed" })).toMatchObject({ ok: false, error: "JOB_SIN_LAPIDA" });
  });
  it("si entre medio llegó su folio (0 filas) → 409 NADA_QUE_CERRAR", async () => {
    const { sb } = fakeSb((l) => (l.op === "update" ? { data: [], error: null } : { data: [], error: null }));
    expect(await declararNoSalioBoletaUnica(sb, job)).toMatchObject({ ok: false, error: "NADA_QUE_CERRAR" });
  });
});
