/**
 * Fase 1 medición — cada acción de revisar/actions.ts manda el SELLO en el mismo
 * UPDATE de propuestas_ia: canal de la lista cerrada, quién (decision_por), UN lote
 * por gesto compartido por todos los trozos de 50, y lote_n = tamaño del gesto.
 * Sin esto el trigger las marca `sin_sello` y la medición de precisión no sirve.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANALES_DECISION } from "@/lib/propuestas/sello";

type Llamada = { tabla: string; op: "select" | "update" | "delete" | "insert"; valores?: Record<string, unknown> };

const { estado, auditSpy } = vi.hoisted(() => ({
  estado: { llamadas: [] as Llamada[], selectPropuestas: [] as unknown[] },
  auditSpy: vi.fn(async (_a: unknown) => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit/account", () => ({ recordCuentaAudit: auditSpy }));
vi.mock("@/lib/dev/support-mode", () => ({ getDevSupportWriteBlock: async () => null, getDevSupportMode: async () => null }));
vi.mock("@/lib/auth/roles", () => ({ ROLES_EMISION: new Set(["owner"]) }));
vi.mock("@/lib/ai/aprender-regla", () => ({ aprenderReglaDesdeResolucion: vi.fn(async () => null), extraerPatronContraparte: () => null }));
vi.mock("@/lib/cartola/confirmacion-mapa", () => ({ confirmarMapaPorCheck: vi.fn(async () => undefined) }));
vi.mock("@/lib/emission/propuestas-intocables", () => ({
  clasificarIntocables: async (_sb: unknown, _e: string, ids: string[]) => ({ tocables: ids, intocables: new Map() }),
  contarIntocables: () => ({ emitidas: 0, aMedias: 0, enVuelo: 0 }),
  avisoSeQuedan: () => "",
  resumenRetroceso: (n: number) => `${n}`,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "U1" } } }) },
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = { select: () => q, eq: () => q };
      q.single = async () => ({ data: { empresa_id: "E1", rol: "owner" } });
      return q;
    },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: async () => ({ data: { total: 1, por_estado: { pendiente: 1 } }, error: null }),
    from(tabla: string) {
      const l: Llamada = { tabla, op: "select" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {};
      for (const m of ["select", "eq", "in", "neq", "is", "order", "range", "limit", "or", "not", "gte", "lt"]) q[m] = () => q;
      q.update = (v: Record<string, unknown>) => { l.op = "update"; l.valores = v; return q; };
      q.delete = () => { l.op = "delete"; return q; };
      q.maybeSingle = () => q;
      q.single = () => q;
      q.then = (ok: (v: unknown) => unknown) => {
        estado.llamadas.push(l);
        let r: unknown = { error: null, count: 1, data: [] };
        if (l.op === "select" && tabla === "propuestas_ia") r = { error: null, data: estado.selectPropuestas };
        if (l.op === "select" && tabla === "empresas") r = { error: null, data: { tipo_contribuyente: "afecto" } };
        if (l.op === "select" && tabla === "boletas_emitidas") r = { error: null, data: null }; // no emitida
        return Promise.resolve(r).then(ok);
      };
      return q;
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
process.env.SUPABASE_SERVICE_ROLE_KEY = "k";

import * as A from "./actions";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `P${i}`);
const updates = () => estado.llamadas.filter((l) => l.tabla === "propuestas_ia" && l.op === "update").map((l) => l.valores!);

function exigirSello(canal: string, loteN: number, abierta?: boolean) {
  const us = updates();
  expect(us.length).toBeGreaterThan(0);
  const lotes = new Set(us.map((u) => u.decision_lote));
  expect(lotes.size).toBe(1); // UN lote por gesto, compartido por todos los trozos
  for (const u of us) {
    expect(CANALES_DECISION).toContain(u.decision_canal);
    expect(u.decision_canal).toBe(canal);
    expect(u.decision_por).toBe("U1");
    expect(u.decision_lote).toMatch(/^[0-9a-f-]{36}$/);
    expect(u.decision_lote_n).toBe(loteN);
    if (abierta !== undefined) expect(u.decision_abierta).toBe(abierta);
  }
}

beforeEach(() => {
  estado.llamadas = [];
  estado.selectPropuestas = [];
  auditSpy.mockClear();
});

describe("sello en cada acción de Check", () => {
  it("aprobarPropuesta (tarjeta abierta) → check_detalle", async () => {
    await A.aprobarPropuesta("P1", null);
    exigirSello("check_detalle", 1, true);
  });
  it("descartar / ocultar / restaurar / rechazar (fila) → check_fila", async () => {
    for (const f of [A.descartarPropuesta, A.ocultarPropuesta, A.restaurarPropuesta, A.rechazarPropuesta]) {
      estado.llamadas = [];
      await f("P1");
      exigirSello("check_fila", 1, false);
    }
  });
  it("rechazarPropuesta desde el detalle → check_detalle", async () => {
    await A.rechazarPropuesta("P1", "check_detalle");
    exigirSello("check_detalle", 1, true);
  });
  it("rechazarPropuestas (120 = 3 trozos) → check_lote, un lote, lote_n 120", async () => {
    await A.rechazarPropuestas(ids(120), "check_lote");
    expect(updates()).toHaveLength(3);
    exigirSello("check_lote", 120, false);
  });
  it("cambiarTipoPropuestas (fila a fila) → check_lote compartido", async () => {
    estado.selectPropuestas = [{ id: "P0", total: 1000, movimiento_id: null }, { id: "P1", total: 2000, movimiento_id: null }];
    await A.cambiarTipoPropuestas(ids(2), "exenta", "boleta");
    expect(updates()).toHaveLength(2);
    exigirSello("check_lote", 2, false);
  });
  it("editarPropuesta → check_detalle (abierta)", async () => {
    await A.editarPropuesta("P1", { notas: "x" });
    exigirSello("check_detalle", 1, true);
  });
  it("aprobarTodas (60) → check_lote, lote_n 60", async () => {
    await A.aprobarTodas(ids(60));
    exigirSello("check_lote", 60);
  });
  it("ponerListo: origen validado (detalle / lote) y deducido si falta", async () => {
    await A.ponerListo(["P1"], null, "check_detalle");
    exigirSello("check_detalle", 1, true);
    estado.llamadas = [];
    await A.ponerListo(ids(75), undefined, "check_lote");
    exigirSello("check_lote", 75, false);
    estado.llamadas = [];
    await A.ponerListo(["P1"], undefined, "mcp"); // el navegador no puede reclamar mcp
    exigirSello("check_fila", 1, false);
  });
  it("editarGlosaEmitible → check_detalle", async () => {
    await A.editarGlosaEmitible("P1", "glosa");
    exigirSello("check_detalle", 1, true);
  });
  it("volverAPendientes / restaurarPropuestas → lote", async () => {
    await A.volverAPendientes(ids(3), "check_lote");
    exigirSello("check_lote", 3);
    estado.llamadas = [];
    await A.restaurarPropuestas(ids(4));
    exigirSello("check_lote", 4);
  });
  it("aprobarCartola (110 listas) → aprobar_cartola, un lote, lote_n 110", async () => {
    estado.selectPropuestas = ids(110).map((id) => ({ id }));
    await A.aprobarCartola("D1");
    expect(updates()).toHaveLength(3);
    exigirSello("aprobar_cartola", 110, false);
  });
  it("devolverCartola → devolver_cartola", async () => {
    estado.selectPropuestas = ids(7).map((id) => ({ id }));
    await A.devolverCartola("D1");
    exigirSello("devolver_cartola", 7, false);
  });
  it("decidirVenta («¿?»): reset a pendiente y decisión van selladas con el mismo canal y lotes DISTINTOS", async () => {
    // Lotes distintos: el trigger toma "mismo lote que la escritura anterior" como sin sello.
    const revisar = () => {
      const us = updates();
      expect(us.length).toBeGreaterThanOrEqual(2);
      for (const u of us) {
        expect(u.decision_canal).toBe("check_fila");
        expect(u.decision_por).toBe("U1");
        expect(u.decision_lote).toMatch(/^[0-9a-f-]{36}$/);
      }
      expect(new Set(us.map((u) => u.decision_lote)).size).toBe(2);
    };
    estado.selectPropuestas = [{ id: "P1", total: 1000, movimiento_id: null }];
    await A.decidirVenta(["P1"], "exenta", "boleta");
    revisar();
    estado.llamadas = [];
    await A.decidirVenta(["P1"], "no_es_venta", "boleta");
    revisar();
  });
  it("un lote que llega del navegador y no es uuid se ignora", async () => {
    await A.rechazarPropuestas(["P1", "P2"], "check_lote", "no-es-uuid");
    exigirSello("check_lote", 2);
    expect(updates()[0].decision_lote).not.toBe("no-es-uuid");
  });
  it("editarMovimientoPropuesta → check_detalle", async () => {
    estado.selectPropuestas = { estado: "pendiente" } as never;
    await A.editarMovimientoPropuesta("P1", "M1", { notas: "x" });
    exigirSello("check_detalle", 1, true);
  });
});

describe("devolverAOmitidos deja rastro del borrado (solo conteos)", () => {
  it("audita propuesta_devuelta_a_omitidos con el resumen de la base", async () => {
    estado.selectPropuestas = { id: "P1", movimiento_id: "M1" } as never;
    await A.devolverAOmitidos("P1");
    const llamada = auditSpy.mock.calls.map((c) => c[0] as { accion: string; metadata: Record<string, unknown> })
      .find((a) => a.accion === "propuesta_devuelta_a_omitidos");
    expect(llamada?.metadata.propuestas_resumen).toMatchObject({ total: 1, por_estado: { pendiente: 1 } });
  });
});
