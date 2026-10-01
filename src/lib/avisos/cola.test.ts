import { describe, expect, it } from "vitest";
import { crearColaAvisos, type DepsCola } from "./cola";
import type { AvisoApp } from "./reglas";

// La cola de la pantalla: de a UNO, nunca en un momento ocupado (emisión, subida,
// popup con cambios sin guardar), cada persona lo ve UNA vez.

const NOW = Date.parse("2026-10-01T15:00:00Z");
function aviso(p: Partial<AvisoApp> = {}): AvisoApp {
  return {
    id: "a1", tipo: "novedad", titulo: "Hola", cuerpo: "", formato: "toast",
    desde: "2026-10-01T00:00:00Z", hasta: "2026-10-08T00:00:00Z",
    empresa_ids: null, mesa: null, version_min: null, created_at: null, ...p,
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
    version: () => ({ version: "abc1234ffff", builtAt: "2026-10-01T12:00:00.000Z" }),
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
    // mientras hay uno en pantalla no aparece otro
    t.cola.recibir([aviso({ id: "n2" })]);
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
