/**
 * Auditoría oct-2026, hallazgo 1: un folio ya registrado en una boleta HUÉRFANA
 * (propuesta_id NULL: reconcile RCV, boleta única) cerraba el job de una propuesta sin
 * enlazarla → la propuesta volvía a Listas → re-emisión = doble folio. Ahora se enlaza
 * solo si calza, y si no es AJENO (no se levanta la lápida).
 */
import { describe, expect, it, vi } from "vitest";
// events.ts importa "server-only": se mockea como en jobs/seguridad.test.ts.
vi.mock("@/lib/ops/events", () => ({ recordOpsEvent: vi.fn(async () => undefined) }));
import { recordOpsEvent } from "@/lib/ops/events";
import { folioCierraLaPropuesta, resolverFolioExistente } from "./folio-existente";

type Resp = { data?: unknown; error: { message: string; code?: string } | null };
type Llamada = { tabla: string; op: "select" | "update" | "insert"; filtros: Record<string, unknown>; valores?: unknown };

function fakeSb(resp: (l: Llamada) => Resp) {
  const llamadas: Llamada[] = [];
  const sb = {
    from(tabla: string) {
      const l: Llamada = { tabla, op: "select", filtros: {} };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      q.select = () => q;
      q.update = (v: unknown) => { l.op = "update"; l.valores = v; return q; };
      q.insert = (v: unknown) => { l.op = "insert"; l.valores = v; return q; };
      for (const m of ["eq", "neq", "in", "is", "limit"]) {
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

// Huérfana del RCV: exactamente lo que escribe sii-local/reconcile/route.ts.
const huerfana = {
  id: "B1", propuesta_id: null, monto_total: 10000, estado: "aceptado",
  track_id: "sii-local-rcv:E1:41:123", proveedor_respuesta: { origen: "reconciliacion_rcv", pdf_pendiente: true },
};
const prop = { total: 10000, tipo_dte: 41 };

// Respuestas por defecto: la propuesta calza, no tiene boleta vigente, el UPDATE enlaza 1 fila.
function base(over: Partial<{ prop: Resp; vigente: Resp; update: Resp; relectura: Resp }> = {}) {
  return (l: Llamada): Resp => {
    if (l.tabla === "propuestas_ia") return over.prop ?? { data: prop, error: null };
    if (l.op === "update") return over.update ?? { data: [{ id: "B1" }], error: null };
    if (l.filtros["eq:id"] === "B1") return over.relectura ?? { data: { id: "B1", propuesta_id: null }, error: null };
    return over.vigente ?? { data: null, error: null };
  };
}

describe("resolverFolioExistente — boleta huérfana con job de propuesta", () => {
  it("calza (monto, tipo, propuesta sin boleta) → ENLAZA con UPDATE condicional y cierra", async () => {
    const { sb, llamadas } = fakeSb(base());
    const d = await resolverFolioExistente(sb, { existing: huerfana, propuestaId: "P1", tipoDte: 41 });
    expect(d).toEqual({ tipo: "enlazado" });
    expect(folioCierraLaPropuesta(d)).toBe(true);
    const upd = llamadas.find((l) => l.op === "update");
    expect(upd?.tabla).toBe("boletas_emitidas");
    expect(upd?.valores).toEqual({ propuesta_id: "P1" });
    expect(upd?.filtros["eq:id"]).toBe("B1");
    expect(upd?.filtros["is:propuesta_id"]).toBeNull();
  });

  it("monto distinto (dedazo / cruce de folio) → AJENO y no enlaza", async () => {
    const { sb, llamadas } = fakeSb(base());
    const d = await resolverFolioExistente(sb, { existing: { ...huerfana, monto_total: 9999 }, propuestaId: "P1", tipoDte: 41 });
    expect(d).toEqual({ tipo: "ajeno", motivo: "MONTO_NO_CALZA" });
    expect(folioCierraLaPropuesta(d)).toBe(false);
    expect(llamadas.some((l) => l.op === "update")).toBe(false);
  });

  it("tipo de la propuesta distinto → AJENO", async () => {
    const { sb } = fakeSb(base());
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: "P1", tipoDte: 39 })).toEqual({ tipo: "ajeno", motivo: "TIPO_NO_CALZA" });
  });

  it("la propuesta YA tiene otra boleta vigente → AJENO (idx_boletas_propuesta_unica_vigente)", async () => {
    const { sb, llamadas } = fakeSb(base({ vigente: { data: { id: "B0" }, error: null } }));
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "ajeno", motivo: "PROPUESTA_YA_TIENE_BOLETA" });
    expect(llamadas.some((l) => l.op === "update")).toBe(false);
  });

  it("el UPDATE no afecta filas (otro la enlazó entre medio) → AJENO", async () => {
    const { sb } = fakeSb(base({ update: { data: [], error: null } }));
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "ajeno", motivo: "ENLACE_NO_APLICADO" });
  });

  it("el UPDATE choca con el índice único (23505) → AJENO", async () => {
    const { sb } = fakeSb(base({ update: { data: null, error: { message: "dup", code: "23505" } } }));
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "ajeno", motivo: "PROPUESTA_YA_TIENE_BOLETA" });
  });

  it("boleta anulada → AJENO sin consultar nada", async () => {
    const { sb, llamadas } = fakeSb(base());
    expect(await resolverFolioExistente(sb, { existing: { ...huerfana, estado: "anulada" }, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "ajeno", motivo: "BOLETA_ANULADA" });
    expect(llamadas).toHaveLength(0);
  });

  it("error de consulta → 'error' (fail-closed: no cierra, pero no es rechazo permanente)", async () => {
    const { sb } = fakeSb(base({ prop: { data: null, error: { message: "timeout" } } }));
    const d = await resolverFolioExistente(sb, { existing: huerfana, propuestaId: "P1", tipoDte: 41 });
    expect(d.tipo).toBe("error");
    expect(folioCierraLaPropuesta(d)).toBe(false);
  });
});

describe("resolverFolioExistente — solo se enlazan huérfanas del RCV (rev. adversarial #1)", () => {
  it("boleta ÚNICA (huérfana a propósito) que calza en monto → AJENA, jamás se enlaza al lote", async () => {
    const { sb, llamadas } = fakeSb(base());
    const unica = { id: "B1", propuesta_id: null, monto_total: 10000, estado: "aceptado", track_id: "sii-local:server:sii_local:J7:41:123", proveedor_respuesta: { origen: "sii_local_extension", job_id: "J7" } };
    expect(await resolverFolioExistente(sb, { existing: unica, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "ajeno", motivo: "HUERFANA_NO_RCV" });
    expect(llamadas).toHaveLength(0);
  });
  it("folio B desacoplado de un doble folio (backfill, propuesta_id null) → AJENO", async () => {
    const { sb } = fakeSb(base());
    const folioB = { id: "B1", propuesta_id: null, monto_total: 10000, estado: "aceptado", track_id: "sii-local-recovery:J8:41:124", proveedor_respuesta: { origen: "backfill_job_cerrado" } };
    expect(await resolverFolioExistente(sb, { existing: folioB, propuestaId: "P1", tipoDte: 41 })).toMatchObject({ tipo: "ajeno", motivo: "HUERFANA_NO_RCV" });
  });
  it("se reconoce como RCV también solo por proveedor_respuesta.origen", async () => {
    const { sb } = fakeSb(base());
    expect(await resolverFolioExistente(sb, { existing: { ...huerfana, track_id: null }, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "enlazado" });
  });
  it("RCV con monto 0 (el Resumen no lo trajo) → no se enlaza solo; con la declaración humana sí", async () => {
    const sinMonto = { ...huerfana, monto_total: 0, fecha_emision: "2026-10-01" };
    const a = fakeSb(base());
    expect(await resolverFolioExistente(a.sb, { existing: sinMonto, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "ajeno", motivo: "MONTO_DESCONOCIDO" });
    expect(a.llamadas.some((l) => l.op === "update")).toBe(false);
    const b = fakeSb(base());
    expect(await resolverFolioExistente(b.sb, { existing: sinMonto, propuestaId: "P1", tipoDte: 41, aceptarMontoDesconocido: true, fechaIntento: "2026-10-02", jobId: "J1" })).toEqual({ tipo: "enlazado" });
    // M2: el enlace por declaración humana deja evento en ops.
    expect(recordOpsEvent).toHaveBeenCalledWith(expect.objectContaining({ eventName: "sii_local_enlace_rcv_monto_desconocido" }));
  });
});

describe("resolverFolioExistente — doble entrega simultánea del mismo folio (rev. adversarial #5)", () => {
  it("la otra entrega ya enlazó ESTA boleta a esta propuesta → propio (no 409 falso)", async () => {
    const { sb, llamadas } = fakeSb(base({ vigente: { data: { id: "B1" }, error: null } }));
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "propio" });
    expect(llamadas.some((l) => l.op === "update")).toBe(false);
  });
  it("el UPDATE pierde la carrera pero la relectura la trae con esta propuesta → propio", async () => {
    const { sb } = fakeSb(base({ update: { data: [], error: null }, relectura: { data: { id: "B1", propuesta_id: "P1" }, error: null } }));
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "propio" });
  });
  it("…y si la relectura la trae con OTRA propuesta → ajeno", async () => {
    const { sb } = fakeSb(base({ update: { data: [], error: null }, relectura: { data: { id: "B1", propuesta_id: "P2" }, error: null } }));
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "ajeno", motivo: "ENLACE_NO_APLICADO" });
  });
});

describe("resolverFolioExistente — casos que no tocan la base", () => {
  it("misma propuesta → propio; otra propuesta → ajeno; job sin propuesta → lo decide el llamador", async () => {
    const { sb, llamadas } = fakeSb(base());
    expect(await resolverFolioExistente(sb, { existing: { ...huerfana, propuesta_id: "P1" }, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "propio" });
    expect(await resolverFolioExistente(sb, { existing: { ...huerfana, propuesta_id: "P2" }, propuestaId: "P1", tipoDte: 41 })).toEqual({ tipo: "ajeno", motivo: "OTRA_PROPUESTA" });
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: null, tipoDte: 41 })).toEqual({ tipo: "sin_propuesta" });
    expect(llamadas).toHaveLength(0);
  });
});

describe("monto desconocido exige fecha (M2, arregla todo)", () => {
  const sinMonto = { ...huerfana, monto_total: 0, fecha_emision: "2026-10-01" };
  it("fecha de la boleta a más de 1 día del intento → AJENO sin tocar la base", async () => {
    const { sb, llamadas } = fakeSb(base());
    expect(await resolverFolioExistente(sb, { existing: sinMonto, propuestaId: "P1", tipoDte: 41, aceptarMontoDesconocido: true, fechaIntento: "2026-10-04" })).toEqual({ tipo: "ajeno", motivo: "FECHA_NO_CALZA" });
    expect(llamadas).toHaveLength(0);
  });
  it("sin fecha del intento → AJENO", async () => {
    const { sb } = fakeSb(base());
    expect(await resolverFolioExistente(sb, { existing: sinMonto, propuestaId: "P1", tipoDte: 41, aceptarMontoDesconocido: true })).toEqual({ tipo: "ajeno", motivo: "FECHA_NO_CALZA" });
  });
});

describe("boleta única con jobId (arregla todo #1/#2) y reentrega del folio B (#4)", () => {
  it("folio de OTRO documento (otra boleta única) → AJENO: el camino vivo ya no cierra completed", async () => {
    const { sb, llamadas } = fakeSb(base());
    const otra = { id: "B1", propuesta_id: null, monto_total: 10000, estado: "aceptado", track_id: "sii-local:server:sii_local:J7:41:5", proveedor_respuesta: { origen: "sii_local_extension", job_id: "J7" } };
    expect(await resolverFolioExistente(sb, { existing: otra, propuestaId: null, tipoDte: 41, jobId: "J1", montoIntento: 10000 })).toEqual({ tipo: "ajeno", motivo: "BOLETA_DE_OTRO_JOB" });
    expect(llamadas).toHaveLength(0);
  });
  it("boleta registrada por ESTE job → propio (también con propuesta: folio B desacoplado, ack perdido)", async () => {
    const { sb } = fakeSb(base());
    const delJob = { id: "B1", propuesta_id: null, monto_total: 10000, estado: "aceptado", track_id: "sii-local:J1:41:5", proveedor_respuesta: { origen: "sii_local_extension", job_id: "J1" } };
    expect(await resolverFolioExistente(sb, { existing: delJob, propuestaId: null, tipoDte: 41, jobId: "J1" })).toEqual({ tipo: "propio" });
    expect(await resolverFolioExistente(sb, { existing: delJob, propuestaId: "P1", tipoDte: 41, jobId: "J1" })).toEqual({ tipo: "propio" });
  });
  it("huérfana del RCV con el monto del intento → la ADOPTA (proveedor_respuesta.job_id, UPDATE condicional)", async () => {
    const { sb, llamadas } = fakeSb(base());
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: null, tipoDte: 41, jobId: "J1", montoIntento: 10000 })).toEqual({ tipo: "enlazado" });
    const upd = llamadas.find((l) => l.op === "update");
    expect((upd?.valores as { proveedor_respuesta: Record<string, unknown> }).proveedor_respuesta).toMatchObject({ job_id: "J1", origen: "reconciliacion_rcv" });
    expect(upd?.filtros["is:propuesta_id"]).toBeNull();
    expect(upd?.filtros["is:proveedor_respuesta->>job_id"]).toBeNull();
  });
  it("huérfana del RCV con otro monto → AJENO", async () => {
    const { sb } = fakeSb(base());
    expect(await resolverFolioExistente(sb, { existing: huerfana, propuestaId: null, tipoDte: 41, jobId: "J1", montoIntento: 5000 })).toEqual({ tipo: "ajeno", motivo: "MONTO_NO_CALZA" });
  });
  it("huérfana del RCV con monto 0: solo folio a mano y con fecha; si otro la adoptó entre medio → AJENO", async () => {
    const sinMonto = { ...huerfana, monto_total: 0, fecha_emision: "2026-10-01" };
    const a = fakeSb(base());
    expect(await resolverFolioExistente(a.sb, { existing: sinMonto, propuestaId: null, tipoDte: 41, jobId: "J1", montoIntento: 10000 })).toEqual({ tipo: "ajeno", motivo: "MONTO_DESCONOCIDO" });
    const b = fakeSb(base({ update: { data: [], error: null }, relectura: { data: { id: "B1", track_id: huerfana.track_id, proveedor_respuesta: { job_id: "J9" } }, error: null } }));
    expect(await resolverFolioExistente(b.sb, { existing: sinMonto, propuestaId: null, tipoDte: 41, jobId: "J1", aceptarMontoDesconocido: true, fechaIntento: "2026-10-01" })).toEqual({ tipo: "ajeno", motivo: "ENLACE_NO_APLICADO" });
  });
  it("huérfana del RCV ya adoptada por otra boleta única → no se enlaza a una propuesta", async () => {
    const { sb, llamadas } = fakeSb(base());
    const adoptada = { ...huerfana, proveedor_respuesta: { origen: "reconciliacion_rcv", job_id: "J9" } };
    expect(await resolverFolioExistente(sb, { existing: adoptada, propuestaId: "P1", tipoDte: 41, jobId: "J1" })).toEqual({ tipo: "ajeno", motivo: "ADOPTADA_POR_OTRO_JOB" });
    expect(llamadas).toHaveLength(0);
  });
});
