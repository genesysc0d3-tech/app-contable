/**
 * Fase 3 — reglas con historial, la parte con base (doble de Supabase):
 *  - corrección: UNA por regla y acción; baja de nivel, no pisa; deja soporte 'corrigio'.
 *  - deshacer: apaga la regla sin borrarla; re-evalúa SIN IA solo pendiente/listo de esa
 *    regla, salta lo emitido/en vuelo, sella check_detalle a ciegas.
 *  - reevaluarSinRegla (pura): la próxima regla manda (con su estado); sin regla → Check.
 */
import { describe, expect, it } from "vitest";
import { buscarReglaPorContraparte, deshacerRegla, recalcularEstadoReglas, reevaluarSinRegla, registrarCorrecciones, FUENTE_REGLA_DESHECHA } from "./reglas-historial";
import type { ClasificacionRegla } from "./classifier";

type Llamada = { tabla: string; op: string; payload?: unknown; filtros: Record<string, unknown> };
type Responder = (l: Llamada) => { data?: unknown; error?: unknown; count?: number } | undefined;

function fakeSb(responder: Responder) {
  const llamadas: Llamada[] = [];
  const mk = (tabla: string, op = "select", payload?: unknown) => {
    const l: Llamada = { tabla, op, payload, filtros: {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {};
    q.select = () => q;
    for (const m of ["eq", "neq", "in", "is", "or", "order", "limit", "not"]) q[m] = (c: string, v: unknown) => { l.filtros[`${m}:${c}`] = v; return q; };
    q.range = () => q;
    q.update = (p: unknown) => { l.op = "update"; l.payload = p; return q; };
    q.upsert = (p: unknown) => { l.op = "upsert"; l.payload = p; return q; };
    q.insert = (p: unknown) => { l.op = "insert"; l.payload = p; return q; };
    const res = () => { llamadas.push(l); return { data: null, error: null, count: 0, ...(responder(l) ?? {}) }; };
    q.maybeSingle = () => Promise.resolve(res());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q.then = (ok: any, ko: any) => Promise.resolve(res()).then(ok, ko);
    return q;
  };
  const sb = {
    from: (t: string) => mk(t),
    rpc: (f: string, args: unknown) => mk(`rpc:${f}`, "rpc", args),
  };
  return { sb: sb as never, llamadas };
}

const reglaFila = (o: Record<string, unknown> = {}) => ({
  id: "r1", empresa_id: "E1", estado: "firme", tipo_dte: 41, tipo_propuesto: "exenta",
  veces_confirmada: 0, veces_corregida: 0, aprendida_bajo_marca: false, ...o,
});

describe("registrarCorrecciones", () => {
  const responde = (regla: Record<string, unknown>, confirmadas: number): Responder => (l) => {
    if (l.tabla === "clasificacion_reglas" && l.op === "select") return { data: reglaFila(regla) };
    if (l.tabla === "rpc:evidencia_reglas_lote") return { data: [{ regla_id: "r1", confirmadas, confirmadas_miradas: 0 }] };
    if (l.op === "update") return { count: 1 };
    return undefined;
  };
  const fila = (o: Record<string, unknown> = {}) => ({ reglaId: "r1", documentoId: "D1", tipoFila: 41, glosa: "TRANSFERENCIA DE JUAN PEREZ", ...o });

  it("A1: firme SIN evidencia → se da vuelta (UNA escritura por regla), ventana nueva, soporte corrigio y aviso", async () => {
    const { sb, llamadas } = fakeSb(responde({}, 0));
    const r = await registrarCorrecciones(sb, { empresaId: "E1", tipoNuevo: 39, mirada: false, filas: [fila(), fila(), { reglaId: null }] });
    expect(r.efectos.get("r1")).toBe("se_da_vuelta");
    expect(r.avisos).toEqual(["Aprendí: desde ahora Juan Perez va como Afecta."]);
    const upd = llamadas.filter((l) => l.tabla === "clasificacion_reglas" && l.op === "update");
    expect(upd).toHaveLength(1);
    expect(upd[0].payload).toMatchObject({ estado: "a_prueba", tipo_dte: 39, tipo_propuesto: "boleta", veces_corregida: 1, veces_confirmada: 0 });
    expect(typeof (upd[0].payload as Record<string, unknown>).evidencia_desde).toBe("string");
    expect(upd[0].filtros).toMatchObject({ "eq:empresa_id": "E1", "eq:veces_corregida": 0 });
    expect(llamadas.find((l) => l.tabla === "clasificacion_regla_soportes")?.payload).toMatchObject({ regla_id: "r1", documento_id: "D1", rol: "corrigio" });
  });
  it("A1: CON evidencia + mirada → en_disputa sin cambiar el tipo, con aviso", async () => {
    const { sb, llamadas } = fakeSb(responde({ tipo_dte: 39, tipo_propuesto: "boleta" }, 5));
    const r = await registrarCorrecciones(sb, { empresaId: "E1", tipoNuevo: 41, mirada: true, filas: [fila({ tipoFila: 39 })] });
    expect(r.efectos.get("r1")).toBe("en_disputa");
    expect(r.avisos).toEqual(["Ya no estoy seguro de Juan Perez: te lo voy a preguntar."]);
    const upd = llamadas.find((l) => l.tabla === "clasificacion_reglas" && l.op === "update")!;
    expect(upd.payload).toMatchObject({ estado: "en_disputa" });
    expect(upd.payload).not.toHaveProperty("tipo_dte");
  });
  it("A1: CON evidencia + 1ª corrección a ciegas → sigue firme, solo suma (sin aviso, sin reiniciar la ventana)", async () => {
    const { sb, llamadas } = fakeSb(responde({ tipo_dte: 39, tipo_propuesto: "boleta" }, 5));
    const r = await registrarCorrecciones(sb, { empresaId: "E1", tipoNuevo: 41, mirada: false, filas: [fila({ tipoFila: 39 })] });
    expect(r.efectos.get("r1")).toBe("suma");
    expect(r.avisos).toEqual([]);
    const upd = llamadas.find((l) => l.tabla === "clasificacion_reglas" && l.op === "update")!;
    expect(upd.payload).toMatchObject({ estado: "firme", veces_corregida: 1, corregidas_en_ventana: 1 });
    expect(upd.payload).not.toHaveProperty("evidencia_desde");
  });
  it("M2: la fila mostraba OTRO tipo que la regla (forzado/cambiado antes) → no corrige", async () => {
    const { sb, llamadas } = fakeSb(responde({ tipo_dte: 39, tipo_propuesto: "boleta" }, 0));
    const r = await registrarCorrecciones(sb, { empresaId: "E1", tipoNuevo: 41, mirada: true, filas: [fila({ tipoFila: 41 })] });
    expect(r.efectos.get("r1")).toBe("ninguno");
    expect(llamadas.some((l) => l.op === "update")).toBe(false);
  });
  it("regla de otra empresa / global (no aparece scopeada) → no escribe; factura (33/34) ni consulta", async () => {
    const ajena = fakeSb(() => undefined);
    await registrarCorrecciones(ajena.sb, { empresaId: "E1", tipoNuevo: 39, mirada: true, filas: [fila({ reglaId: "rX" })] });
    expect(ajena.llamadas.some((l) => l.op === "update")).toBe(false);
    const fac = fakeSb(() => undefined);
    await registrarCorrecciones(fac.sb, { empresaId: "E1", tipoNuevo: 33, mirada: true, filas: [fila()] });
    expect(fac.llamadas).toHaveLength(0);
  });
});

describe("buscarReglaPorContraparte", () => {
  it("misma clave que acuñar: patrón regex de la contraparte + flujo, solo reglas vivas de la empresa", async () => {
    const { sb, llamadas } = fakeSb((l) => (l.tabla === "clasificacion_reglas" ? { data: [{ id: "r7" }] } : undefined));
    const id = await buscarReglaPorContraparte(sb, { empresaId: "E1", descripcion: "TRANSFERENCIA DE JUAN PEREZ", tipoFlujo: "entrada" });
    expect(id).toBe("r7");
    expect(llamadas[0].filtros).toMatchObject({
      "eq:empresa_id": "E1", "eq:patron": "(^|[^a-zà-ÿ])juan perez([^a-zà-ÿ]|$)", "eq:tipo_flujo_match": "entrada", "eq:activa": true,
    });
    expect(await buscarReglaPorContraparte(sb, { empresaId: "E1", descripcion: "SOBREGIRO CTE", tipoFlujo: "entrada" })).toBeNull();
  });
});

describe("recalcularEstadoReglas", () => {
  it("a prueba con 2 cartolas (1 mirada) → firme; deja soportes confirmo; una firme sin evidencia no baja", async () => {
    const { sb, llamadas } = fakeSb((l) => {
      if (l.tabla === "rpc:evidencia_reglas_lote") return { data: [
        { regla_id: "r1", confirmadas: 2, confirmadas_miradas: 1, documentos_confirman: ["D1", "D2"] },
        { regla_id: "r2", confirmadas: 0, confirmadas_miradas: 0, documentos_confirman: [] },
      ] };
      if (l.tabla === "clasificacion_reglas" && l.op === "select") return { data: [reglaFila({ estado: "a_prueba" }), reglaFila({ id: "r2", estado: "firme" })] };
      if (l.op === "update") return { count: 1 };
      return undefined;
    });
    const r = await recalcularEstadoReglas(sb, "E1");
    expect(r).toMatchObject({ revisadas: 2, cambiadas: 1 });
    const upd = llamadas.filter((l) => l.tabla === "clasificacion_reglas" && l.op === "update");
    expect(upd).toHaveLength(1);
    expect(upd[0].payload).toMatchObject({ estado: "firme", veces_confirmada: 2 });
    // condicionado a estado Y veces_corregida (una corrección en paralelo gana)
    expect(upd[0].filtros).toMatchObject({ "eq:id": "r1", "eq:estado": "a_prueba", "eq:veces_corregida": 0 });
    const sop = llamadas.find((l) => l.tabla === "clasificacion_regla_soportes");
    expect(sop?.payload).toEqual([
      { regla_id: "r1", documento_id: "D1", empresa_id: "E1", rol: "confirmo" },
      { regla_id: "r1", documento_id: "D2", empresa_id: "E1", rol: "confirmo" },
    ]);
  });
});

describe("deshacerRegla", () => {
  const propuestas = [
    { id: "p1", movimiento_id: "m1", tipo_propuesto: "exenta", tipo_dte: 41, confianza: 0.95, total: 11900, mesa: "boleta" },
    { id: "p2", movimiento_id: "m2", tipo_propuesto: "exenta", tipo_dte: 41, confianza: 0.95, total: 5000, mesa: "boleta" },
  ];
  const responder: Responder = (l) => {
    if (l.tabla === "clasificacion_reglas" && l.op === "select" && l.filtros["eq:id"] === "r1") return { data: reglaFila() };
    if (l.tabla === "clasificacion_reglas" && l.op === "select") return { data: [] }; // restantes: ninguna
    if (l.tabla === "propuestas_ia" && l.op === "select" && l.filtros["eq:estado"] === "aprobado") return { count: 3 };
    if (l.tabla === "propuestas_ia" && l.op === "select") return { data: propuestas };
    if (l.tabla === "boletas_emitidas") return { data: [{ propuesta_id: "p2" }] }; // p2 ya emitida
    if (l.tabla === "emision_jobs") return { data: [] };
    if (l.tabla === "movimientos_raw") return { data: [{ id: "m1", descripcion: "TRANSFERENCIA DE JUAN PEREZ", monto: 11900, fecha: "2026-10-01", tipo_flujo: "entrada", documento_id: "D1" }] };
    if (l.tabla === "documentos_subidos") return { data: [{ id: "D1", tipo_operacion_hint: null }] };
    if (l.tabla === "empresas") return { data: { tipo_contribuyente: "afecto" } };
    if (l.op === "update") return { count: 1 };
    return undefined;
  };

  it("apaga la regla (sin borrarla), solo mira pendiente/listo de ESA regla, salta lo emitido y sella a ciegas", async () => {
    const { sb, llamadas } = fakeSb(responder);
    const r = await deshacerRegla(sb, { empresaId: "E1", usuarioId: "U1", reglaId: "r1" });
    expect(r).toMatchObject({ ok: true, reevaluadas: 1, sinRegla: 1, enEmitir: 3, intocables: 1, tipoDte: 41 });
    expect(llamadas.some((l) => l.op === "delete")).toBe(false);
    const apagar = llamadas.find((l) => l.tabla === "clasificacion_reglas" && l.op === "update")!;
    expect(apagar.payload).toMatchObject({ activa: false, estado: "deshecha", deshecha_por: "U1" });
    const leer = llamadas.find((l) => l.tabla === "propuestas_ia" && l.op === "select" && l.filtros["in:estado"])!;
    expect(leer.filtros).toMatchObject({ "eq:empresa_id": "E1", "eq:regla_id": "r1", "in:estado": ["pendiente", "listo"] });
    const escrituras = llamadas.filter((l) => l.tabla === "propuestas_ia" && l.op === "update");
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].filtros).toMatchObject({ "eq:id": "p1", "eq:regla_id": "r1", "in:estado": ["pendiente", "listo"] });
    expect(escrituras[0].payload).toMatchObject({
      regla_id: null, fuente_clasificacion: FUENTE_REGLA_DESHECHA, estado: "pendiente",
      decision_canal: "check_detalle", decision_abierta: false, decision_por: "U1",
    });
  });
  it("una regla de otra empresa no se encuentra → error, no escribe nada", async () => {
    const { sb, llamadas } = fakeSb(() => undefined);
    const r = await deshacerRegla(sb, { empresaId: "E1", usuarioId: "U1", reglaId: "rX" });
    expect(r.error).toBeTruthy();
    expect(llamadas.some((l) => l.op === "update")).toBe(false);
  });
});

describe("reevaluarSinRegla (pura)", () => {
  const mov = { descripcion: "TRANSFERENCIA DE JUAN PEREZ", monto: 11900, fecha: "2026-10-01", tipo_flujo: "entrada" as const };
  const otra = (o: Partial<ClasificacionRegla>): ClasificacionRegla => ({
    id: "r2", empresa_id: "E1", nombre: "x", patron: "JUAN PEREZ", patron_tipo: "contains", tipo_flujo_match: "entrada",
    tipo_propuesto: "exenta", receptor_nombre_default: null, receptor_rut_default: null, confianza: 0.95, prioridad: 50, tipo_dte: 41, ...o,
  });
  const base = { mov, tipoActual: "exenta", confianzaActual: 0.95, total: 11900, tipoDteActual: 41, emp: { tipo_contribuyente: "afecto" }, docHint: null };

  it("M6: sin otra regla, una fila de regla Exenta NO hereda 'exenta': tipo decidido sin la regla, montos coherentes, bajo Poner listas", () => {
    const r = reevaluarSinRegla({ ...base, reglas: [] });
    expect(r).toMatchObject({ regla_id: null, fuente_clasificacion: FUENTE_REGLA_DESHECHA, estado: "pendiente" });
    expect(r.confianza).toBeLessThan(0.8);
    expect(r.tipo_propuesto).toBe(r.tipo_dte === 41 ? "exenta" : "boleta");
    if (r.tipo_dte == null) expect(r).toMatchObject({ tipo_propuesto: "boleta", monto_neto: 11900, iva: 0 });
  });
  it("M6: empresa exenta sin regla → exenta por el emisor (no por herencia), igual bajo Poner listas", () => {
    const r = reevaluarSinRegla({ ...base, reglas: [], emp: { tipo_contribuyente: "exento" } });
    expect(r).toMatchObject({ tipo_dte: 41, tipo_propuesto: "exenta", monto_neto: 11900, iva: 0 });
    expect(r.confianza).toBeLessThan(0.8);
  });
  it("otra regla FIRME calza → la toma y puede quedar lista", () => {
    const r = reevaluarSinRegla({ ...base, reglas: [otra({ estado: "firme" })] });
    expect(r).toMatchObject({ regla_id: "r2", tipo_dte: 41, estado: "listo", fuente_clasificacion: "regla_usuario" });
  });
  it("otra regla A PRUEBA calza → toma el tipo pero queda pendiente", () => {
    const r = reevaluarSinRegla({ ...base, reglas: [otra({ estado: "a_prueba" })] });
    expect(r).toMatchObject({ regla_id: "r2", tipo_dte: 41, estado: "pendiente" });
  });
  it("Afecta recalcula neto/IVA", () => {
    const r = reevaluarSinRegla({ ...base, reglas: [otra({ estado: "firme", tipo_dte: 39, tipo_propuesto: "boleta" })] });
    expect(r).toMatchObject({ tipo_dte: 39, monto_neto: 10000, iva: 1900 });
  });
});
