/**
 * Check agrupado (Fase 4) — la respuesta en grupo en el servidor: candados, tipo,
 * sello, reglas y Deshacer. Base EN MEMORIA (con el trigger del log de decisiones
 * simulado) para ver el efecto real de cada escritura, no solo que se llamó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deshacerRespuestaGrupo, ejecutarRespuestaGrupo, tipoDeVenta, validarRespuesta, type DepsGrupo } from "./responder-grupo";
import { esDecisionMirada } from "@/lib/ai/regla-evidencia";

type Row = Record<string, unknown>;
const E = "00000000-0000-4000-8000-0000000000e1";
const DOC = "00000000-0000-4000-8000-0000000000d1";
const OTRO_DOC = "00000000-0000-4000-8000-0000000000d2";
const U = "00000000-0000-4000-8000-0000000000a1";
const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;

let db: Record<string, Row[]>;
let seq = 0;

function fakeSb() {
  return {
    from(tabla: string) {
      const filtros: Array<(r: Row) => boolean> = [];
      let op: "select" | "update" = "select";
      let valores: Row = {};
      let single = false;
      let rango: [number, number] | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        update: (v: Row) => { op = "update"; valores = v; return q; },
        eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return q; },
        neq: (c: string, v: unknown) => { filtros.push((r) => r[c] !== v); return q; },
        in: (c: string, a: unknown[]) => { filtros.push((r) => a.includes(r[c])); return q; },
        is: (c: string, v: unknown) => { filtros.push((r) => (r[c] ?? null) === v); return q; },
        order: () => q,
        limit: () => q,
        range: (a: number, b: number) => { rango = [a, b]; return q; },
        maybeSingle: () => { single = true; return q; },
        then(ok: (v: unknown) => unknown) {
          const filas = (db[tabla] ??= []).filter((r) => filtros.every((f) => f(r)));
          if (op === "update") {
            for (const r of filas) {
              const antes = { ...r };
              Object.assign(r, valores);
              // trigger trg_propuestas_ia_log_cambio (simplificado)
              if (tabla === "propuestas_ia" && ["estado", "tipo_propuesto", "tipo_dte"].some((k) => antes[k] !== r[k])) {
                db.propuesta_decisiones.push({
                  id: ++seq, empresa_id: r.empresa_id, propuesta_id: r.id, accion: "cambio", canal: r.decision_canal,
                  lote_id: r.decision_lote, lote_n: r.decision_lote_n, abierta: r.decision_abierta,
                  antes_estado: antes.estado, despues_estado: r.estado, antes_tipo_propuesto: antes.tipo_propuesto,
                  antes_tipo_dte: antes.tipo_dte, despues_tipo_dte: r.tipo_dte,
                });
              }
            }
            return Promise.resolve({ error: null, count: filas.length }).then(ok);
          }
          const data = single ? filas[0] ?? null : rango ? filas.slice(rango[0], rango[1] + 1) : filas;
          return Promise.resolve({ error: null, data }).then(ok);
        },
      };
      return q;
    },
  };
}

let emitidas: Set<string>;
let deps: DepsGrupo;
const aprender = vi.fn(async (_sb: unknown, _a: Record<string, unknown>) => ({ creada: true, actualizada: false, propagadas: 0, patron: "X", reglaId: "R" }));
const deshacerRegla = vi.fn(async (_sb: unknown, _a: Record<string, unknown>) => ({ ok: true as const, reevaluadas: 0, sinRegla: 0, enEmitir: 0, intocables: 0, tipoDte: 41 }));

function propuesta(k: number, desc: string, extra: Row = {}, mov: Row = {}): Row {
  db.movimientos_raw.push({ id: `m${k}`, empresa_id: E, documento_id: DOC, descripcion: desc, tipo_flujo: "entrada", ...mov });
  const p = { id: id(k), empresa_id: E, estado: "pendiente", mesa: "boleta", tipo_propuesto: "exenta", tipo_dte: null, fuente_clasificacion: "ia_opencode", total: 11900, monto_neto: 11900, iva: 0, movimiento_id: `m${k}`, decision_lote: null, ...extra };
  db.propuestas_ia.push(p);
  return p;
}
const fila = (k: number) => db.propuestas_ia.find((r) => r.id === id(k))!;
const ctx = { empresaId: E, userId: U, soporte: null };

beforeEach(() => {
  seq = 0;
  emitidas = new Set();
  db = {
    propuestas_ia: [], movimientos_raw: [], propuesta_decisiones: [], clasificacion_reglas: [],
    documentos_subidos: [{ id: DOC, empresa_id: E, tipo_operacion_hint: null }, { id: OTRO_DOC, empresa_id: E, tipo_operacion_hint: null }],
    empresas: [{ id: E, tipo_contribuyente: "auto", boletas_tipo_default: null, facturas_tipo_default: null }],
  };
  aprender.mockClear();
  deshacerRegla.mockClear();
  deps = {
    clasificarIntocables: (async (_sb: unknown, _e: string, ids: string[]) => ({
      tocables: ids.filter((i) => !emitidas.has(i)),
      intocables: new Map(ids.filter((i) => emitidas.has(i)).map((i) => [i, "emitida" as const])),
    })) as unknown as DepsGrupo["clasificarIntocables"],
    aprender: aprender as unknown as DepsGrupo["aprender"],
    deshacerRegla: deshacerRegla as unknown as DepsGrupo["deshacerRegla"],
  };
});

const responder = (items: Array<{ ids: string[]; venta: boolean; tocada?: boolean }>, iva: string | null = null, documentoId = DOC) =>
  ejecutarRespuestaGrupo(fakeSb() as never, ctx, { documentoId, items, iva }, deps);

describe("candados", () => {
  it("lo emitido queda intacto", async () => {
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    propuesta(2, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    emitidas.add(id(2));
    const r = await responder([{ ids: [id(1), id(2)], venta: false }]);
    expect(r.ok).toBe(true);
    expect(fila(1).estado).toBe("rechazado");
    expect(fila(2).estado).toBe("pendiente");
    expect(r).toMatchObject({ noVentas: 1, quedan: 1 });
  });
  it("nunca toca una aprobada, un «¿?», una salida como venta ni lo que parece no-venta", async () => {
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { estado: "aprobado", tipo_dte: 41 });
    propuesta(2, "TRANSFERENCIA DE JUAN PEREZ", { tipo_propuesto: "arriendo" });
    propuesta(3, "PAGO PROVEEDOR", { tipo_dte: 41 }, { tipo_flujo: "salida" });
    propuesta(4, "PRESTAMO DE JUAN PEREZ", { tipo_dte: 41 });
    propuesta(5, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    const r = await responder([{ ids: [1, 2, 3, 4, 5].map(id), venta: true }]);
    expect([1, 2, 3, 4].map((k) => fila(k).estado)).toEqual(["aprobado", "pendiente", "pendiente", "pendiente"]);
    expect(fila(5).estado).toBe("listo");
    expect(r).toMatchObject({ ventas: 1, quedan: 4 });
  });
  it("una fila de OTRO documento rechaza la respuesta entera (no se cambia nada)", async () => {
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    propuesta(2, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 }, { documento_id: OTRO_DOC });
    const r = await responder([{ ids: [id(1), id(2)], venta: true }]);
    expect(r.error).toMatch(/no es de esta cartola/);
    expect(fila(1).estado).toBe("pendiente");
    expect(db.propuesta_decisiones).toHaveLength(0);
  });
  it("una cartola de otra empresa no existe", async () => {
    db.documentos_subidos[0].empresa_id = "otra";
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ");
    expect((await responder([{ ids: [id(1)], venta: false }])).error).toMatch(/No encontramos/);
  });
  it("valida el payload: uuid, fila repetida, vacío", () => {
    expect(validarRespuesta({ documentoId: "x", items: [] })).toHaveProperty("error");
    expect(validarRespuesta({ documentoId: DOC, items: [{ ids: ["no-uuid"], venta: true }] })).toHaveProperty("error");
    expect(validarRespuesta({ documentoId: DOC, items: [{ ids: [id(1)], venta: true }, { ids: [id(1)], venta: false }] })).toHaveProperty("error");
    expect(validarRespuesta({ documentoId: DOC, items: [{ ids: [id(1)], venta: true }], iva: "raro" })).toEqual({ ok: { documentoId: DOC, items: [{ ids: [id(1)], venta: true, tocada: false }], iva: null } });
  });
});

describe("el tipo de una venta", () => {
  it("cartola P2P obliga 41 (aunque la fila dijera 39 y respondiera 'lleva IVA')", async () => {
    db.documentos_subidos[0].tipo_operacion_hint = "p2p_cripto";
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 39, tipo_propuesto: "boleta" });
    await responder([{ ids: [id(1)], venta: true }], "afecta");
    expect(fila(1)).toMatchObject({ estado: "listo", tipo_dte: 41, tipo_propuesto: "exenta", monto_neto: 11900, iva: 0 });
  });
  it("emisor exento en boletas → 41", async () => {
    db.empresas[0].boletas_tipo_default = "exento";
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ");
    await responder([{ ids: [id(1)], venta: true }], "afecta");
    expect(fila(1)).toMatchObject({ tipo_dte: 41, iva: 0 });
  });
  it("carril auto sin tipo: sin respuesta de IVA queda para mirarla; con 'lleva IVA' → 39 con neto+IVA", async () => {
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ");
    expect(await responder([{ ids: [id(1)], venta: true }])).toMatchObject({ ventas: 0, quedan: 1 });
    expect(fila(1).estado).toBe("pendiente");
    await responder([{ ids: [id(1)], venta: true }], "afecta");
    expect(fila(1)).toMatchObject({ estado: "listo", tipo_dte: 39, tipo_propuesto: "boleta", monto_neto: 10000, iva: 1900 });
  });
  it("tipoDeVenta: la exención por naturaleza manda", () => {
    expect(tipoDeVenta({ tipo_propuesto: "transferencia_p2p", tipo_dte: 39 }, { carril: "afecto", p2p: false, iva: "afecta" })).toBe(41);
    expect(tipoDeVenta({ tipo_propuesto: "exenta", tipo_dte: null }, { carril: "afecto", p2p: false, iva: null })).toBe(39);
    expect(tipoDeVenta({ tipo_propuesto: "exenta", tipo_dte: null }, { carril: "auto", p2p: false, iva: "depende" })).toBeNull();
  });
});

describe("sello", () => {
  it("canal check_grupo, UN lote por respuesta, lote_n = tamaño, abierta solo lo tocado a mano", async () => {
    for (const k of [1, 2, 3]) propuesta(k, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    propuesta(4, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 });
    const r = await responder([{ ids: [id(1), id(2), id(3)], venta: true }, { ids: [id(4)], venta: false, tocada: true }]);
    const ev = db.propuesta_decisiones;
    expect(new Set(ev.map((e) => e.lote_id))).toEqual(new Set([r.grupoId]));
    expect(ev.every((e) => e.canal === "check_grupo" && e.lote_n === 4)).toBe(true);
    expect(ev.find((e) => e.propuesta_id === id(4))!.abierta).toBe(true);
    expect(ev.filter((e) => e.propuesta_id !== id(4)).every((e) => e.abierta === false)).toBe(true);
    // espejo de evidencia_reglas: solo lo tocado a mano cuenta como mirado
    expect(esDecisionMirada({ canal: "check_grupo", lote_n: 4, abierta: true })).toBe(true);
    expect(esDecisionMirada({ canal: "check_grupo", lote_n: 1, abierta: false })).toBe(false);
  });
});

describe("reglas", () => {
  it("una por contraparte con ≥2 filas; la persona de 1 fila no crea regla; sin propagar", async () => {
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    propuesta(2, "TRANSF DE JUAN PEREZ", { tipo_dte: 41 });
    propuesta(3, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 });
    const r = await responder([{ ids: [id(1), id(2), id(3)], venta: true }]);
    expect(aprender).toHaveBeenCalledTimes(1);
    expect(aprender.mock.calls[0][1]).toMatchObject({ tipoDte: 41, canal: "check_grupo", propagar: false, nacioLote: r.grupoId, documentoId: DOC });
    expect(r.reglas).toBe(1);
  });
  it("las plataformas no crean regla", async () => {
    propuesta(1, "ABONO MERCADOPAGO", { tipo_dte: 41 });
    propuesta(2, "ABONO MERCADOPAGO", { tipo_dte: 41 });
    await responder([{ ids: [id(1), id(2)], venta: true }]);
    expect(aprender).not.toHaveBeenCalled();
  });
  it("'No es venta' nunca crea regla (ni firme ni nada): no rechaza solo en el futuro", async () => {
    for (const k of [1, 2, 3]) propuesta(k, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    const r = await responder([{ ids: [1, 2, 3].map(id), venta: false, tocada: true }]);
    expect(r.noVentas).toBe(3);
    expect(aprender).not.toHaveBeenCalled();
    expect(db.clasificacion_reglas).toHaveLength(0);
  });
});

describe("Deshacer", () => {
  it("devuelve cada fila a como estaba, NUNCA revive una aprobada, y apaga las reglas del grupo", async () => {
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ");
    propuesta(2, "TRANSFERENCIA DE JUAN PEREZ");
    propuesta(3, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 });
    const r = await responder([{ ids: [id(1), id(2)], venta: true }, { ids: [id(3)], venta: false }], "afecta");
    expect([fila(1).estado, fila(2).estado, fila(3).estado]).toEqual(["listo", "listo", "rechazado"]);
    db.clasificacion_reglas.push({ id: "R1", empresa_id: E, nacio_lote: r.grupoId, estado: "a_prueba" }, { id: "R2", empresa_id: E, nacio_lote: "otro", estado: "a_prueba" });
    // Después, la cartola se aprobó: la fila 2 se fue a Emitir (otro gesto, otro lote).
    Object.assign(fila(2), { estado: "aprobado", decision_lote: "lote-aprobar" });
    const d = await deshacerRespuestaGrupo(fakeSb() as never, ctx, r.grupoId, deps);
    expect(d).toMatchObject({ ok: true, devueltas: 2, sinTocar: 1, reglas: 1 });
    expect(fila(1)).toMatchObject({ estado: "pendiente", tipo_dte: null, tipo_propuesto: "exenta", monto_neto: 11900, iva: 0 });
    expect(fila(2).estado).toBe("aprobado");
    expect(fila(3).estado).toBe("pendiente");
    expect(deshacerRegla).toHaveBeenCalledTimes(1);
    expect(deshacerRegla.mock.calls[0][1]).toMatchObject({ reglaId: "R1" });
  });
  it("no toca lo emitido después ni lo que alguien cambió después", async () => {
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    propuesta(2, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    const r = await responder([{ ids: [id(1), id(2)], venta: false }]);
    emitidas.add(id(1));
    Object.assign(fila(2), { estado: "pendiente", decision_lote: "restaurada-a-mano" });
    const d = await deshacerRespuestaGrupo(fakeSb() as never, ctx, r.grupoId, deps);
    expect(d).toMatchObject({ devueltas: 0, sinTocar: 2 });
    expect(fila(1).estado).toBe("rechazado");
  });
  it("un grupo de otra empresa (o inventado) no existe", async () => {
    expect((await deshacerRespuestaGrupo(fakeSb() as never, ctx, "no-uuid", deps)).error).toBeTruthy();
    expect((await deshacerRespuestaGrupo(fakeSb() as never, ctx, id(99), deps)).error).toMatch(/No encontramos/);
  });
});
