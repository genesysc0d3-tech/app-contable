/**
 * Check agrupado (Fase 4) — el motor puro que arma las preguntas en grupo.
 */
import { describe, expect, it } from "vitest";
import { armarPreguntas, filaDePropuesta, MIN_FILAS_TARJETA, noAbreLista, ORDEN_RIESGO, type ContextoPreguntas, type FilaPregunta } from "./preguntas-grupo";

let n = 0;
function fila(desc: string, extra: Partial<FilaPregunta> = {}): FilaPregunta {
  n++;
  return {
    id: `f${n}`, estado: "pendiente", tipo_propuesto: "exenta", tipo_dte: null, fuente_clasificacion: "ia_opencode",
    total: 10000, descripcion: desc, tipo_flujo: "entrada", receptor_rut: null, fecha: "2026-09-10", terminada: false, ...extra,
  };
}
const muchas = (k: number, desc: string, extra: Partial<FilaPregunta> = {}) => Array.from({ length: k }, () => fila(desc, extra));
const CTX: ContextoPreguntas = { mesa: "boleta", truncada: false, carril: "auto", marca: null, razonSocial: "Comercial Los Andes Puerto SpA" };
const kinds = (r: ReturnType<typeof armarPreguntas>) => r.tarjetas.map((t) => t.kind);

describe("qué filas se preguntan", () => {
  it("solo pendiente/editado, no terminadas, nunca un «¿?»", () => {
    const filas = [
      ...muchas(2, "TRANSFERENCIA DE JUAN PEREZ"),
      fila("TRANSFERENCIA DE ANA ROJAS", { estado: "editado" }),
      fila("TRANSFERENCIA DE JUAN PEREZ", { estado: "aprobado" }),
      fila("TRANSFERENCIA DE JUAN PEREZ", { estado: "listo" }),
      fila("TRANSFERENCIA DE JUAN PEREZ", { estado: "rechazado" }),
      fila("TRANSFERENCIA DE JUAN PEREZ", { terminada: true }),
      fila("TRANSFERENCIA DE JUAN PEREZ", { tipo_propuesto: "arriendo" }),
      fila("TRANSFERENCIA DE JUAN PEREZ", { tipo_propuesto: "boleta", tipo_dte: null, fuente_clasificacion: "conflicto_marca_cartola" }),
    ];
    const r = armarPreguntas(filas, CTX);
    expect(r.tarjetas).toHaveLength(1);
    expect(r.tarjetas[0].ids).toEqual([filas[0].id, filas[1].id, filas[2].id]);
  });
  it("filaDePropuesta: una emitida (boleta no anulada) es terminada", () => {
    const base = { id: "x", estado: "pendiente", tipo_propuesto: "exenta", movimientos_raw: { descripcion: "TEF", tipo_flujo: "entrada", monto: 5 } };
    expect(filaDePropuesta({ ...base, boletas_emitidas: [{ folio: 9, estado: "aceptado" }] }, new Set()).terminada).toBe(true);
    expect(filaDePropuesta({ ...base, boletas_emitidas: [{ folio: 9, estado: "anulada" }] }, new Set()).terminada).toBe(false);
    expect(filaDePropuesta(base, new Set(["x"])).terminada).toBe(true);
    expect(filaDePropuesta(base, new Set()).total).toBe(5);
  });
});

describe("tarjetas", () => {
  it("menos de 3 filas no hacen tarjeta: van a sueltas", () => {
    expect(MIN_FILAS_TARJETA).toBe(3);
    const r = armarPreguntas([...muchas(2, "TRANSFERENCIA DE JUAN PEREZ"), ...muchas(2, "PAGO PROVEEDOR X", { tipo_flujo: "salida" })], CTX);
    expect(r.tarjetas).toEqual([]);
    expect(r.sueltas).toBe(4);
  });
  it("sin nadie reconocible → suelta", () => {
    const r = armarPreguntas([...muchas(3, "TRANSFERENCIA 0001"), ...muchas(3, "TRANSFERENCIA DE ANA ROJAS")], CTX);
    expect(kinds(r)).toEqual(["ventas"]);
    expect(r.sueltas).toBe(3);
  });
  it("orden de riesgo: propia, no-venta probable, sigue igual, ventas, canal, salidas, empresas", () => {
    const filas = [
      ...muchas(3, "TRANSF DE AGRICOLA SUR SPA"),
      ...muchas(3, "PAGO LUZ", { tipo_flujo: "salida" }),
      ...muchas(3, "ABONO MERCADOPAGO"),
      ...muchas(3, "TRANSFERENCIA DE JUAN PEREZ"),
      ...muchas(3, "TRANSFERENCIA PRESTAMO DE TIO PEPE"),
      ...muchas(3, "TRANSF DE COMERCIAL LOS ANDES PUERTO"),
      ...muchas(3, "TRANSFERENCIA DE ROSA DIAZ"),
    ];
    const historial = [fila("TRANSFERENCIA DE ROSA DIAZ", { estado: "rechazado", id: "h1" })];
    const r = armarPreguntas(filas, { ...CTX, historial });
    expect(kinds(r)).toEqual(["propia", "no_venta_probable", "sigue_igual", "ventas", "canal", "salidas", "empresas"]);
    expect(ORDEN_RIESGO).toEqual(kinds(r));
  });
  it("la tarjeta de ventas agrupa por persona y nombra a algunas", () => {
    const r = armarPreguntas([
      ...muchas(3, "TRANSFERENCIA DE JUAN PEREZ"), ...muchas(2, "TRANSF DE MARIA SOTO"), fila("TEF 12.345.678-5 PEDRO DIAZ"), fila("TEF 12.345.678-5 PEDRO DIAZ"),
    ], CTX);
    const t = r.tarjetas[0];
    expect(t.titulo).toBe("7 transferencias de 3 personas");
    expect(t.pregunta).toBe("¿Les vendiste algo a estas personas?");
    expect(t.respuestas.map((x) => x.texto)).toEqual(["Sí, me compraron", "Algunas", "No, es plata de familia o mía"]);
    expect(t.personas.map((p) => [p.etiqueta, p.ids.length])).toEqual([["Juan Perez", 3], ["Maria Soto", 2], ["Pedro Diaz", 2]]);
    expect(t.muestra).toBe("Juan Perez, Maria Soto y 1 más");
    expect(t.total).toBe(70000);
  });
  it("los pagos por plataforma van por renglón (canal), no por persona", () => {
    const r = armarPreguntas(muchas(3, "ABONO MERCADOPAGO"), CTX);
    expect(r.tarjetas[0].kind).toBe("canal");
    expect(r.tarjetas[0].personas).toHaveLength(3);
    expect(r.tarjetas[0].titulo).toBe("3 pagos que te llegaron por Mercado Pago");
  });
});

describe("lo que parece no-venta NUNCA cae en ventas", () => {
  it("préstamo, sueldo, devolución, cuenta propia: fuera de ventas y sin 'Sí, son ventas'", () => {
    const filas = [
      ...muchas(3, "TRANSFERENCIA DE JUAN PEREZ"),
      fila("TRANSFERENCIA PRESTAMO JUAN PEREZ"), fila("SUELDO JUAN PEREZ"), fila("DEVOLUCION JUAN PEREZ"), fila("TRASPASO CUENTA PROPIA JUAN PEREZ"),
    ];
    const r = armarPreguntas(filas, CTX);
    const ventas = r.tarjetas.find((t) => t.kind === "ventas")!;
    expect(ventas.ids).toEqual(filas.slice(0, 3).map((f) => f.id));
    const noVenta = r.tarjetas.find((t) => t.kind === "no_venta_probable")!;
    expect(noVenta.ids).toHaveLength(3);
    expect(noVenta.respuestas.map((x) => x.accion)).toEqual(["no_venta", "mirar"]);
    for (const t of r.tarjetas.filter((x) => x.kind === "propia" || x.kind === "no_venta_probable" || x.kind === "salidas" || x.kind === "empresas")) {
      expect(t.respuestas.some((x) => x.accion === "venta" || x.accion === "algunas")).toBe(false);
    }
  });
});

describe("lo que el sistema clasificó como NO venta nunca se vende en grupo", () => {
  it("las 4 glosas del revisor (honorarios, sueldo, donación, intereses) con nombre de persona", () => {
    const filas = [
      fila("TRANSFERENCIA DE JUAN PEREZ HONORARIOS", { tipo_propuesto: "boleta_honorarios" }),
      fila("TRANSFERENCIA DE ANA ROJAS", { tipo_propuesto: "remuneracion" }),
      fila("TRANSFERENCIA DE PEDRO DIAZ", { tipo_propuesto: "donacion" }),
      fila("TRANSFERENCIA DE LUIS MORA", { tipo_propuesto: "interes" }),
      ...muchas(3, "TRANSFERENCIA DE ROSA VERA", { tipo_propuesto: "no_comercial" }),
      ...muchas(3, "TRANSFERENCIA DE TOMAS SILVA", { tipo_propuesto: "gasto" }),
      ...muchas(3, "TRANSFERENCIA DE EVA LUNA", { tipo_propuesto: "dividendo" }),
    ];
    const r = armarPreguntas(filas, CTX);
    expect(r.tarjetas.find((t) => t.kind === "ventas")).toBeUndefined();
    const nv = r.tarjetas.find((t) => t.kind === "no_venta_probable")!;
    expect(nv.ids).toHaveLength(filas.length);
    expect(nv.respuestas.map((x) => x.accion)).toEqual(["no_venta", "mirar"]);
  });
});

describe("cuenta propia: sin respuesta de un toque", () => {
  it("muestra los nombres y obliga a marcar persona por persona", () => {
    const r = armarPreguntas(muchas(3, "TRANSF DE AGRICOLA ANDES SUR"), { ...CTX, razonSocial: "Agricola Andes Sur SpA" });
    const t = r.tarjetas[0];
    expect(t.kind).toBe("propia");
    expect(t.muestra).toBe("Agricola Andes Sur");
    expect(t.respuestas.map((x) => x.accion)).toEqual(["algunas", "mirar"]);
    expect(t.ventaPorDefecto).toBe(false);
  });
});

describe("'No' en una tarjeta grande abre la lista", () => {
  it("más de 3 personas → lista; 3 o menos → de un toque", () => {
    const grande = armarPreguntas(["ANA ROJAS", "LUIS MORA", "EVA LUNA", "JUAN PEREZ"].flatMap((nom) => muchas(1, `TRANSFERENCIA DE ${nom}`)), CTX).tarjetas[0];
    expect(noAbreLista(grande)).toBe(true);
    const chica = armarPreguntas(["ANA ROJAS", "LUIS MORA", "EVA LUNA"].flatMap((nom) => muchas(1, `TRANSFERENCIA DE ${nom}`)), CTX).tarjetas[0];
    expect(noAbreLista(chica)).toBe(false);
  });
});

describe("P2P y el IVA", () => {
  it("cartola P2P: pregunta la excepción y NUNCA el IVA", () => {
    const r = armarPreguntas(muchas(4, "TRANSFERENCIA DE JUAN PEREZ"), { ...CTX, marca: "p2p_cripto" });
    const t = r.tarjetas[0];
    expect(t.pregunta).toBe("¿Alguna NO fue una venta?");
    // sin doble negación: no hay "Ninguna fue venta"
    expect(t.respuestas.map((x) => x.texto)).toEqual(["No, todas fueron ventas", "Sí, algunas"]);
    expect(armarPreguntas(muchas(3, "ABONO MERCADOPAGO"), { ...CTX, marca: "p2p_cripto" }).tarjetas[0].respuestas.map((x) => x.accion)).toEqual(["venta", "algunas"]);
    expect(t.preguntaIva).toBe(false);
    expect(t.ventaPorDefecto).toBe(true);
  });
  it("forex también es exenta por ley", () => {
    expect(armarPreguntas(muchas(3, "TRANSFERENCIA DE JUAN PEREZ"), { ...CTX, marca: "forex_divisas" }).tarjetas[0].preguntaIva).toBe(false);
  });
  it("IVA solo con carril auto y alguna fila sin tipo que no sea exenta por naturaleza", () => {
    const sinTipo = muchas(3, "TRANSFERENCIA DE JUAN PEREZ");
    expect(armarPreguntas(sinTipo, CTX).tarjetas[0].preguntaIva).toBe(true);
    expect(armarPreguntas(sinTipo, { ...CTX, carril: "afecto" }).tarjetas[0].preguntaIva).toBe(false);
    expect(armarPreguntas(sinTipo, { ...CTX, carril: "exento" }).tarjetas[0].preguntaIva).toBe(false);
    expect(armarPreguntas(muchas(3, "TRANSFERENCIA DE JUAN PEREZ", { tipo_dte: 41 }), CTX).tarjetas[0].preguntaIva).toBe(false);
    // sin marca, el "p2p" del clasificador no es ley: se pregunta
    expect(armarPreguntas(muchas(3, "TRANSFERENCIA DE JUAN PEREZ", { tipo_propuesto: "transferencia_p2p" }), CTX).tarjetas[0].preguntaIva).toBe(true);
  });
  it("las tarjetas que no venden nunca preguntan IVA", () => {
    const r = armarPreguntas(muchas(3, "PAGO LUZ", { tipo_flujo: "salida" }), CTX);
    expect(r.tarjetas[0].preguntaIva).toBe(false);
  });
});

describe("'No es venta' no rechaza solo: pre-agrupa y pregunta '¿Sigue igual?'", () => {
  it("la persona que la otra vez no era venta sale en su propia tarjeta, pre-marcada como no venta", () => {
    const historial = [fila("TRANSFERENCIA DE ROSA DIAZ", { estado: "rechazado" })];
    const r = armarPreguntas([...muchas(3, "TRANSF DE ROSA DIAZ"), ...muchas(3, "TRANSFERENCIA DE JUAN PEREZ")], { ...CTX, historial });
    const s = r.tarjetas.find((t) => t.kind === "sigue_igual")!;
    expect(s.pregunta).toBe("La otra vez me dijiste que no eran ventas. ¿Sigue igual?");
    expect(s.ventaPorDefecto).toBe(false);
    expect(s.personas[0].antesNoVenta).toBe(true);
    // Sigue siendo una PREGUNTA: las filas siguen pendientes hasta que ella responda.
    expect(s.respuestas.map((x) => x.accion)).toContain("venta");
    expect(r.tarjetas.find((t) => t.kind === "ventas")!.personas.every((p) => !p.antesNoVenta)).toBe(true);
  });
  it("un abono juzgado de una plataforma no marca a nadie", () => {
    const historial = [fila("ABONO MERCADOPAGO", { estado: "rechazado" })];
    expect(kinds(armarPreguntas(muchas(3, "ABONO MERCADOPAGO"), { ...CTX, historial }))).toEqual(["canal"]);
  });
});

describe("se apaga", () => {
  it("mesa truncada", () => {
    const r = armarPreguntas(muchas(5, "TRANSFERENCIA DE JUAN PEREZ"), { ...CTX, truncada: true });
    expect(r).toEqual({ tarjetas: [], sueltas: 0, apagado: "truncada" });
  });
  it("mesa de facturas", () => {
    expect(armarPreguntas(muchas(5, "TRANSFERENCIA DE JUAN PEREZ"), { ...CTX, mesa: "factura" }).apagado).toBe("facturas");
  });
});
