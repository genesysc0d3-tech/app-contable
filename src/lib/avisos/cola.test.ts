import { describe, expect, it } from "vitest";
import { claveVistosLocales, crearColaAvisos, guardarVistoLocal, leerVistosLocales, type DepsCola } from "./cola";
import type { AvisoApp } from "./reglas";

// La cola de la pantalla: de a UNO, nunca en un momento ocupado (emisión, subida,
// popup con cambios sin guardar), cada persona lo ve UNA vez.

const NOW = Date.parse("2026-10-01T15:00:00Z");
function aviso(p: Partial<AvisoApp> = {}): AvisoApp {
  return {
    id: "a1", tipo: "novedad", titulo: "Hola", cuerpo: "", formato: "toast",
    desde: "2026-10-01T00:00:00Z", hasta: "2026-10-08T00:00:00Z",
    mesa: null, version_min: null, created_at: null, ...p,
  };
}

function armar(over: Partial<DepsCola> = {}) {
  const vistos = new Set<string>();
  const marcados: string[] = [];
  let ocupado: string | null = null;
  let oculta = false;
  let mesa: "boletas" | "facturas" | null = null;
  const deps: DepsCola = {
    ahora: () => NOW,
    ocupado: () => ocupado,
    oculta: () => oculta,
    mesa: () => mesa,
    version: () => ({ version: "abc1234ffff", fechaCommit: "2026-10-01T12:00:00.000Z" }),
    yaVisto: (id) => vistos.has(id),
    anotarVisto: (id) => { vistos.add(id); },
    marcarVistoRemoto: (id) => { marcados.push(id); },
    ...over,
  };
  const cola = crearColaAvisos(deps);
  return {
    cola, vistos, marcados,
    setOcupado: (m: string | null) => { ocupado = m; },
    setOculta: (v: boolean) => { oculta = v; },
    setMesa: (m: typeof mesa) => { mesa = m; },
  };
}

describe("cola de avisos", () => {
  it("muestra de a uno; al cerrar pasa al siguiente (urgente primero)", () => {
    const t = armar();
    t.cola.recibir([aviso({ id: "n1" }), aviso({ id: "u1", tipo: "urgente", formato: "popup" })]);
    expect(t.cola.evaluar()).toBe("mostrando");
    expect(t.cola.actual()?.id).toBe("u1");
    // mientras hay uno en pantalla no aparece otro (la respuesta trae TODO lo vigente)
    t.cola.recibir([aviso({ id: "n1" }), aviso({ id: "u1", tipo: "urgente", formato: "popup" }), aviso({ id: "n2" })]);
    expect(t.cola.actual()?.id).toBe("u1");
    t.cola.cerrar("u1");
    expect(t.cola.actual()).toBeNull();
    t.cola.evaluar();
    expect(t.cola.actual()?.id).toBe("n1");
  });

  it("NUNCA en momento ocupado: espera y muestra cuando se libera", () => {
    const t = armar();
    t.setOcupado("emision_lote");
    t.cola.recibir([aviso({ id: "u1", tipo: "urgente", formato: "popup" })]);
    expect(t.cola.evaluar()).toBe("ocupado");
    expect(t.cola.actual()).toBeNull();
    t.setOcupado("popup_abierto");
    expect(t.cola.evaluar()).toBe("ocupado");
    t.setOcupado(null);
    expect(t.cola.evaluar()).toBe("mostrando");
    expect(t.cola.actual()?.id).toBe("u1");
  });

  it("con la pestaña oculta no se muestra (el toast se cerraría sin que nadie lo vea)", () => {
    const t = armar();
    t.setOculta(true);
    t.cola.recibir([aviso()]);
    expect(t.cola.evaluar()).toBe("oculta");
    t.setOculta(false);
    expect(t.cola.evaluar()).toBe("mostrando");
  });

  it("visto UNA vez: al cerrar se anota local y remoto; si el server lo reenvía (caché), no vuelve", () => {
    const t = armar();
    t.cola.recibir([aviso({ id: "x" })]);
    t.cola.evaluar();
    t.cola.cerrar("x");
    expect(t.marcados).toEqual(["x"]);
    expect(t.vistos.has("x")).toBe(true);
    t.cola.recibir([aviso({ id: "x" })]);
    expect(t.cola.evaluar()).toBe("vacia");
    // cerrar dos veces no marca dos veces
    t.cola.cerrar("x");
    expect(t.marcados).toEqual(["x"]);
  });

  it("A1: un urgente DESPLAZA a la tarjeta en pantalla; la tarjeta vuelve después sin marcarse vista", () => {
    const t = armar();
    t.cola.recibir([aviso({ id: "tar", formato: "tarjeta" })]);
    t.cola.evaluar();
    expect(t.cola.actual()?.id).toBe("tar");
    const urg = aviso({ id: "urg", tipo: "urgente", formato: "popup", desde: "2026-10-01T05:00:00Z" });
    t.cola.recibir([aviso({ id: "tar", formato: "tarjeta" }), urg]);
    expect(t.cola.evaluar()).toBe("mostrando");
    expect(t.cola.actual()?.id).toBe("urg");
    expect(t.marcados).toEqual([]);
    t.cola.cerrar("urg");
    t.cola.evaluar();
    expect(t.cola.actual()?.id).toBe("tar");
    expect(t.marcados).toEqual(["urg"]);
  });

  it("A1: si el urgente no puede salir (ocupado), la tarjeta sigue donde está", () => {
    const t = armar();
    t.cola.recibir([aviso({ id: "tar", formato: "tarjeta" })]);
    t.cola.evaluar();
    t.setOcupado("emision_lote");
    t.cola.recibir([aviso({ id: "tar", formato: "tarjeta" }), aviso({ id: "urg", tipo: "urgente", formato: "popup" })]);
    t.cola.evaluar();
    expect(t.cola.actual()?.id).toBe("tar");
  });

  it("M1: cada respuesta del server es la verdad: lo que ya no viene sale de la cola y de pantalla SIN marcarse visto", () => {
    const t = armar();
    t.cola.recibir([aviso({ id: "malo", tipo: "urgente", formato: "popup" }), aviso({ id: "b" })]);
    t.setOcupado("emision_lote");
    t.cola.evaluar();
    // el operador lo desactivó: la próxima respuesta ya no lo trae
    t.cola.recibir([aviso({ id: "b" })]);
    t.setOcupado(null);
    t.cola.evaluar();
    expect(t.cola.actual()?.id).toBe("b");
    // y si estaba EN pantalla, se retira
    t.cola.recibir([]);
    expect(t.cola.actual()).toBeNull();
    expect(t.cola.pendientes()).toBe(0);
    expect(t.marcados).toEqual([]);
  });

  it("M1: un aviso en pantalla que vence se retira solo (popup vencido no bloquea la actualización)", () => {
    let ahora = NOW;
    const t = armar({ ahora: () => ahora });
    t.cola.recibir([aviso({ id: "p", tipo: "urgente", formato: "popup", hasta: "2026-10-01T15:30:00Z" })]);
    t.cola.evaluar();
    expect(t.cola.actual()?.id).toBe("p");
    ahora = Date.parse("2026-10-01T15:31:00Z");
    expect(t.cola.evaluar()).toBe("vacia");
    expect(t.cola.actual()).toBeNull();
    expect(t.marcados).toEqual([]);
  });

  it("M2: el momento seguro se pregunta POR AVISO (el popup tiene reglas más estrictas)", () => {
    const pedidos: string[] = [];
    const t = armar({ ocupado: (a) => { pedidos.push(a.id); return a.formato === "popup" ? "margen_tras_emision" : null; } });
    t.cola.recibir([aviso({ id: "urg", tipo: "urgente", formato: "popup" }), aviso({ id: "n" })]);
    expect(t.cola.evaluar()).toBe("ocupado");
    expect(pedidos).toContain("urg");
    expect(t.cola.actual()).toBeNull();
  });

  it("no duplica: el mismo aviso por layout y por /api/mesa entra una vez", () => {
    const t = armar();
    t.cola.recibir([aviso({ id: "x" })]);
    t.cola.recibir([aviso({ id: "x" })]);
    expect(t.cola.pendientes()).toBe(1);
  });

  it("vencido o de otra mesa no se muestra; el de otra mesa espera a que la clienta llegue ahí", () => {
    const t = armar();
    t.cola.recibir([aviso({ id: "viejo", hasta: "2026-10-01T14:00:00Z" }), aviso({ id: "fact", mesa: "facturas" })]);
    t.setMesa("boletas");
    expect(t.cola.evaluar()).toBe("vacia");
    t.setMesa("facturas");
    expect(t.cola.evaluar()).toBe("mostrando");
    expect(t.cola.actual()?.id).toBe("fact");
  });

  it("novedades de una versión que la pestaña aún no tiene: esperan", () => {
    const t = armar();
    t.cola.recibir([aviso({ id: "nov", formato: "tarjeta", version_min: "2026-10-02T00:00:00Z" })]);
    expect(t.cola.evaluar()).toBe("vacia");
    expect(t.cola.pendientes()).toBe(1);
  });

  it("un fallo al marcar remoto no rompe la cola (queda anotado local)", () => {
    const t = armar({ marcarVistoRemoto: () => { throw new Error("red"); } });
    t.cola.recibir([aviso({ id: "x" }), aviso({ id: "y", desde: "2026-10-01T01:00:00Z" })]);
    t.cola.evaluar();
    expect(() => t.cola.cerrar("x")).not.toThrow();
    t.cola.evaluar();
    expect(t.cola.actual()?.id).toBe("y");
  });

  it("basura del server (no-array, filas rotas) se ignora", () => {
    const t = armar();
    t.cola.recibir(null as unknown as AvisoApp[]);
    t.cola.recibir([{ id: 3 } as unknown as AvisoApp]);
    expect(t.cola.pendientes()).toBe(0);
  });
});

describe("M4: vistos locales POR USUARIO (computador compartido)", () => {
  function mem() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  }
  it("lo que cerró la contadora no se le esconde a la colaboradora en el mismo navegador", () => {
    const s = mem();
    guardarVistoLocal(s, "u-contadora", "a1");
    expect(leerVistosLocales(s, "u-contadora").has("a1")).toBe(true);
    expect(leerVistosLocales(s, "u-colaboradora").has("a1")).toBe(false);
    expect(claveVistosLocales("u1")).toBe("massdte.avisos.vistos:u1");
  });
});
