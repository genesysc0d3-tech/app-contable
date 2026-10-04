/**
 * Check agrupado (Fase 4) — la respuesta en grupo en el servidor: candados, tipo,
 * sello, reglas y Deshacer. Base EN MEMORIA (con el trigger del log de decisiones
 * simulado) para ver el efecto real de cada escritura, no solo que se llamó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deshacerRespuestaGrupo, ejecutarRespuestaGrupo, tipoDeVenta, ultimoGrupoDeshacible, validarRespuesta, type DepsGrupo } from "./responder-grupo";
import { esDecisionMirada } from "@/lib/ai/regla-evidencia";

type Row = Record<string, unknown>;
const E = "00000000-0000-4000-8000-0000000000e1";
const DOC = "00000000-0000-4000-8000-0000000000d1";
const OTRO_DOC = "00000000-0000-4000-8000-0000000000d2";
const U = "00000000-0000-4000-8000-0000000000a1";
const id = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;

let db: Record<string, Row[]>;
let seq = 0;
let nUpdates = 0;
let nRpc = 0;

function logCambio(antes: Row, r: Row) {
  if (["estado", "tipo_propuesto", "tipo_dte"].some((k) => antes[k] !== r[k])) {
    db.propuesta_decisiones.push({
      id: ++seq, empresa_id: r.empresa_id, propuesta_id: r.id, accion: "cambio", canal: r.decision_canal,
      lote_id: r.decision_lote, lote_n: r.decision_lote_n, abierta: r.decision_abierta,
      antes_estado: antes.estado, despues_estado: r.estado, antes_tipo_propuesto: antes.tipo_propuesto,
      antes_tipo_dte: antes.tipo_dte, despues_tipo_dte: r.tipo_dte,
      documento_id: db.movimientos_raw.find((m) => m.id === r.movimiento_id)?.documento_id ?? null,
    });
  }
}

/** Emula public.responder_grupo_ventas (la prueba SQL real está en prueba-check-agrupado.sql). */
function rpcVentas(a: Record<string, unknown>) {
  nRpc++;
  const out: Array<{ id: string }> = [];
  for (const f of a.p_filas as Row[]) {
    const r = db.propuestas_ia.find((x) => x.id === f.id && x.empresa_id === a.p_empresa_id);
    const m = r && db.movimientos_raw.find((x) => x.id === r.movimiento_id);
    if (!r || !m || m.documento_id !== a.p_documento_id || m.tipo_flujo !== "entrada") continue;
    if (!["pendiente", "editado"].includes(String(r.estado)) || r.decision_lote === a.p_lote) continue;
    if (Math.round(Number(r.total)) !== Math.round(Number(f.total))) continue;
    const antes = { ...r };
    Object.assign(r, { tipo_propuesto: f.tipo_propuesto, tipo_dte: f.tipo_dte, monto_neto: f.monto_neto, iva: f.iva, estado: "listo",
      decision_canal: "check_grupo", decision_lote: a.p_lote, decision_lote_n: a.p_lote_n, decision_abierta: f.tocada === true });
    logCambio(antes, r);
    out.push({ id: String(r.id) });
  }
  return { data: out, error: null };
}

function fakeSb() {
  return {
    rpc: async (fn: string, a: Record<string, unknown>) => (fn === "responder_grupo_ventas" ? rpcVentas(a) : { data: null, error: { message: "rpc" } }),
    from(tabla: string) {
      const filtros: Array<(r: Row) => boolean> = [];
      let op: "select" | "update" = "select";
      let valores: Row = {};
      let single = false;
      let rango: [number, number] | null = null;
      let orden: { col: string; asc: boolean } | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        update: (v: Row) => { op = "update"; valores = v; return q; },
        eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return q; },
        neq: (c: string, v: unknown) => { filtros.push((r) => r[c] !== v); return q; },
        in: (c: string, a: unknown[]) => { filtros.push((r) => a.includes(r[c])); return q; },
        is: (c: string, v: unknown) => { filtros.push((r) => (r[c] ?? null) === v); return q; },
        order: (col: string, o?: { ascending?: boolean }) => { orden = { col, asc: o?.ascending !== false }; return q; },
        limit: () => q,
        range: (a: number, b: number) => { rango = [a, b]; return q; },
        maybeSingle: () => { single = true; return q; },
        then(ok: (v: unknown) => unknown) {
          const filas = (db[tabla] ??= []).filter((r) => filtros.every((f) => f(r)));
          if (orden) { const o = orden; filas.sort((a, b) => (Number(a[o.col]) - Number(b[o.col])) * (o.asc ? 1 : -1)); }
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
                  documento_id: db.movimientos_raw.find((m) => m.id === r.movimiento_id)?.documento_id ?? null,
                });
              }
            }
            nUpdates++;
            return Promise.resolve({ error: null, count: filas.length, data: filas.map((r) => ({ id: r.id })) }).then(ok);
          }
          const data = single ? filas[0] ?? null : rango ? filas.slice(rango[0], rango[1] + 1) : filas;
          return Promise.resolve({ error: null, data, count: filas.length }).then(ok);
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
  nUpdates = 0;
  nRpc = 0;
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

const responder = (items: Array<{ ids: string[]; venta: boolean; tocada?: boolean }>, iva: string | null = null, documentoId = DOC, grupoId?: string) =>
  ejecutarRespuestaGrupo(fakeSb() as never, ctx, { documentoId, items, iva, ...(grupoId ? { grupoId } : {}) }, deps);

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
  it("no re-decide una fila ya lista (ni para rechazarla)", async () => {
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { estado: "listo", tipo_dte: 41 });
    const r = await responder([{ ids: [id(1)], venta: false }]);
    expect(fila(1).estado).toBe("listo");
    expect(r).toMatchObject({ noVentas: 0, quedan: 1 });
  });
  it("nunca vende lo que el sistema clasificó como NO venta (las 4 del revisor y más)", async () => {
    const tipos = ["boleta_honorarios", "remuneracion", "donacion", "interes", "no_comercial", "dividendo", "gasto"];
    tipos.forEach((t, i) => propuesta(i + 1, "TRANSFERENCIA DE JUAN PEREZ", { tipo_propuesto: t, tipo_dte: null }));
    const r = await responder([{ ids: tipos.map((_, i) => id(i + 1)), venta: true }], "afecta");
    expect(r.ventas).toBe(0);
    expect(db.propuestas_ia.every((f) => f.estado === "pendiente" && f.tipo_dte == null)).toBe(true);
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
    // sin la marca P2P de la cartola, el tipo "p2p" del clasificador no obliga 41
    expect(tipoDeVenta({ tipo_propuesto: "transferencia_p2p", tipo_dte: 39 }, { carril: "afecto", p2p: false, iva: "afecta" })).toBe(39);
    expect(tipoDeVenta({ tipo_propuesto: "transferencia_p2p", tipo_dte: null }, { carril: "auto", p2p: false, iva: null })).toBeNull();
    expect(tipoDeVenta({ tipo_propuesto: "transferencia_p2p", tipo_dte: 39 }, { carril: "afecto", p2p: true, iva: "afecta" })).toBe(41);
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
  it("tocada con RUT pero glosa con ruido ('TRF REC BCOS …'): no acuña (la regla no sería el nombre)", async () => {
    propuesta(1, "TRF REC BCOS 12.345.678-5 JUAN PEREZ", { tipo_dte: 41 });
    propuesta(2, "TRF REC BCOS 12.345.678-5 JUAN PEREZ", { tipo_dte: 41 });
    const r = await responder([{ ids: [id(1), id(2)], venta: true, tocada: true }]);
    expect(r.ventas).toBe(2);
    expect(aprender).not.toHaveBeenCalled();
  });
  it("un 'Sí' de GRUPO nunca crea reglas (aunque sean personas claras con varias filas)", async () => {
    propuesta(1, "TRANSFERENCIA DE 12.345.678-5 JUAN PEREZ", { tipo_dte: 41 });
    propuesta(2, "TRANSFERENCIA DE 12.345.678-5 JUAN PEREZ", { tipo_dte: 41 });
    propuesta(3, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 });
    propuesta(4, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 });
    const r = await responder([{ ids: [1, 2, 3, 4].map(id), venta: true }]);
    expect(r.ventas).toBe(4);
    expect(aprender).not.toHaveBeenCalled();
    expect(r.reglas).toBe(0);
  });
  it("solo la persona TOCADA A MANO con RUT válido y nombre (≥2 filas) enseña; sin propagar", async () => {
    propuesta(1, "TRANSFERENCIA DE 12.345.678-5 JUAN PEREZ", { tipo_dte: 41 });
    propuesta(2, "TRANSFERENCIA DE 12.345.678-5 JUAN PEREZ", { tipo_dte: 41 });
    propuesta(3, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 }); // tocada, sin RUT → no
    propuesta(4, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 });
    propuesta(5, "TEF 11.111.111-1 CAMILA", { tipo_dte: 41 }); // RUT sin nombre → no
    propuesta(6, "TEF 11.111.111-1 CAMILA", { tipo_dte: 41 });
    const r = await responder([{ ids: [1, 2, 3, 4, 5, 6].map(id), venta: true, tocada: true }]);
    expect(aprender).toHaveBeenCalledTimes(1);
    expect(aprender.mock.calls[0][1]).toMatchObject({ tipoDte: 41, canal: "check_grupo", propagar: false, nacioLote: r.grupoId, documentoId: DOC });
    expect(r.reglas).toBe(1);
  });
  it("un 'Sí' a ciegas sobre más de 5 personas no enseña (lo tocado a mano sí)", async () => {
    const nombres = ["JUAN PEREZ", "ANA ROJAS", "LUIS MORA", "EVA LUNA", "ROSA VERA", "TOMAS SILVA"];
    let k = 0;
    for (const nom of nombres) { propuesta(++k, `TRANSFERENCIA DE ${nom}`, { tipo_dte: 41 }); propuesta(++k, `TRANSFERENCIA DE ${nom}`, { tipo_dte: 41 }); }
    await responder([{ ids: Array.from({ length: k }, (_, i) => id(i + 1)), venta: true }]);
    expect(aprender).not.toHaveBeenCalled();
  });
  it("glosas genéricas de bancos no crean regla aunque se repitan y se toquen a mano", async () => {
    const glosas = ["DEPOSITO EFECTIVO", "ABONO TEF OTROS BANCOS", "TRANSF RECIBIDA OTROS BANCOS", "DEP.EFECTIVO CAJA VECINA",
      "TRANSF. DESDE CUENTARUT", "TEF ENTRANTE", "RECIBISTE DINERO", "ABONO CUENTA CORRIENTE FALABELLA", "TRANSFERENCIA DE CAMILA"];
    let k = 0;
    for (const g of glosas) { propuesta(++k, g, { tipo_dte: 41 }); propuesta(++k, g, { tipo_dte: 41 }); }
    await responder([{ ids: Array.from({ length: k }, (_, i) => id(i + 1)), venta: true, tocada: true }]);
    expect(aprender).not.toHaveBeenCalled();
  });
  it("las ventas se escriben en UNA llamada a la base (RPC), no fila por fila", async () => {
    for (let k = 1; k <= 30; k++) propuesta(k, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41, total: k <= 20 ? 10000 : 5000 });
    const r = await responder([{ ids: Array.from({ length: 30 }, (_, i) => id(i + 1)), venta: true }]);
    expect(r.ventas).toBe(30);
    expect(nRpc).toBe(1);
    expect(nUpdates).toBe(0);
    expect(fila(25)).toMatchObject({ estado: "listo", monto_neto: 5000, iva: 0 });
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
  it("el grupo lo pone el navegador: con la conexión cortada igual se deshace (y Reintentar no duplica)", async () => {
    const g = id(777);
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    propuesta(2, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 });
    const r = await responder([{ ids: [id(1), id(2)], venta: true }], null, DOC, g);
    expect(r.grupoId).toBe(g);
    const r2 = await responder([{ ids: [id(1), id(2)], venta: true }], null, DOC, g); // reintento
    // lo ya hecho cuenta como hecho: no "quedan para mirar"
    expect(r2).toMatchObject({ ventas: 2, quedan: 0 });
    expect(db.propuesta_decisiones.filter((e) => e.lote_id === g)).toHaveLength(2);
    expect(validarRespuesta({ documentoId: DOC, items: [{ ids: [id(1)], venta: true }], grupoId: "x" })).toHaveProperty("error");
    expect((await deshacerRespuestaGrupo(fakeSb() as never, ctx, g, deps)).devueltas).toBe(2);
  });
  it("un grupoId con eventos sin cartola (documento_id null) también se rechaza", async () => {
    const g = id(779);
    db.propuesta_decisiones.push({ id: ++seq, empresa_id: E, propuesta_id: id(50), lote_id: g, canal: "check_grupo", accion: "cambio", abierta: false, documento_id: null });
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    expect((await responder([{ ids: [id(1)], venta: false }], null, DOC, g)).error).toMatch(/otra cartola/);
  });
  it("un grupoId ya usado en OTRA cartola se rechaza", async () => {
    const g = id(778);
    propuesta(1, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    propuesta(2, "TRANSFERENCIA DE ANA ROJAS", { tipo_dte: 41 }, { documento_id: OTRO_DOC });
    await responder([{ ids: [id(2)], venta: false }], null, OTRO_DOC, g);
    const r = await responder([{ ids: [id(1)], venta: false }], null, DOC, g);
    expect(r.error).toMatch(/otra cartola/);
    expect(fila(1).estado).toBe("pendiente");
  });
  it("tras recargar: la última respuesta deshacible de la cartola (un deshacer no cuenta)", async () => {
    for (const k of [1, 2, 3]) propuesta(k, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 });
    const a = await responder([{ ids: [id(1)], venta: true }]);
    const b = await responder([{ ids: [id(2), id(3)], venta: false }]);
    expect(await ultimoGrupoDeshacible(fakeSb() as never, ctx, DOC)).toEqual({ grupoId: b.grupoId, filas: 2 });
    await deshacerRespuestaGrupo(fakeSb() as never, ctx, b.grupoId, deps);
    expect(await ultimoGrupoDeshacible(fakeSb() as never, ctx, DOC)).toEqual({ grupoId: a.grupoId, filas: 1 });
    expect(await ultimoGrupoDeshacible(fakeSb() as never, ctx, OTRO_DOC)).toEqual({ grupoId: null, filas: 0 });
  });
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
